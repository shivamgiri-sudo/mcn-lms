import { createHash, randomUUID } from 'crypto';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { prisma } from '../utils/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const contentUploadDir = path.resolve(__dirname, '..', '..', 'uploads', 'content');
const INSTANCE_ID = String(process.env.LMS_INSTANCE_ID || `${os.hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`).slice(0, 240);
const INSTANCE_ROLE = String(process.env.LMS_INSTANCE_ROLE || (process.env.LMS_RUN_SCHEDULERS === 'true' ? 'HYBRID' : 'WEB')).toUpperCase();
const APP_VERSION = String(process.env.APP_VERSION || process.env.npm_package_version || '').slice(0, 120);
const DEPLOYMENT_ID = String(process.env.DEPLOYMENT_ID || process.env.GITHUB_SHA || '').slice(0, 160);

function normalize(value) {
  if (value == null) return value;
  if (typeof value === 'bigint') return Number(value);
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === 'object') {
    if (typeof value.toNumber === 'function') return value.toNumber();
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(item)]));
  }
  return value;
}

function json(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function text(value, max = 20000) {
  return String(value ?? '').trim().slice(0, max);
}

function integer(value, fallback, min = 1, max = 86400) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function fail(status, message, code = 'RUNTIME_GOVERNANCE_ERROR', details = null) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = details;
  throw error;
}

function deterministicBucket(featureKey, identity) {
  const digest = createHash('sha256').update(`${featureKey}:${identity}`).digest('hex');
  return Number.parseInt(digest.slice(0, 8), 16) % 10000 / 100;
}

export function runtimeInstanceId() {
  return INSTANCE_ID;
}

export async function heartbeatRuntime({ status = 'HEALTHY', error = null, metadata = null } = {}) {
  const normalizedStatus = ['STARTING', 'HEALTHY', 'DEGRADED', 'DRAINING', 'STOPPED'].includes(String(status).toUpperCase())
    ? String(status).toUpperCase()
    : 'DEGRADED';
  await prisma.$executeRawUnsafe(
    `INSERT INTO platform_runtime_instance
       (instance_id, instance_role, hostname, process_id, app_version,
        deployment_id, status, started_at, last_seen_at, last_ready_at,
        last_error_at, last_error, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3),
             CASE WHEN ? = 'HEALTHY' THEN UTC_TIMESTAMP(3) ELSE NULL END,
             CASE WHEN ? IS NULL THEN NULL ELSE UTC_TIMESTAMP(3) END, ?, ?)
     ON DUPLICATE KEY UPDATE
       instance_role = VALUES(instance_role), hostname = VALUES(hostname),
       process_id = VALUES(process_id), app_version = VALUES(app_version),
       deployment_id = VALUES(deployment_id), status = VALUES(status),
       last_seen_at = UTC_TIMESTAMP(3),
       last_ready_at = CASE WHEN VALUES(status) = 'HEALTHY' THEN UTC_TIMESTAMP(3) ELSE last_ready_at END,
       last_error_at = CASE WHEN VALUES(last_error) IS NULL THEN last_error_at ELSE UTC_TIMESTAMP(3) END,
       last_error = VALUES(last_error), metadata_json = VALUES(metadata_json)`,
    INSTANCE_ID, INSTANCE_ROLE, os.hostname().slice(0, 240), process.pid,
    APP_VERSION, DEPLOYMENT_ID, normalizedStatus, normalizedStatus,
    error ? String(error).slice(0, 2000) : null,
    error ? String(error).slice(0, 2000) : null,
    metadata ? JSON.stringify(metadata) : null,
  );
  return { instanceId: INSTANCE_ID, role: INSTANCE_ROLE, status: normalizedStatus };
}

export async function acquireRuntimeLease(leaseKey, {
  ownerId = INSTANCE_ID,
  ttlSeconds = 120,
  metadata = null,
} = {}) {
  const key = text(leaseKey, 120);
  const owner = text(ownerId, 240);
  if (key.length < 3 || owner.length < 3) fail(400, 'Lease key and owner are required.', 'LEASE_IDENTITY_INVALID');
  const ttl = integer(ttlSeconds, 120, 5, 86400);
  return prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe(
      `INSERT IGNORE INTO platform_runtime_lease
         (lease_key, owner_id, lease_until, generation, metadata_json)
       VALUES (?, ?, UTC_TIMESTAMP(3), 1, ?)`,
      key, owner, metadata ? JSON.stringify(metadata) : null,
    );
    const rows = normalize(await tx.$queryRawUnsafe(
      `SELECT lease_key AS leaseKey, owner_id AS ownerId,
              lease_until AS leaseUntil, generation
         FROM platform_runtime_lease WHERE lease_key = ? LIMIT 1 FOR UPDATE`,
      key,
    ));
    const current = rows[0];
    const expired = !current?.leaseUntil || new Date(current.leaseUntil).getTime() <= Date.now();
    if (current.ownerId !== owner && !expired) {
      return { acquired: false, leaseKey: key, ownerId: current.ownerId, leaseUntil: current.leaseUntil, generation: current.generation };
    }
    const generation = current.ownerId === owner ? Number(current.generation || 1) : Number(current.generation || 0) + 1;
    await tx.$executeRawUnsafe(
      `UPDATE platform_runtime_lease
          SET owner_id = ?, lease_until = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ${ttl} SECOND),
              heartbeat_at = UTC_TIMESTAMP(3), generation = ?, metadata_json = ?
        WHERE lease_key = ?`,
      owner, generation, metadata ? JSON.stringify(metadata) : null, key,
    );
    const updated = normalize(await tx.$queryRawUnsafe(
      `SELECT lease_key AS leaseKey, owner_id AS ownerId,
              lease_until AS leaseUntil, generation, heartbeat_at AS heartbeatAt
         FROM platform_runtime_lease WHERE lease_key = ? LIMIT 1`,
      key,
    ));
    return { acquired: true, ...updated[0] };
  });
}

export async function renewRuntimeLease(leaseKey, { ownerId = INSTANCE_ID, ttlSeconds = 120 } = {}) {
  const ttl = integer(ttlSeconds, 120, 5, 86400);
  const changed = await prisma.$executeRawUnsafe(
    `UPDATE platform_runtime_lease
        SET lease_until = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ${ttl} SECOND),
            heartbeat_at = UTC_TIMESTAMP(3)
      WHERE lease_key = ? AND owner_id = ? AND lease_until > UTC_TIMESTAMP(3)`,
    text(leaseKey, 120), text(ownerId, 240),
  );
  return { renewed: Number(changed) === 1 };
}

export async function releaseRuntimeLease(leaseKey, ownerId = INSTANCE_ID) {
  const changed = await prisma.$executeRawUnsafe(
    `UPDATE platform_runtime_lease
        SET lease_until = UTC_TIMESTAMP(3), heartbeat_at = UTC_TIMESTAMP(3)
      WHERE lease_key = ? AND owner_id = ?`,
    text(leaseKey, 120), text(ownerId, 240),
  );
  return { released: Number(changed) === 1 };
}

export async function withRuntimeLease(leaseKey, operation, {
  ttlSeconds = 300,
  metadata = null,
  release = true,
} = {}) {
  const lease = await acquireRuntimeLease(leaseKey, { ttlSeconds, metadata });
  if (!lease.acquired) return { acquired: false, skipped: true, lease };
  await heartbeatRuntime({ status: 'HEALTHY', metadata: { leaseKey } }).catch(() => {});
  try {
    const result = await operation({ lease, instanceId: INSTANCE_ID });
    return { acquired: true, skipped: false, lease, result };
  } catch (error) {
    await heartbeatRuntime({ status: 'DEGRADED', error, metadata: { leaseKey } }).catch(() => {});
    throw error;
  } finally {
    if (release) await releaseRuntimeLease(leaseKey).catch(() => {});
  }
}

export async function evaluateFeatureFlag(featureKey, context = {}) {
  const key = text(featureKey, 160);
  const identity = text(context.userId || context.employeeId || context.sessionId || 'anonymous', 240) || 'anonymous';
  const branch = text(context.branch, 240);
  const processName = text(context.processName || context.process, 240);
  const lobName = text(context.lobName || context.lob, 240);
  const rows = normalize(await prisma.$queryRawUnsafe(
    `SELECT flag_id AS flagId, feature_key AS featureKey,
            display_name AS displayName, scope_type AS scopeType,
            scope_value AS scopeValue, enabled, kill_switch AS killSwitch,
            rollout_percentage AS rolloutPercentage, starts_at AS startsAt,
            ends_at AS endsAt, config_json AS configJson, version_no AS versionNo
       FROM platform_feature_flag
      WHERE feature_key = ? AND active = 1
        AND (starts_at IS NULL OR starts_at <= UTC_TIMESTAMP(3))
        AND (ends_at IS NULL OR ends_at > UTC_TIMESTAMP(3))
        AND (
          scope_type = 'GLOBAL' OR
          (scope_type = 'BRANCH' AND scope_value = ?) OR
          (scope_type = 'PROCESS' AND scope_value = ?) OR
          (scope_type = 'LOB' AND scope_value = ?) OR
          (scope_type = 'USER' AND scope_value = ?)
        )
      ORDER BY kill_switch DESC,
               FIELD(scope_type,'USER','LOB','PROCESS','BRANCH','GLOBAL'),
               version_no DESC`,
    key, branch, processName, lobName, identity,
  ));
  const kill = rows.find(item => Boolean(item.killSwitch));
  if (kill) return { featureKey: key, enabled: false, reason: 'KILL_SWITCH', matchedFlag: { ...kill, configJson: json(kill.configJson) }, bucket: null };
  const flag = rows[0];
  if (!flag) return { featureKey: key, enabled: false, reason: 'NO_ACTIVE_FLAG', matchedFlag: null, bucket: null };
  if (!flag.enabled) return { featureKey: key, enabled: false, reason: 'DISABLED', matchedFlag: { ...flag, configJson: json(flag.configJson) }, bucket: null };
  const bucket = deterministicBucket(key, identity);
  const enabled = bucket < Number(flag.rolloutPercentage || 0);
  return {
    featureKey: key,
    enabled,
    reason: enabled ? 'ROLLOUT_INCLUDED' : 'ROLLOUT_EXCLUDED',
    bucket,
    matchedFlag: { ...flag, configJson: json(flag.configJson) },
  };
}

export async function saveFeatureFlag({ flagId = null, actorId, body = {}, branchScope = null, company = false }) {
  const featureKey = text(body.featureKey, 160).toLowerCase().replace(/[^a-z0-9._-]+/g, '_');
  const displayName = text(body.displayName, 240);
  const scopeType = text(body.scopeType || 'GLOBAL', 20).toUpperCase();
  let scopeValue = scopeType === 'GLOBAL' ? '' : text(body.scopeValue, 240);
  if (!featureKey || !displayName) fail(400, 'Feature key and display name are required.', 'FEATURE_FIELDS_REQUIRED');
  if (!['GLOBAL', 'BRANCH', 'PROCESS', 'LOB', 'USER'].includes(scopeType)) fail(400, 'Select a valid rollout scope.', 'FEATURE_SCOPE_INVALID');
  if (scopeType !== 'GLOBAL' && !scopeValue) fail(400, 'Scoped feature flags require a scope value.', 'FEATURE_SCOPE_VALUE_REQUIRED');
  if (!company) {
    if (scopeType === 'GLOBAL') fail(403, 'Global rollout controls require company scope.', 'FEATURE_COMPANY_SCOPE_REQUIRED');
    if (scopeType === 'BRANCH') scopeValue = String(branchScope || '');
  }
  const rollout = Math.min(100, Math.max(0, Number(body.rolloutPercentage ?? 100)));
  const startsAt = body.startsAt ? new Date(body.startsAt) : null;
  const endsAt = body.endsAt ? new Date(body.endsAt) : null;
  if (startsAt && Number.isNaN(startsAt.getTime())) fail(400, 'Invalid rollout start date.', 'FEATURE_START_INVALID');
  if (endsAt && Number.isNaN(endsAt.getTime())) fail(400, 'Invalid rollout end date.', 'FEATURE_END_INVALID');
  if (startsAt && endsAt && endsAt <= startsAt) fail(400, 'Rollout end must be after start.', 'FEATURE_WINDOW_INVALID');
  const id = flagId || randomUUID();
  await prisma.$transaction(async tx => {
    if (flagId) {
      const rows = normalize(await tx.$queryRawUnsafe(
        `SELECT flag_id AS flagId, scope_type AS scopeType, scope_value AS scopeValue,
                version_no AS versionNo
           FROM platform_feature_flag WHERE flag_id = ? LIMIT 1 FOR UPDATE`,
        String(flagId),
      ));
      const existing = rows[0];
      if (!existing) fail(404, 'Feature flag not found.', 'FEATURE_FLAG_NOT_FOUND');
      if (!company && (existing.scopeType === 'GLOBAL' || existing.scopeValue !== String(branchScope || ''))) {
        fail(404, 'Feature flag not found in your rollout scope.', 'FEATURE_FLAG_NOT_FOUND');
      }
      const expectedVersion = integer(body.expectedVersion, Number(existing.versionNo), 1, 1000000000);
      if (expectedVersion !== Number(existing.versionNo)) fail(409, 'Feature flag changed since it was loaded.', 'FEATURE_VERSION_CONFLICT');
      await tx.$executeRawUnsafe(
        `UPDATE platform_feature_flag
            SET feature_key = ?, display_name = ?, description = ?, scope_type = ?,
                scope_value = ?, enabled = ?, kill_switch = ?, rollout_percentage = ?,
                starts_at = ?, ends_at = ?, config_json = ?, active = ?,
                version_no = version_no + 1, updated_by = ?
          WHERE flag_id = ?`,
        featureKey, displayName, text(body.description) || null, scopeType, scopeValue,
        body.enabled ? 1 : 0, body.killSwitch ? 1 : 0, rollout,
        startsAt, endsAt, body.configJson ? JSON.stringify(body.configJson) : null,
        body.active === false ? 0 : 1, String(actorId), String(flagId),
      );
    } else {
      await tx.$executeRawUnsafe(
        `INSERT INTO platform_feature_flag
           (flag_id, feature_key, display_name, description, scope_type,
            scope_value, enabled, kill_switch, rollout_percentage,
            starts_at, ends_at, config_json, version_no, active, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        id, featureKey, displayName, text(body.description) || null,
        scopeType, scopeValue, body.enabled ? 1 : 0, body.killSwitch ? 1 : 0,
        rollout, startsAt, endsAt, body.configJson ? JSON.stringify(body.configJson) : null,
        body.active === false ? 0 : 1, String(actorId),
      );
    }
  });
  const rows = normalize(await prisma.$queryRawUnsafe(
    `SELECT flag_id AS flagId, feature_key AS featureKey, display_name AS displayName,
            description, scope_type AS scopeType, scope_value AS scopeValue,
            enabled, kill_switch AS killSwitch, rollout_percentage AS rolloutPercentage,
            starts_at AS startsAt, ends_at AS endsAt, config_json AS configJson,
            version_no AS versionNo, active, created_by AS createdBy,
            updated_by AS updatedBy, created_at AS createdAt, updated_at AS updatedAt
       FROM platform_feature_flag WHERE flag_id = ? LIMIT 1`,
    id,
  ));
  return { ...rows[0], configJson: json(rows[0]?.configJson) };
}

export async function getRuntimeDashboard({ branch = null, company = false } = {}) {
  const [leases, instances, flags, eventBacklog, deliveryBacklog, appealBacklog] = await Promise.all([
    prisma.$queryRawUnsafe(
      `SELECT lease_key AS leaseKey, owner_id AS ownerId,
              lease_until AS leaseUntil, acquired_at AS acquiredAt,
              heartbeat_at AS heartbeatAt, generation, metadata_json AS metadataJson,
              CASE WHEN lease_until > UTC_TIMESTAMP(3) THEN 1 ELSE 0 END AS active
         FROM platform_runtime_lease ORDER BY active DESC, lease_key`,
    ),
    prisma.$queryRawUnsafe(
      `SELECT instance_id AS instanceId, instance_role AS instanceRole,
              hostname, process_id AS processId, app_version AS appVersion,
              deployment_id AS deploymentId, status, started_at AS startedAt,
              last_seen_at AS lastSeenAt, last_ready_at AS lastReadyAt,
              last_error_at AS lastErrorAt, last_error AS lastError,
              metadata_json AS metadataJson,
              CASE WHEN last_seen_at >= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 5 MINUTE) THEN 1 ELSE 0 END AS online
         FROM platform_runtime_instance ORDER BY online DESC, last_seen_at DESC LIMIT 500`,
    ),
    prisma.$queryRawUnsafe(
      `SELECT flag_id AS flagId, feature_key AS featureKey,
              display_name AS displayName, description,
              scope_type AS scopeType, scope_value AS scopeValue,
              enabled, kill_switch AS killSwitch,
              rollout_percentage AS rolloutPercentage,
              starts_at AS startsAt, ends_at AS endsAt,
              config_json AS configJson, version_no AS versionNo,
              active, updated_at AS updatedAt
         FROM platform_feature_flag
        ${company ? '' : "WHERE scope_type <> 'GLOBAL' AND scope_value = ?"}
        ORDER BY feature_key, FIELD(scope_type,'GLOBAL','BRANCH','PROCESS','LOB','USER'), scope_value`,
      ...(company ? [] : [String(branch || '')]),
    ),
    prisma.$queryRawUnsafe(
      `SELECT status, COUNT(*) AS count FROM notification_event
        WHERE status IN ('NEW','PROCESSING','FAILED') GROUP BY status`,
    ),
    prisma.$queryRawUnsafe(
      `SELECT status, COUNT(*) AS count FROM notification_outbox
        WHERE status IN ('PENDING','PROCESSING','FAILED','DEAD') GROUP BY status`,
    ),
    prisma.$queryRawUnsafe(
      `SELECT status, COUNT(*) AS count FROM evaluator_calibration_appeal
        WHERE status IN ('SUBMITTED','ACKNOWLEDGED','INFORMATION_REQUESTED','UNDER_REVIEW')
        ${company ? '' : 'AND branch = ?'} GROUP BY status`,
      ...(company ? [] : [String(branch || '')]),
    ),
  ]);
  return normalize({
    instanceId: INSTANCE_ID,
    scope: company ? 'company' : 'branch',
    leases: normalize(leases).map(item => ({ ...item, metadataJson: json(item.metadataJson) })),
    instances: normalize(instances).map(item => ({ ...item, metadataJson: json(item.metadataJson) })),
    flags: normalize(flags).map(item => ({ ...item, configJson: json(item.configJson) })),
    backlog: { notificationEvents: eventBacklog, notificationDeliveries: deliveryBacklog, calibrationAppeals: appealBacklog },
  });
}

export async function getRuntimeReadiness({ includeDetails = false } = {}) {
  const started = Date.now();
  const checks = {
    database: { ok: false },
    schema: { ok: false },
    uploadStorage: { ok: false },
    notificationBacklog: { ok: false },
    runtimeInstances: { ok: false },
  };
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = { ok: true };
  } catch (error) {
    checks.database = { ok: false, error: includeDetails ? error.message : undefined };
  }
  try {
    const rows = normalize(await prisma.$queryRawUnsafe(
      `SELECT COUNT(*) AS count FROM information_schema.tables
        WHERE table_schema = DATABASE()
          AND table_name IN ('platform_runtime_lease','platform_runtime_instance','platform_feature_flag')`,
    ));
    checks.schema = { ok: Number(rows[0]?.count || 0) === 3, tables: includeDetails ? Number(rows[0]?.count || 0) : undefined };
  } catch (error) {
    checks.schema = { ok: false, error: includeDetails ? error.message : undefined };
  }
  try {
    if (!fs.existsSync(contentUploadDir)) fs.mkdirSync(contentUploadDir, { recursive: true });
    fs.accessSync(contentUploadDir, fs.constants.W_OK);
    checks.uploadStorage = { ok: true };
  } catch (error) {
    checks.uploadStorage = { ok: false, error: includeDetails ? error.message : undefined };
  }
  try {
    const rows = normalize(await prisma.$queryRawUnsafe(
      `SELECT
          (SELECT COUNT(*) FROM notification_event WHERE status IN ('NEW','PROCESSING','FAILED')) AS eventCount,
          (SELECT COUNT(*) FROM notification_outbox WHERE status IN ('PENDING','PROCESSING','FAILED','DEAD')) AS deliveryCount`,
    ));
    const eventCount = Number(rows[0]?.eventCount || 0);
    const deliveryCount = Number(rows[0]?.deliveryCount || 0);
    const threshold = integer(process.env.LMS_READINESS_BACKLOG_LIMIT, 50000, 100, 10000000);
    checks.notificationBacklog = { ok: eventCount + deliveryCount <= threshold, eventCount: includeDetails ? eventCount : undefined, deliveryCount: includeDetails ? deliveryCount : undefined, threshold: includeDetails ? threshold : undefined };
  } catch (error) {
    checks.notificationBacklog = { ok: false, error: includeDetails ? error.message : undefined };
  }
  try {
    await heartbeatRuntime({ status: 'HEALTHY', metadata: { readiness: true } });
    const rows = normalize(await prisma.$queryRawUnsafe(
      `SELECT COUNT(*) AS count FROM platform_runtime_instance
        WHERE status IN ('HEALTHY','STARTING')
          AND last_seen_at >= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 5 MINUTE)`,
    ));
    checks.runtimeInstances = { ok: Number(rows[0]?.count || 0) >= 1, online: includeDetails ? Number(rows[0]?.count || 0) : undefined };
  } catch (error) {
    checks.runtimeInstances = { ok: false, error: includeDetails ? error.message : undefined };
  }
  const ok = Object.values(checks).every(item => item.ok);
  return { ok, service: 'lms-platform', instanceId: INSTANCE_ID, checks, durationMs: Date.now() - started, time: new Date().toISOString() };
}

let lastHeartbeatAt = 0;
export function runtimeHeartbeatMiddleware(req, res, next) {
  if (Date.now() - lastHeartbeatAt > 60_000) {
    lastHeartbeatAt = Date.now();
    res.on('finish', () => setImmediate(() => heartbeatRuntime({ status: res.statusCode >= 500 ? 'DEGRADED' : 'HEALTHY', metadata: { requestId: req.requestId } }).catch(() => {})));
  }
  next();
}

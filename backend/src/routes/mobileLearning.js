import { createHash, createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { Router } from 'express';
import { prisma } from '../utils/db.js';
import { requireSession, requireRole } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import { audit } from '../utils/audit.js';

const router = Router();
const traineeAuth = [requireSession, requireRole('trainee')];
const adminAuth = [requireSession, requireRole('admin')];
const coordinatorAuth = [requireSession, requireRole('coordinator')];
const SAFE_LANGUAGE = /^[a-z]{2,3}(?:-[A-Z]{2})?$/;
const ASSET_TYPES = new Set(['CAPTION', 'TRANSCRIPT', 'AUDIO_DESCRIPTION', 'EASY_READ', 'ALT_TEXT']);
const ASSET_FORMATS = new Set(['TEXT', 'VTT', 'SRT', 'URL', 'FILE_REFERENCE']);
const EVENT_TYPES = new Set(['OPEN', 'HEARTBEAT', 'PAUSE', 'CLOSE']);

function text(value, max = 500) {
  return String(value || '').trim().slice(0, max);
}

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return value === true || value === 1 || value === '1' || String(value).toLowerCase() === 'true';
}

function number(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function sha256(value) {
  return createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function hmac(value) {
  const secret = String(process.env.OFFLINE_PERMIT_SECRET || process.env.SESSION_SECRET || '');
  if (process.env.NODE_ENV === 'production' && secret.length < 32) throw new Error('OFFLINE_PERMIT_SECRET must contain at least 32 characters in production.');
  return createHmac('sha256', secret).update(String(value), 'utf8').digest('base64url');
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

function signPermit(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${hmac(encoded)}`;
}

function verifyPermit(token) {
  const [encoded, signature, extra] = String(token || '').split('.');
  if (!encoded || !signature || extra || !safeEqual(signature, hmac(encoded))) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (payload.v !== 1 || !payload.grantId || !payload.employeeId || !payload.contentId || !payload.deviceHash || !payload.exp) return null;
    if (Number(payload.exp) * 1000 <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function normalizeLanguage(value) {
  const language = text(value || 'en-IN', 20);
  return SAFE_LANGUAGE.test(language) ? language : 'en-IN';
}

function normalizedPreference(row = {}) {
  return {
    languageCode: row.languageCode || row.language_code || 'en-IN',
    textScale: Number(row.textScale ?? row.text_scale ?? 1),
    highContrast: Boolean(row.highContrast ?? row.high_contrast),
    reduceMotion: Boolean(row.reduceMotion ?? row.reduce_motion),
    captionsEnabled: row.captionsEnabled === undefined && row.captions_enabled === undefined ? true : Boolean(row.captionsEnabled ?? row.captions_enabled),
    transcriptPreferred: Boolean(row.transcriptPreferred ?? row.transcript_preferred),
    lowDataMode: Boolean(row.lowDataMode ?? row.low_data_mode),
    focusHighlight: row.focusHighlight === undefined && row.focus_highlight === undefined ? true : Boolean(row.focusHighlight ?? row.focus_highlight),
  };
}

async function contentRecord(contentId) {
  return prisma.contentMaster.findFirst({
    where: { contentId, active: true, module: { active: true } },
    include: { module: { include: { classroom: true } } },
  });
}

async function traineeCanAccess(employeeId, content) {
  const classroomId = content?.module?.classroomId;
  if (!classroomId) return false;
  const trainee = await prisma.traineeMaster.findUnique({
    where: { employeeId },
    select: { classroomId: true },
  });
  if (trainee?.classroomId === classroomId) return true;
  return Boolean(await prisma.traineeClassroomMap.findFirst({
    where: { employeeId, classroomId, active: true },
    select: { id: true },
  }));
}

function adminCanAccess(req, content) {
  const branch = content?.module?.classroom?.branch || null;
  return !req.userBranch || req.permissionScope === 'company' || String(branch || '') === String(req.userBranch);
}

async function coordinatorCanAccess(req, content) {
  return Boolean(await prisma.batchMaster.findFirst({
    where: {
      coordinatorLoginId: req.userId,
      classroomId: content.module.classroomId,
      batchStatus: 'Active',
    },
    select: { id: true },
  }));
}

function downloadDescriptor(content) {
  if (content.driveFileId) return { url: `/api/drive/proxy/${encodeURIComponent(content.driveFileId)}`, source: 'DRIVE' };
  const direct = text(content.directMediaUrl || content.localFilePath, 4000);
  const filename = direct.split('/').pop()?.split('?')[0];
  if (filename && /^[A-Za-z0-9._-]{1,255}$/.test(filename)) {
    return { url: `/api/content/files/${encodeURIComponent(filename)}`, source: 'LOCAL' };
  }
  return null;
}

async function approvedAssets(contentId, languageCode = null) {
  const params = [contentId];
  let languageClause = '';
  if (languageCode) {
    languageClause = 'AND language_code IN (?, ?)';
    params.push(languageCode, 'en-IN');
  }
  return prisma.$queryRawUnsafe(
    `SELECT asset_id AS assetId, content_id AS contentId, language_code AS languageCode,
            asset_type AS assetType, asset_format AS assetFormat,
            storage_reference AS storageReference, content_text AS contentText,
            source_hash AS sourceHash, version_no AS versionNo,
            reviewed_by AS reviewedBy, reviewed_at AS reviewedAt
       FROM content_accessibility_asset
      WHERE content_id = ? AND status = 'APPROVED' ${languageClause}
      ORDER BY language_code = ? DESC, asset_type`,
    ...params,
    languageCode || 'en-IN',
  );
}

router.get('/preferences', requireSession, async (req, res) => {
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT language_code AS languageCode, text_scale AS textScale,
              high_contrast AS highContrast, reduce_motion AS reduceMotion,
              captions_enabled AS captionsEnabled, transcript_preferred AS transcriptPreferred,
              low_data_mode AS lowDataMode, focus_highlight AS focusHighlight,
              updated_at AS updatedAt
         FROM user_accessibility_preference
        WHERE user_id = ? AND user_type = ? LIMIT 1`,
      req.userId, req.userType,
    );
    return res.json({ ok: true, data: normalizedPreference(rows[0]) });
  } catch (error) {
    console.error('[MOBILE] preference load failed:', error.message);
    return res.status(500).json({ ok: false, message: 'Could not load accessibility preferences.' });
  }
});

router.put('/preferences', requireSession, async (req, res) => {
  try {
    const preference = normalizedPreference({
      languageCode: normalizeLanguage(req.body?.languageCode),
      textScale: number(req.body?.textScale, 1, 0.85, 1.5),
      highContrast: bool(req.body?.highContrast),
      reduceMotion: bool(req.body?.reduceMotion),
      captionsEnabled: bool(req.body?.captionsEnabled, true),
      transcriptPreferred: bool(req.body?.transcriptPreferred),
      lowDataMode: bool(req.body?.lowDataMode),
      focusHighlight: bool(req.body?.focusHighlight, true),
    });
    await prisma.$executeRawUnsafe(
      `INSERT INTO user_accessibility_preference
         (preference_id, user_id, user_type, language_code, text_scale,
          high_contrast, reduce_motion, captions_enabled, transcript_preferred,
          low_data_mode, focus_highlight, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         language_code = VALUES(language_code), text_scale = VALUES(text_scale),
         high_contrast = VALUES(high_contrast), reduce_motion = VALUES(reduce_motion),
         captions_enabled = VALUES(captions_enabled), transcript_preferred = VALUES(transcript_preferred),
         low_data_mode = VALUES(low_data_mode), focus_highlight = VALUES(focus_highlight),
         updated_by = VALUES(updated_by)`,
      randomUUID(), req.userId, req.userType, preference.languageCode, preference.textScale,
      preference.highContrast ? 1 : 0, preference.reduceMotion ? 1 : 0,
      preference.captionsEnabled ? 1 : 0, preference.transcriptPreferred ? 1 : 0,
      preference.lowDataMode ? 1 : 0, preference.focusHighlight ? 1 : 0, req.userId,
    );
    return res.json({ ok: true, data: preference });
  } catch (error) {
    console.error('[MOBILE] preference update failed:', error.message);
    return res.status(500).json({ ok: false, message: 'Could not save accessibility preferences.' });
  }
});

router.get('/content/:contentId/accessibility', requireSession, async (req, res) => {
  try {
    const content = await contentRecord(text(req.params.contentId, 191));
    if (!content) return res.status(404).json({ ok: false, message: 'Content not found.' });
    if (req.userType === 'trainee' && !await traineeCanAccess(req.userId, content)) return res.status(403).json({ ok: false, message: 'Content is not assigned to you.' });
    if (req.userType === 'coordinator' && !await coordinatorCanAccess(req, content)) return res.status(403).json({ ok: false, message: 'Content is outside your owned batches.' });
    if (req.userType === 'admin' && !adminCanAccess(req, content)) return res.status(403).json({ ok: false, message: 'Content is outside your branch scope.' });
    const language = normalizeLanguage(req.query?.languageCode);
    const assets = await approvedAssets(content.contentId, language);
    return res.json({ ok: true, data: { contentId: content.contentId, contentTitle: content.contentTitle, languageCode: language, assets } });
  } catch (error) {
    console.error('[MOBILE] asset load failed:', error.message);
    return res.status(500).json({ ok: false, message: 'Could not load accessible alternatives.' });
  }
});

router.post('/offline/content/:contentId/grant', ...traineeAuth, async (req, res) => {
  try {
    const content = await contentRecord(text(req.params.contentId, 191));
    if (!content || !await traineeCanAccess(req.userId, content)) return res.status(404).json({ ok: false, message: 'Assigned content not found.' });
    const download = downloadDescriptor(content);
    if (!download) return res.status(409).json({ ok: false, message: 'This content source is not available for governed offline download.' });
    const rawDeviceId = text(req.body?.deviceId, 191);
    if (rawDeviceId.length < 16) return res.status(400).json({ ok: false, message: 'A stable device identifier is required.' });
    const deviceHash = sha256(`${req.userId}:${rawDeviceId}`);
    const hours = number(req.body?.hours, 72, 1, Number(process.env.OFFLINE_MAX_GRANT_HOURS || 168));
    const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);
    const maxSeconds = Math.min(259200, Math.max(3600, Number(content.estimatedMins || 60) * 60 * 3));

    await prisma.$executeRawUnsafe(
      `UPDATE offline_content_grant
          SET status = 'REVOKED', revoked_at = CURRENT_TIMESTAMP(3), revoked_by = ?,
              revocation_reason = 'Superseded by a new device-bound grant.'
        WHERE employee_id = ? AND content_id = ? AND device_id_hash = ? AND status = 'ACTIVE'`,
      req.userId, req.userId, content.contentId, deviceHash,
    );

    const grantId = randomUUID();
    const payload = {
      v: 1,
      grantId,
      employeeId: req.userId,
      contentId: content.contentId,
      deviceHash,
      exp: Math.floor(expiresAt.getTime() / 1000),
      maxOfflineSeconds: maxSeconds,
    };
    const permit = signPermit(payload);
    await prisma.$executeRawUnsafe(
      `INSERT INTO offline_content_grant
         (grant_id, employee_id, content_id, device_id_hash, permit_hash,
          expires_at, max_offline_seconds, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE')`,
      grantId, req.userId, content.contentId, deviceHash, sha256(permit), expiresAt, maxSeconds,
    );
    const preferences = await prisma.$queryRawUnsafe(
      `SELECT language_code AS languageCode FROM user_accessibility_preference WHERE user_id = ? AND user_type = 'trainee' LIMIT 1`,
      req.userId,
    );
    const languageCode = preferences[0]?.languageCode || 'en-IN';
    const assets = await approvedAssets(content.contentId, languageCode);
    await audit({ userIdentity: req.userId, userRole: 'Trainee', action: 'ISSUE_OFFLINE_CONTENT_GRANT', module: 'Mobile Learning', referenceId: grantId, details: content.contentId });
    return res.status(201).json({
      ok: true,
      data: {
        grantId,
        permit,
        expiresAt,
        maxOfflineSeconds: maxSeconds,
        downloadUrl: download.url,
        source: download.source,
        content: {
          contentId: content.contentId,
          contentTitle: content.contentTitle,
          contentType: content.contentType,
          estimatedMins: content.estimatedMins,
          playerMode: content.playerMode,
        },
        accessibilityAssets: assets,
        offlineCompletionPolicy: 'Progress is validated on reconnect; final completion requires an online acknowledgement.',
      },
    });
  } catch (error) {
    console.error('[MOBILE] offline grant failed:', error.message);
    return res.status(500).json({ ok: false, message: 'Could not prepare this content for offline learning.' });
  }
});

router.get('/offline/grants', ...traineeAuth, async (req, res) => {
  try {
    await prisma.$executeRawUnsafe(
      `UPDATE offline_content_grant SET status = 'EXPIRED'
        WHERE employee_id = ? AND status = 'ACTIVE' AND expires_at <= CURRENT_TIMESTAMP(3)`,
      req.userId,
    );
    const rows = await prisma.$queryRawUnsafe(
      `SELECT g.grant_id AS grantId, g.content_id AS contentId, c.content_title AS contentTitle,
              c.content_type AS contentType, g.issued_at AS issuedAt, g.expires_at AS expiresAt,
              g.max_offline_seconds AS maxOfflineSeconds, g.accepted_seconds AS acceptedSeconds,
              g.status, g.last_synced_at AS lastSyncedAt, g.revoked_at AS revokedAt,
              g.revocation_reason AS revocationReason
         FROM offline_content_grant g
         INNER JOIN content_master c ON c.content_id = g.content_id
        WHERE g.employee_id = ?
        ORDER BY g.created_at DESC LIMIT 200`,
      req.userId,
    );
    return res.json({ ok: true, data: rows });
  } catch (error) {
    console.error('[MOBILE] grant list failed:', error.message);
    return res.status(500).json({ ok: false, message: 'Could not load offline grants.' });
  }
});

router.post('/offline/grants/:grantId/revoke', ...traineeAuth, async (req, res) => {
  try {
    const reason = text(req.body?.reason || 'Removed from this device by learner.', 1000);
    const updated = await prisma.$executeRawUnsafe(
      `UPDATE offline_content_grant
          SET status = 'REVOKED', revoked_at = CURRENT_TIMESTAMP(3), revoked_by = ?, revocation_reason = ?
        WHERE grant_id = ? AND employee_id = ? AND status = 'ACTIVE'`,
      req.userId, reason, text(req.params.grantId, 36), req.userId,
    );
    return updated ? res.json({ ok: true }) : res.status(404).json({ ok: false, message: 'Active offline grant not found.' });
  } catch (error) {
    console.error('[MOBILE] grant revoke failed:', error.message);
    return res.status(500).json({ ok: false, message: 'Could not revoke this offline grant.' });
  }
});

router.post('/offline/sync', ...traineeAuth, async (req, res) => {
  try {
    const permit = text(req.body?.permit, 5000);
    const deviceId = text(req.body?.deviceId, 191);
    const events = Array.isArray(req.body?.events) ? req.body.events.slice(0, 100) : [];
    const payload = verifyPermit(permit);
    if (!payload || payload.employeeId !== req.userId || payload.deviceHash !== sha256(`${req.userId}:${deviceId}`)) {
      return res.status(401).json({ ok: false, message: 'Offline permit is invalid, expired or belongs to another device.' });
    }
    const content = await contentRecord(payload.contentId);
    if (!content || !await traineeCanAccess(req.userId, content)) return res.status(403).json({ ok: false, message: 'The learning assignment is no longer active.' });

    const grants = await prisma.$queryRawUnsafe(
      `SELECT grant_id AS grantId, employee_id AS employeeId, content_id AS contentId,
              device_id_hash AS deviceHash, permit_hash AS permitHash,
              issued_at AS issuedAt, expires_at AS expiresAt,
              max_offline_seconds AS maxOfflineSeconds, accepted_seconds AS acceptedSeconds,
              status
         FROM offline_content_grant WHERE grant_id = ? LIMIT 1`,
      payload.grantId,
    );
    const grant = grants[0];
    if (!grant || grant.status !== 'ACTIVE' || grant.permitHash !== sha256(permit) || new Date(grant.expiresAt) <= new Date()) {
      return res.status(409).json({ ok: false, message: 'Offline grant is no longer active.' });
    }

    const now = Date.now();
    const issued = new Date(grant.issuedAt).getTime();
    const expires = new Date(grant.expiresAt).getTime();
    let remaining = Math.max(0, Number(grant.maxOfflineSeconds) - Number(grant.acceptedSeconds));
    let acceptedSeconds = 0;
    let acceptedEvents = 0;
    let rejectedEvents = 0;
    let lastPosition = 0;
    let duration = 0;

    await prisma.$transaction(async tx => {
      for (const raw of events) {
        const sequence = Math.floor(number(raw?.sequence, 0, 1, 1_000_000));
        const eventType = text(raw?.eventType, 30).toUpperCase();
        const occurredAt = new Date(raw?.occurredAt);
        const occurredMs = occurredAt.getTime();
        const secondsRequested = Math.floor(number(raw?.secondsDelta, 0, 0, 120));
        const position = Math.floor(number(raw?.positionSeconds, 0, 0, 10_000_000));
        const eventDuration = Math.floor(number(raw?.durationSeconds, 0, 0, 10_000_000));
        const valid = sequence > 0 && EVENT_TYPES.has(eventType) && Number.isFinite(occurredMs)
          && occurredMs >= issued - 5 * 60_000 && occurredMs <= Math.min(expires, now + 5 * 60_000)
          && (!eventDuration || position <= eventDuration);
        const requestedAccepted = ['HEARTBEAT', 'CLOSE'].includes(eventType) ? Math.min(secondsRequested, 60, remaining) : 0;
        const accepted = valid && requestedAccepted >= 0;
        const eventHash = sha256(`${grant.grantId}:${sequence}:${occurredAt.toISOString?.() || raw?.occurredAt}:${eventType}:${secondsRequested}:${position}:${eventDuration}`);
        const inserted = await tx.$executeRawUnsafe(
          `INSERT IGNORE INTO offline_learning_event
             (event_id, event_hash, grant_id, employee_id, content_id, event_type,
              occurred_at, seconds_delta, position_seconds, duration_seconds,
              client_sequence, accepted, rejection_reason)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          randomUUID(), eventHash, grant.grantId, req.userId, content.contentId,
          EVENT_TYPES.has(eventType) ? eventType : 'HEARTBEAT',
          Number.isFinite(occurredMs) ? occurredAt : new Date(),
          valid ? requestedAccepted : 0, position, eventDuration, Math.max(1, sequence),
          accepted ? 1 : 0, valid ? null : 'Invalid timestamp, sequence, event type or playback position.',
        );
        if (!inserted) continue;
        if (accepted) {
          acceptedEvents += 1;
          acceptedSeconds += requestedAccepted;
          remaining -= requestedAccepted;
          lastPosition = Math.max(lastPosition, position);
          duration = Math.max(duration, eventDuration);
        } else {
          rejectedEvents += 1;
        }
      }
      await tx.$executeRawUnsafe(
        `UPDATE offline_content_grant
            SET accepted_seconds = LEAST(max_offline_seconds, accepted_seconds + ?),
                last_synced_at = CURRENT_TIMESTAMP(3),
                status = CASE WHEN expires_at <= CURRENT_TIMESTAMP(3) THEN 'EXPIRED' ELSE status END
          WHERE grant_id = ?`,
        acceptedSeconds, grant.grantId,
      );
      if (acceptedSeconds > 0) {
        const existing = await tx.contentProgress.findUnique({ where: { employeeId_contentId: { employeeId: req.userId, contentId: content.contentId } } });
        const requiredSeconds = Number(existing?.requiredSeconds || Math.max(60, Number(content.estimatedMins || 1) * 60));
        const total = Number(existing?.totalSecondsSpent || 0) + acceptedSeconds;
        const completionPct = Math.min(99, Math.round((total / requiredSeconds) * 100));
        if (existing) {
          await tx.contentProgress.update({
            where: { id: existing.id },
            data: {
              opened: true,
              totalSecondsSpent: total,
              lastPositionSeconds: Math.max(Number(existing.lastPositionSeconds || 0), lastPosition),
              mediaDurationSeconds: Math.max(Number(existing.mediaDurationSeconds || 0), duration),
              requiredSeconds,
              completionPct,
              completionStatus: 'In Progress',
              lastOpenedAt: new Date(),
            },
          });
        } else {
          await tx.contentProgress.create({
            data: {
              employeeId: req.userId,
              classroomId: content.module.classroomId,
              dayNo: content.module.dayNo || 0,
              moduleId: content.moduleId,
              contentId: content.contentId,
              opened: true,
              openCount: 1,
              firstOpenedAt: new Date(),
              lastOpenedAt: new Date(),
              totalSecondsSpent: total,
              lastPositionSeconds: lastPosition,
              mediaDurationSeconds: duration,
              requiredSeconds,
              completionPct,
              completionStatus: 'In Progress',
              playerMode: content.playerMode || 'Auto',
            },
          });
        }
        await tx.videoWatchLog.create({
          data: {
            employeeId: req.userId,
            batchNo: null,
            classroomId: content.module.classroomId,
            dayNo: content.module.dayNo || 0,
            moduleId: content.moduleId,
            contentId: content.contentId,
            event: 'OFFLINE_SYNC',
            secondsDelta: acceptedSeconds,
            positionSeconds: lastPosition,
            durationSeconds: duration,
            completionPct,
            playerMode: content.playerMode || 'Auto',
            details: `Server-validated offline sync from grant ${grant.grantId}`,
          },
        });
      }
    });

    await audit({ userIdentity: req.userId, userRole: 'Trainee', action: 'SYNC_OFFLINE_LEARNING', module: 'Mobile Learning', referenceId: grant.grantId, details: JSON.stringify({ acceptedEvents, rejectedEvents, acceptedSeconds }) });
    return res.json({
      ok: true,
      data: {
        grantId: grant.grantId,
        acceptedEvents,
        rejectedEvents,
        acceptedSeconds,
        remainingSeconds: Math.max(0, remaining),
        requiresOnlineCompletion: true,
        message: acceptedSeconds > 0 ? 'Offline activity validated. Final completion still requires an online acknowledgement.' : 'No new offline activity was accepted.',
      },
    });
  } catch (error) {
    console.error('[MOBILE] offline sync failed:', error);
    return res.status(500).json({ ok: false, message: 'Could not validate offline learning activity.' });
  }
});

router.get('/admin/coverage', ...adminAuth, requirePermission('accessibility.analytics.view'), async (req, res) => {
  try {
    const params = [];
    let branchClause = '';
    if (req.userBranch && req.permissionScope !== 'company') {
      branchClause = 'AND cl.branch = ?';
      params.push(req.userBranch);
    }
    const rows = await prisma.$queryRawUnsafe(
      `SELECT cl.branch, cl.process, cl.lob,
              COUNT(DISTINCT c.content_id) AS totalContent,
              COUNT(DISTINCT CASE WHEN a.asset_type = 'CAPTION' AND a.status = 'APPROVED' THEN c.content_id END) AS captionedContent,
              COUNT(DISTINCT CASE WHEN a.asset_type = 'TRANSCRIPT' AND a.status = 'APPROVED' THEN c.content_id END) AS transcriptContent,
              COUNT(DISTINCT CASE WHEN a.asset_type = 'ALT_TEXT' AND a.status = 'APPROVED' THEN c.content_id END) AS altTextContent,
              COUNT(DISTINCT CASE WHEN g.status = 'ACTIVE' THEN g.grant_id END) AS activeOfflineGrants,
              COALESCE(SUM(g.accepted_seconds), 0) AS acceptedOfflineSeconds
         FROM content_master c
         INNER JOIN module_master m ON m.module_id = c.module_id
         INNER JOIN classroom_master cl ON cl.classroom_id = m.classroom_id
         LEFT JOIN content_accessibility_asset a ON a.content_id = c.content_id
         LEFT JOIN offline_content_grant g ON g.content_id = c.content_id
        WHERE c.active = 1 AND m.active = 1 ${branchClause}
        GROUP BY cl.branch, cl.process, cl.lob
        ORDER BY cl.branch, cl.process, cl.lob`,
      ...params,
    );
    return res.json({ ok: true, data: rows });
  } catch (error) {
    console.error('[MOBILE] coverage failed:', error.message);
    return res.status(500).json({ ok: false, message: 'Could not load accessibility coverage.' });
  }
});

router.get('/admin/content/:contentId/assets', ...adminAuth, requirePermission('accessibility.assets.manage'), async (req, res) => {
  try {
    const content = await contentRecord(text(req.params.contentId, 191));
    if (!content || !adminCanAccess(req, content)) return res.status(404).json({ ok: false, message: 'Content not found in your scope.' });
    const assets = await prisma.$queryRawUnsafe(
      `SELECT asset_id AS assetId, content_id AS contentId, language_code AS languageCode,
              asset_type AS assetType, asset_format AS assetFormat,
              storage_reference AS storageReference, content_text AS contentText,
              source_hash AS sourceHash, status, version_no AS versionNo,
              created_by AS createdBy, reviewed_by AS reviewedBy,
              reviewed_at AS reviewedAt, retired_by AS retiredBy,
              retired_at AS retiredAt, retirement_reason AS retirementReason,
              created_at AS createdAt, updated_at AS updatedAt
         FROM content_accessibility_asset WHERE content_id = ?
        ORDER BY asset_type, language_code, version_no DESC`,
      content.contentId,
    );
    return res.json({ ok: true, data: { content: { contentId: content.contentId, contentTitle: content.contentTitle }, assets } });
  } catch (error) {
    console.error('[MOBILE] asset studio failed:', error.message);
    return res.status(500).json({ ok: false, message: 'Could not load accessibility assets.' });
  }
});

router.post('/admin/content/:contentId/assets', ...adminAuth, requirePermission('accessibility.assets.manage'), async (req, res) => {
  try {
    const content = await contentRecord(text(req.params.contentId, 191));
    if (!content || !adminCanAccess(req, content)) return res.status(404).json({ ok: false, message: 'Content not found in your scope.' });
    const assetType = text(req.body?.assetType, 40).toUpperCase();
    const assetFormat = text(req.body?.assetFormat || 'TEXT', 30).toUpperCase();
    const languageCode = normalizeLanguage(req.body?.languageCode);
    const contentText = text(req.body?.contentText, 100000) || null;
    const storageReference = text(req.body?.storageReference, 4000) || null;
    if (!ASSET_TYPES.has(assetType) || !ASSET_FORMATS.has(assetFormat)) return res.status(400).json({ ok: false, message: 'Valid asset type and format are required.' });
    if (!contentText && !storageReference) return res.status(400).json({ ok: false, message: 'Accessible text or a governed storage reference is required.' });
    const existing = await prisma.$queryRawUnsafe(
      `SELECT asset_id AS assetId, status, version_no AS versionNo
         FROM content_accessibility_asset
        WHERE content_id = ? AND language_code = ? AND asset_type = ?
        ORDER BY version_no DESC LIMIT 1`,
      content.contentId, languageCode, assetType,
    );
    if (existing[0] && ['DRAFT', 'IN_REVIEW', 'APPROVED'].includes(existing[0].status)) {
      return res.status(409).json({ ok: false, message: 'Retire or reject the active asset before creating a new version.' });
    }
    const versionNo = Number(existing[0]?.versionNo || 0) + 1;
    const assetId = randomUUID();
    const sourceHash = sha256(`${assetFormat}:${contentText || storageReference}`);
    await prisma.$executeRawUnsafe(
      `INSERT INTO content_accessibility_asset
         (asset_id, content_id, language_code, asset_type, asset_format,
          storage_reference, content_text, source_hash, status, version_no, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?)`,
      assetId, content.contentId, languageCode, assetType, assetFormat,
      storageReference, contentText, sourceHash, versionNo, req.userId,
    );
    await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'CREATE_ACCESSIBILITY_ASSET', module: 'Accessibility', referenceId: assetId, details: `${content.contentId}:${assetType}:${languageCode}` });
    return res.status(201).json({ ok: true, data: { assetId, versionNo } });
  } catch (error) {
    console.error('[MOBILE] asset create failed:', error.message);
    return res.status(500).json({ ok: false, message: 'Could not create the accessibility asset.' });
  }
});

router.post('/admin/assets/:assetId/submit-review', ...adminAuth, requirePermission('accessibility.assets.manage'), async (req, res) => {
  const updated = await prisma.$executeRawUnsafe(
    `UPDATE content_accessibility_asset SET status = 'IN_REVIEW'
      WHERE asset_id = ? AND status = 'DRAFT'`,
    text(req.params.assetId, 36),
  );
  return updated ? res.json({ ok: true }) : res.status(409).json({ ok: false, message: 'Only draft assets may enter review.' });
});

router.post('/admin/assets/:assetId/approve', ...adminAuth, requirePermission('accessibility.assets.manage'), async (req, res) => {
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT a.asset_id AS assetId, a.content_id AS contentId, a.status
         FROM content_accessibility_asset a WHERE a.asset_id = ? LIMIT 1`,
      text(req.params.assetId, 36),
    );
    const asset = rows[0];
    const content = asset ? await contentRecord(asset.contentId) : null;
    if (!asset || !content || !adminCanAccess(req, content)) return res.status(404).json({ ok: false, message: 'Asset not found in your scope.' });
    const updated = await prisma.$executeRawUnsafe(
      `UPDATE content_accessibility_asset
          SET status = 'APPROVED', reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP(3)
        WHERE asset_id = ? AND status = 'IN_REVIEW'`,
      req.userId, asset.assetId,
    );
    if (!updated) return res.status(409).json({ ok: false, message: 'Only assets in review may be approved.' });
    await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'APPROVE_ACCESSIBILITY_ASSET', module: 'Accessibility', referenceId: asset.assetId });
    return res.json({ ok: true });
  } catch (error) {
    console.error('[MOBILE] asset approval failed:', error.message);
    return res.status(500).json({ ok: false, message: 'Could not approve the accessibility asset.' });
  }
});

router.post('/admin/assets/:assetId/retire', ...adminAuth, requirePermission('accessibility.assets.manage'), async (req, res) => {
  try {
    const reason = text(req.body?.reason, 4000);
    if (reason.length < 20) return res.status(400).json({ ok: false, message: 'A detailed retirement reason is required.' });
    const rows = await prisma.$queryRawUnsafe(
      `SELECT a.asset_id AS assetId, a.content_id AS contentId, a.status
         FROM content_accessibility_asset a WHERE a.asset_id = ? LIMIT 1`,
      text(req.params.assetId, 36),
    );
    const asset = rows[0];
    const content = asset ? await contentRecord(asset.contentId) : null;
    if (!asset || !content || !adminCanAccess(req, content)) return res.status(404).json({ ok: false, message: 'Asset not found in your scope.' });
    await prisma.$executeRawUnsafe(
      `UPDATE content_accessibility_asset
          SET status = 'RETIRED', retired_by = ?, retired_at = CURRENT_TIMESTAMP(3), retirement_reason = ?
        WHERE asset_id = ? AND status IN ('DRAFT','IN_REVIEW','APPROVED')`,
      req.userId, reason, asset.assetId,
    );
    await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'RETIRE_ACCESSIBILITY_ASSET', module: 'Accessibility', referenceId: asset.assetId, details: reason });
    return res.json({ ok: true });
  } catch (error) {
    console.error('[MOBILE] asset retirement failed:', error.message);
    return res.status(500).json({ ok: false, message: 'Could not retire the accessibility asset.' });
  }
});

router.get('/coordinator/analytics', ...coordinatorAuth, requirePermission('accessibility.analytics.view'), async (req, res) => {
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT b.batch_no AS batchNo, b.batch_name AS batchName,
              b.branch, b.process, b.lob,
              COUNT(DISTINCT c.content_id) AS totalContent,
              COUNT(DISTINCT CASE WHEN a.asset_type = 'CAPTION' AND a.status = 'APPROVED' THEN c.content_id END) AS captionedContent,
              COUNT(DISTINCT CASE WHEN a.asset_type = 'TRANSCRIPT' AND a.status = 'APPROVED' THEN c.content_id END) AS transcriptContent,
              COUNT(DISTINCT g.employee_id) AS offlineLearners,
              COALESCE(SUM(g.accepted_seconds), 0) AS acceptedOfflineSeconds
         FROM batch_master b
         INNER JOIN module_master m ON m.classroom_id = b.classroom_id AND m.active = 1
         INNER JOIN content_master c ON c.module_id = m.module_id AND c.active = 1
         LEFT JOIN content_accessibility_asset a ON a.content_id = c.content_id
         LEFT JOIN offline_content_grant g ON g.content_id = c.content_id AND g.status IN ('ACTIVE','EXPIRED','CONSUMED')
        WHERE b.coordinator_login_id = ? AND b.batch_status = 'Active'
        GROUP BY b.batch_no, b.batch_name, b.branch, b.process, b.lob
        ORDER BY b.start_date DESC`,
      req.userId,
    );
    return res.json({ ok: true, data: rows });
  } catch (error) {
    console.error('[MOBILE] coordinator analytics failed:', error.message);
    return res.status(500).json({ ok: false, message: 'Could not load mobile-learning evidence.' });
  }
});

export default router;

import { prisma } from '../utils/db.js';

const LEGACY_ROLE_PERMISSIONS = {
  admin: ['*'],
  management: ['management.view'],
  trainee: ['trainee.view'],
};

const DATABASE_PERMISSION_PREFIXES = ['access.', 'talent.', 'development.', 'ilt.'];
const CACHE_TTL_MS = 60_000;
const permissionCache = new Map();
const VALID_SCOPES = new Set(['self', 'own_batch', 'branch', 'company']);

function roleKeyFor(req) {
  if (req.userType === 'admin') return String(req.adminInfo?.role || 'Admin').trim() || 'Admin';
  if (req.userType === 'coordinator') return String(req.coordinator?.role || 'Coordinator').trim() || 'Coordinator';
  if (req.userType === 'trainee') return 'Trainee';
  return String(req.userType || 'Unknown');
}

function normalizedScope(value) {
  const scope = String(value || 'self').toLowerCase();
  return VALID_SCOPES.has(scope) ? scope : 'self';
}

function usesDatabasePermission(permissionKey) {
  return DATABASE_PERMISSION_PREFIXES.some(prefix => String(permissionKey).startsWith(prefix));
}

function permissionCacheKey(req, permissionKey) {
  return `${req.userType}:${req.userId}:${roleKeyFor(req)}:${permissionKey}`;
}

export function clearPermissionCache(userId = null) {
  if (!userId) {
    permissionCache.clear();
    return;
  }
  for (const key of permissionCache.keys()) {
    if (key.includes(`:${userId}:`)) permissionCache.delete(key);
  }
}

async function getLegacyPermissions(req) {
  if (!req.userType) return [];
  const base = LEGACY_ROLE_PERMISSIONS[req.userType] || [];
  if (req.userType !== 'coordinator') return base;

  const user = req.coordinator || await prisma.roleAccessMatrix.findFirst({
    where: { loginId: req.userId, active: true },
    select: {
      role: true,
      canCreateBatch: true,
      canOnboardTrainee: true,
      canUploadLmsReport: true,
      canOverrideAttendance: true,
      canCloseBatch: true,
      canViewManagementDashboard: true,
    },
  });

  if (!user) return [];
  if (['CEO', 'Super Admin', 'SuperAdmin'].includes(user.role)) return ['*'];

  const permissions = ['coordinator.view'];
  if (user.canCreateBatch) permissions.push('batch.create');
  if (user.canOnboardTrainee) permissions.push('trainee.onboard');
  if (user.canUploadLmsReport) permissions.push('report.upload');
  if (user.canOverrideAttendance) permissions.push('attendance.override');
  if (user.canCloseBatch) permissions.push('batch.close');
  if (user.canViewManagementDashboard) permissions.push('management.view');
  return permissions;
}

export async function resolvePermission(req, permissionKey) {
  const cacheKey = permissionCacheKey(req, permissionKey);
  const cached = permissionCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const overrides = await prisma.$queryRawUnsafe(
    `SELECT allowed, data_scope AS dataScope
       FROM user_permission_override
      WHERE user_id = ?
        AND user_type = ?
        AND permission_key = ?
        AND (expires_at IS NULL OR expires_at > UTC_TIMESTAMP(3))
      LIMIT 1`,
    String(req.userId), String(req.userType), String(permissionKey),
  );

  let value;
  if (overrides.length) {
    value = {
      allowed: Boolean(overrides[0].allowed),
      dataScope: normalizedScope(overrides[0].dataScope),
      source: 'user_override',
      permissionKey,
    };
  } else {
    const roleKey = roleKeyFor(req);
    const grants = await prisma.$queryRawUnsafe(
      `SELECT allowed, data_scope AS dataScope, role_key AS roleKey
         FROM role_permission
        WHERE user_type = ?
          AND role_key IN (?, '*')
          AND permission_key = ?
        ORDER BY CASE WHEN role_key = ? THEN 0 ELSE 1 END
        LIMIT 1`,
      String(req.userType), roleKey, String(permissionKey), roleKey,
    );
    value = grants.length
      ? {
          allowed: Boolean(grants[0].allowed),
          dataScope: normalizedScope(grants[0].dataScope),
          source: grants[0].roleKey === '*' ? 'role_default' : 'role_grant',
          permissionKey,
        }
      : { allowed: false, dataScope: 'self', source: 'none', permissionKey };
  }

  permissionCache.set(cacheKey, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

export async function getUserPermissions(req) {
  const legacy = await getLegacyPermissions(req);
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT permission_key AS permissionKey
         FROM permission_master
        WHERE active = 1
        ORDER BY permission_key`,
    );
    const database = [];
    for (const row of rows) {
      const resolved = await resolvePermission(req, row.permissionKey);
      if (resolved.allowed) database.push(row.permissionKey);
    }
    return [...new Set([...legacy, ...database])];
  } catch (error) {
    console.warn('[PERMISSION] Database permission tables unavailable:', error.message);
    return legacy;
  }
}

export function requirePermission(permissionKey, options = {}) {
  return async (req, res, next) => {
    try {
      if (!usesDatabasePermission(permissionKey)) {
        const legacy = await getLegacyPermissions(req);
        if (legacy.includes('*') || legacy.includes(permissionKey)) return next();
        return res.status(403).json({ ok: false, message: options.message || 'Access denied.' });
      }

      const permission = await resolvePermission(req, permissionKey);
      if (!permission.allowed) {
        return res.status(403).json({
          ok: false,
          message: options.message || 'You do not have permission to perform this action.',
          permission: permissionKey,
        });
      }
      req.permission = permission;
      req.permissionScope = permission.dataScope;
      return next();
    } catch (error) {
      console.error(`[PERMISSION] ${permissionKey} lookup failed:`, error.message);
      return res.status(503).json({
        ok: false,
        message: 'Permission service is not ready. Apply the latest database migrations.',
      });
    }
  };
}

export async function listEffectivePermissions(req) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT permission_key AS permissionKey, module_name AS moduleName,
            action_name AS actionName, description, risk_level AS riskLevel
       FROM permission_master
      WHERE active = 1
      ORDER BY module_name, action_name`,
  );
  const resolved = [];
  for (const row of rows) {
    const permission = await resolvePermission(req, row.permissionKey);
    if (permission.allowed) resolved.push({ ...row, ...permission });
  }
  return resolved;
}

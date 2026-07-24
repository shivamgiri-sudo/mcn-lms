import { prisma } from '../utils/db.js';

const LEGACY_ROLE_PERMISSIONS = {
  admin: ['*'],
  management: ['management.view'],
  trainee: ['trainee.view'],
};

const DATABASE_PERMISSION_PREFIXES = ['access.', 'talent.', 'development.', 'ilt.', 'notify.', 'calendar.', 'practical.'];
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
  const direct = LEGACY_ROLE_PERMISSIONS[req.userType] || [];
  if (direct.includes('*')) return ['*'];
  return direct;
}

async function resolveDatabasePermission(req, permissionKey) {
  const key = permissionCacheKey(req, permissionKey);
  const cached = permissionCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const userId = String(req.userId || '');
  const userType = String(req.userType || '');
  const roleKey = roleKeyFor(req);

  const overrideRows = await prisma.$queryRawUnsafe(
    `SELECT allowed, data_scope AS dataScope
       FROM user_permission_override
      WHERE user_id = ? AND user_type = ? AND permission_key = ?
        AND (expires_at IS NULL OR expires_at > UTC_TIMESTAMP(3))
      LIMIT 1`,
    userId, userType, String(permissionKey),
  );

  let value;
  if (overrideRows.length) {
    value = {
      allowed: Boolean(overrideRows[0].allowed),
      dataScope: normalizedScope(overrideRows[0].dataScope),
      source: 'user_override',
    };
  } else {
    const roleRows = await prisma.$queryRawUnsafe(
      `SELECT allowed, data_scope AS dataScope, role_key AS roleKey
         FROM role_permission
        WHERE user_type = ? AND permission_key = ? AND role_key IN (?, '*')
        ORDER BY CASE WHEN role_key = ? THEN 0 ELSE 1 END
        LIMIT 1`,
      userType, String(permissionKey), roleKey, roleKey,
    );
    value = roleRows.length
      ? {
          allowed: Boolean(roleRows[0].allowed),
          dataScope: normalizedScope(roleRows[0].dataScope),
          source: 'role_grant',
        }
      : { allowed: false, dataScope: 'self', source: 'none' };
  }

  permissionCache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

export async function getPermission(req, permissionKey) {
  if (!usesDatabasePermission(permissionKey)) {
    const legacy = await getLegacyPermissions(req);
    return {
      allowed: legacy.includes('*') || legacy.includes(permissionKey),
      dataScope: req.userType === 'admin' ? 'company' : req.userType === 'coordinator' ? 'own_batch' : 'self',
      source: 'legacy',
    };
  }
  return resolveDatabasePermission(req, permissionKey);
}

export function requirePermission(permissionKey) {
  return async (req, res, next) => {
    try {
      const permission = await getPermission(req, permissionKey);
      if (!permission.allowed) {
        return res.status(403).json({ ok: false, message: 'You do not have permission to perform this action.' });
      }
      req.permission = permission;
      req.permissionScope = permission.dataScope;
      return next();
    } catch (error) {
      console.error(`[Permissions] ${permissionKey}:`, error.message);
      return res.status(500).json({ ok: false, message: 'Permission check failed.' });
    }
  };
}

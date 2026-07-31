import { Router } from 'express';
import { randomUUID } from 'crypto';
import { prisma } from '../utils/db.js';
import { requirePermission } from '../middleware/permissions.js';
import { requireRole, requireSession } from '../middleware/auth.js';
import { audit } from '../utils/audit.js';
import {
  createCalendarFeedToken,
  generateCalendarFeed,
  listCalendarFeedTokens,
  revokeCalendarFeedToken,
} from '../services/calendarFeeds.js';

const router = Router();
const adminAuth = [requireSession, requireRole('admin')];
const PROVIDERS = new Set(['MANUAL', 'GOOGLE_MEET', 'MICROSOFT_TEAMS', 'CUSTOM_WEBHOOK']);
const CREDENTIAL_SOURCES = new Set(['ENVIRONMENT', 'OAUTH_CONNECTION', 'NONE']);

function route(handler) {
  return async (req, res) => {
    try {
      return await handler(req, res);
    } catch (error) {
      console.error(`[CALENDAR] ${req.method} ${req.originalUrl}:`, error.message);
      const status = Number(error.status || 500);
      return res.status(status).json({
        ok: false,
        message: status >= 500 ? 'Calendar service failed.' : error.message,
        code: error.code || 'CALENDAR_ERROR',
      });
    }
  };
}

function text(value, max = 500) {
  return String(value || '').trim().slice(0, max);
}

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return value === true || value === 1 || value === '1' || String(value).toLowerCase() === 'true';
}

function date(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function companyScope(req) {
  return req.permissionScope === 'company' || (!req.userBranch && ['Super Admin', 'SuperAdmin', 'CEO'].includes(req.adminInfo?.role));
}

function defaultFeedScope(req) {
  if (req.userType === 'trainee') return 'SELF';
  if (req.userType === 'coordinator') return 'OWN_BATCH';
  return companyScope(req) ? 'COMPANY' : 'BRANCH';
}

router.get('/feed/:token.ics', route(async (req, res) => {
  const token = text(req.params.token, 200);
  if (!token) return res.status(404).send('Calendar feed not found.');
  try {
    const result = await generateCalendarFeed(token, {
      ip: req.ip || req.socket?.remoteAddress || '',
      userAgent: req.headers['user-agent'] || '',
    });
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `inline; filename="${String(result.feed.label || 'mcn-lms-calendar').replace(/[^a-z0-9_-]+/gi, '-')}.ics"`);
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.status(200).send(result.calendar);
  } catch (error) {
    if (error.status === 404) return res.status(404).send('Calendar feed is invalid, expired or revoked.');
    throw error;
  }
}));

router.get('/self/tokens', requireSession, requirePermission('calendar.feed_self'), route(async (req, res) => {
  return res.json({ ok: true, data: await listCalendarFeedTokens(req.userType, req.userId) });
}));

router.post('/self/tokens', requireSession, requirePermission('calendar.feed_self'), route(async (req, res) => {
  const feedScope = defaultFeedScope(req);
  const result = await createCalendarFeedToken({
    userType: req.userType,
    userId: req.userId,
    feedScope,
    branch: req.userBranch || '',
    timezone: text(req.body?.timezone, 80) || 'Asia/Kolkata',
    label: text(req.body?.label, 120) || 'MCN LMS Calendar',
    expiresAt: date(req.body?.expiresAt),
    createdBy: req.userId,
  });
  const feedUrl = `/api/calendar/feed/${encodeURIComponent(result.token)}.ics`;
  await audit({
    userIdentity: req.userId,
    userRole: req.userType,
    action: 'CREATE_CALENDAR_FEED',
    module: 'Calendar',
    referenceId: result.tokenId,
    newValue: { feedScope, tokenPrefix: result.tokenPrefix, expiresAt: result.expiresAt },
  });
  return res.status(201).json({
    ok: true,
    data: { ...result, feedUrl },
    message: 'Calendar feed created. Copy the URL now; the secret token will not be shown again.',
  });
}));

router.delete('/self/tokens/:tokenId', requireSession, requirePermission('calendar.feed_self'), route(async (req, res) => {
  const result = await revokeCalendarFeedToken({
    tokenId: req.params.tokenId,
    userType: req.userType,
    userId: req.userId,
  });
  if (!result.revoked) return res.status(404).json({ ok: false, message: 'Calendar feed token not found.' });
  await audit({ userIdentity: req.userId, userRole: req.userType, action: 'REVOKE_CALENDAR_FEED', module: 'Calendar', referenceId: req.params.tokenId });
  return res.json({ ok: true, data: result, message: 'Calendar feed revoked immediately.' });
}));

router.get('/admin/providers', ...adminAuth, requirePermission('calendar.manage_scope'), route(async (req, res) => {
  const branch = companyScope(req) ? text(req.query?.branch, 120) : String(req.userBranch || '');
  const rows = await prisma.$queryRawUnsafe(
    `SELECT provider_config_id AS providerConfigId, provider, branch,
            display_name AS displayName, credential_source AS credentialSource,
            organizer_user_id AS organizerUserId,
            default_timezone AS defaultTimezone,
            auto_create_for_virtual AS autoCreateForVirtual,
            active, config_json AS configJson, updated_at AS updatedAt
       FROM meeting_provider_config
      WHERE (? = '' OR branch IN ('', ?))
      ORDER BY branch, provider`,
    branch, branch,
  );
  return res.json({ ok: true, data: rows });
}));

router.put('/admin/providers', ...adminAuth, requirePermission('calendar.manage_scope'), route(async (req, res) => {
  const provider = text(req.body?.provider, 30).toUpperCase();
  const credentialSource = text(req.body?.credentialSource, 30).toUpperCase() || 'NONE';
  if (!PROVIDERS.has(provider) || !CREDENTIAL_SOURCES.has(credentialSource)) {
    return res.status(400).json({ ok: false, message: 'Valid provider and credential source are required.' });
  }
  const branch = companyScope(req) ? text(req.body?.branch, 120) : String(req.userBranch || '');
  const config = req.body?.config && typeof req.body.config === 'object' ? req.body.config : {};
  const forbiddenKeys = Object.keys(config).filter(key => /secret|password|token|private.?key|client.?secret/i.test(key));
  if (forbiddenKeys.length) {
    return res.status(400).json({ ok: false, message: 'Provider secrets must be supplied through protected environment or OAuth connections, never stored in this configuration.' });
  }
  await prisma.$executeRawUnsafe(
    `INSERT INTO meeting_provider_config
       (provider_config_id, provider, branch, display_name, credential_source,
        organizer_user_id, default_timezone, auto_create_for_virtual,
        active, config_json, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       display_name = VALUES(display_name), credential_source = VALUES(credential_source),
       organizer_user_id = VALUES(organizer_user_id), default_timezone = VALUES(default_timezone),
       auto_create_for_virtual = VALUES(auto_create_for_virtual), active = VALUES(active),
       config_json = VALUES(config_json), created_by = VALUES(created_by)`,
    randomUUID(), provider, branch,
    text(req.body?.displayName, 120) || provider,
    credentialSource, text(req.body?.organizerUserId, 240) || null,
    text(req.body?.defaultTimezone, 80) || 'Asia/Kolkata',
    bool(req.body?.autoCreateForVirtual, false) ? 1 : 0,
    bool(req.body?.active, false) ? 1 : 0,
    JSON.stringify(config), String(req.userId),
  );
  await audit({
    userIdentity: req.userId,
    userRole: 'admin',
    action: 'SAVE_MEETING_PROVIDER_POLICY',
    module: 'Calendar',
    referenceId: `${provider}:${branch}`,
    newValue: { ...req.body, config },
  });
  return res.json({ ok: true, message: 'Meeting-provider policy saved without storing credentials.' });
}));

router.get('/admin/access-log', ...adminAuth, requirePermission('calendar.manage_scope'), route(async (req, res) => {
  const branch = companyScope(req) ? '' : String(req.userBranch || '');
  const rows = await prisma.$queryRawUnsafe(
    `SELECT l.access_id AS accessId, l.requested_at AS requestedAt,
            l.event_count AS eventCount, l.status, l.error_details AS errorDetails,
            t.token_id AS tokenId, t.token_prefix AS tokenPrefix,
            t.user_type AS userType, t.user_id AS userId,
            t.feed_scope AS feedScope, t.branch, t.label
       FROM calendar_feed_access_log l
       INNER JOIN calendar_feed_token t ON t.token_id = l.token_id
      WHERE (? = '' OR t.branch = ?)
      ORDER BY l.requested_at DESC
      LIMIT 500`,
    branch, branch,
  );
  return res.json({ ok: true, data: rows });
}));

export default router;

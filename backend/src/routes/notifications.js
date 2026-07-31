import { Router } from 'express';
import { randomUUID } from 'crypto';
import { prisma } from '../utils/db.js';
import { requirePermission } from '../middleware/permissions.js';
import { requireRole, requireSession } from '../middleware/auth.js';
import { audit } from '../utils/audit.js';
import { notificationHealth, resetFailedNotification } from '../services/notificationOutbox.js';

const router = Router();
const adminAuth = [requireSession, requireRole('admin')];
const CHANNELS = new Set(['IN_APP', 'EMAIL', 'SMS', 'WHATSAPP']);
const DIGEST_MODES = new Set(['IMMEDIATE', 'DAILY', 'WEEKLY', 'OFF']);
const ESCALATION_TARGETS = new Set(['EVENT_OWNER', 'BATCH_COORDINATOR', 'BRANCH_ADMINS', 'EXPLICIT_RECIPIENTS']);

function route(handler) {
  return async (req, res) => {
    try {
      return await handler(req, res);
    } catch (error) {
      console.error(`[NOTIFY] ${req.method} ${req.originalUrl}:`, error.message);
      const status = Number(error.status || 500);
      return res.status(status).json({
        ok: false,
        message: status >= 500 ? 'Notification service failed.' : error.message,
        code: error.code || 'NOTIFICATION_ERROR',
      });
    }
  };
}

function text(value, max = 500) {
  return String(value || '').trim().slice(0, max);
}

function number(value, fallback = 0, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return value === true || value === 1 || value === '1' || String(value).toLowerCase() === 'true';
}

function companyScope(req) {
  return req.permissionScope === 'company' || (!req.userBranch && ['Super Admin', 'SuperAdmin', 'CEO'].includes(req.adminInfo?.role));
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || '[]'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

router.get('/self/inbox', requireSession, requirePermission('notify.view_self'), route(async (req, res) => {
  const unreadOnly = bool(req.query?.unreadOnly, false);
  const limit = Math.round(number(req.query?.limit, 50, 1, 200));
  const rows = await prisma.$queryRawUnsafe(
    `SELECT inbox_id AS inboxId, event_type AS eventType,
            title, body_text AS bodyText, action_url AS actionUrl,
            priority, read_at AS readAt, archived_at AS archivedAt,
            expires_at AS expiresAt, created_at AS createdAt
       FROM notification_inbox
      WHERE user_type = ? AND user_id = ?
        AND archived_at IS NULL
        AND (expires_at IS NULL OR expires_at > UTC_TIMESTAMP(3))
        ${unreadOnly ? 'AND read_at IS NULL' : ''}
      ORDER BY FIELD(priority, 'CRITICAL','HIGH','NORMAL','LOW'), created_at DESC
      LIMIT ?`,
    String(req.userType), String(req.userId), limit,
  );
  const countRows = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) AS count FROM notification_inbox
      WHERE user_type = ? AND user_id = ? AND read_at IS NULL AND archived_at IS NULL
        AND (expires_at IS NULL OR expires_at > UTC_TIMESTAMP(3))`,
    String(req.userType), String(req.userId),
  );
  return res.json({ ok: true, data: rows, unreadCount: Number(countRows[0]?.count || 0) });
}));

router.put('/self/inbox/:inboxId/read', requireSession, requirePermission('notify.view_self'), route(async (req, res) => {
  const count = await prisma.$executeRawUnsafe(
    `UPDATE notification_inbox SET read_at = COALESCE(read_at, UTC_TIMESTAMP(3))
      WHERE inbox_id = ? AND user_type = ? AND user_id = ?`,
    String(req.params.inboxId), String(req.userType), String(req.userId),
  );
  if (!count) return res.status(404).json({ ok: false, message: 'Notification not found.' });
  return res.json({ ok: true, message: 'Notification marked as read.' });
}));

router.put('/self/inbox/:inboxId/archive', requireSession, requirePermission('notify.view_self'), route(async (req, res) => {
  const count = await prisma.$executeRawUnsafe(
    `UPDATE notification_inbox SET archived_at = COALESCE(archived_at, UTC_TIMESTAMP(3))
      WHERE inbox_id = ? AND user_type = ? AND user_id = ?`,
    String(req.params.inboxId), String(req.userType), String(req.userId),
  );
  if (!count) return res.status(404).json({ ok: false, message: 'Notification not found.' });
  return res.json({ ok: true, message: 'Notification archived.' });
}));

router.get('/self/preferences', requireSession, requirePermission('notify.view_self'), route(async (req, res) => {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT preference_id AS preferenceId, event_type AS eventType,
            channel, enabled, digest_mode AS digestMode,
            quiet_start AS quietStart, quiet_end AS quietEnd, timezone,
            updated_at AS updatedAt
       FROM notification_preference
      WHERE user_type = ? AND user_id = ?
      ORDER BY event_type, FIELD(channel, 'IN_APP','EMAIL','SMS','WHATSAPP')`,
    String(req.userType), String(req.userId),
  );
  return res.json({ ok: true, data: rows });
}));

router.put('/self/preferences', requireSession, requirePermission('notify.view_self'), route(async (req, res) => {
  const preferences = Array.isArray(req.body?.preferences) ? req.body.preferences.slice(0, 500) : [];
  if (!preferences.length) return res.status(400).json({ ok: false, message: 'At least one notification preference is required.' });
  let saved = 0;
  for (const item of preferences) {
    const channel = text(item?.channel, 30).toUpperCase();
    const digestMode = text(item?.digestMode, 30).toUpperCase() || 'IMMEDIATE';
    const eventType = text(item?.eventType, 100) || '*';
    if (!CHANNELS.has(channel) || !DIGEST_MODES.has(digestMode)) continue;
    await prisma.$executeRawUnsafe(
      `INSERT INTO notification_preference
         (preference_id, user_type, user_id, event_type, channel,
          enabled, digest_mode, quiet_start, quiet_end, timezone, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         enabled = VALUES(enabled), digest_mode = VALUES(digest_mode),
         quiet_start = VALUES(quiet_start), quiet_end = VALUES(quiet_end),
         timezone = VALUES(timezone), updated_by = VALUES(updated_by)`,
      randomUUID(), String(req.userType), String(req.userId), eventType, channel,
      bool(item.enabled, true) ? 1 : 0, digestMode,
      text(item.quietStart, 8) || null, text(item.quietEnd, 8) || null,
      text(item.timezone, 80) || 'Asia/Kolkata', String(req.userId),
    );
    saved += 1;
  }
  await audit({ userIdentity: req.userId, userRole: req.userType, action: 'UPDATE_NOTIFICATION_PREFERENCES', module: 'Notifications', referenceId: req.userId, newValue: { saved } });
  return res.json({ ok: true, data: { saved }, message: 'Notification preferences saved.' });
}));

router.get('/scope/health', requireSession, requirePermission('notify.audit'), route(async (req, res) => {
  const branch = req.permissionScope === 'company' ? '' : String(req.userBranch || '');
  return res.json({ ok: true, data: await notificationHealth({ branch }) });
}));

router.get('/scope/outbox', requireSession, requirePermission('notify.audit'), route(async (req, res) => {
  const status = text(req.query?.status, 30).toUpperCase();
  const channel = text(req.query?.channel, 30).toUpperCase();
  const limit = Math.round(number(req.query?.limit, 100, 1, 500));
  const params = [];
  const filters = [];
  if (status) { filters.push('o.status = ?'); params.push(status); }
  if (channel) { filters.push('o.channel = ?'); params.push(channel); }
  if (req.permissionScope !== 'company' && req.userBranch) {
    filters.push('e.branch = ?');
    params.push(String(req.userBranch));
  }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const rows = await prisma.$queryRawUnsafe(
    `SELECT o.outbox_id AS outboxId, o.recipient_type AS recipientType,
            o.recipient_id AS recipientId, o.channel, o.recipient_address AS recipientAddress,
            o.title, o.priority, o.status, o.attempt_count AS attemptCount,
            o.max_attempts AS maxAttempts, o.next_attempt_at AS nextAttemptAt,
            o.last_attempt_at AS lastAttemptAt, o.sent_at AS sentAt,
            o.last_error AS lastError, o.created_at AS createdAt,
            e.event_type AS eventType, e.entity_type AS entityType,
            e.entity_id AS entityId, e.branch
       FROM notification_outbox o
       INNER JOIN notification_event e ON e.event_id = o.event_id
       ${where}
       ORDER BY FIELD(o.status, 'FAILED','RETRY','PENDING','PROCESSING','SENT'), o.created_at DESC
       LIMIT ?`,
    ...params, limit,
  );
  return res.json({ ok: true, data: rows });
}));

router.post('/scope/outbox/:outboxId/retry', requireSession, requirePermission('notify.manage_scope'), route(async (req, res) => {
  if (req.permissionScope !== 'company' && req.userBranch) {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT o.outbox_id FROM notification_outbox o
       INNER JOIN notification_event e ON e.event_id = o.event_id
       WHERE o.outbox_id = ? AND e.branch = ? LIMIT 1`,
      String(req.params.outboxId), String(req.userBranch),
    );
    if (!rows.length) return res.status(404).json({ ok: false, message: 'Delivery not found in your scope.' });
  }
  const result = await resetFailedNotification(req.params.outboxId, req.userId);
  if (!result.reset) return res.status(409).json({ ok: false, message: 'Only failed deliveries can be reset.' });
  await audit({ userIdentity: req.userId, userRole: req.userType, action: 'RETRY_NOTIFICATION', module: 'Notifications', referenceId: req.params.outboxId });
  return res.json({ ok: true, data: result, message: 'Delivery reset for retry.' });
}));

router.get('/admin/templates', ...adminAuth, requirePermission('notify.configure'), route(async (req, res) => {
  const branch = companyScope(req) ? text(req.query?.branch, 120) : String(req.userBranch || '');
  const rows = await prisma.$queryRawUnsafe(
    `SELECT template_id AS templateId, template_code AS templateCode,
            event_type AS eventType, channel, locale, branch,
            process_name AS processName, lob_name AS lobName,
            subject_template AS subjectTemplate, body_text_template AS bodyTextTemplate,
            body_html_template AS bodyHtmlTemplate,
            action_url_template AS actionUrlTemplate,
            mandatory, version_no AS versionNo, active, updated_at AS updatedAt
       FROM notification_template
      WHERE (? = '' OR branch IN ('', ?))
      ORDER BY event_type, channel, version_no DESC`,
    branch, branch,
  );
  return res.json({ ok: true, data: rows });
}));

router.put('/admin/templates', ...adminAuth, requirePermission('notify.configure'), route(async (req, res) => {
  const templateCode = text(req.body?.templateCode, 120).toUpperCase();
  const eventType = text(req.body?.eventType, 100).toUpperCase();
  const channel = text(req.body?.channel, 30).toUpperCase();
  const bodyTextTemplate = text(req.body?.bodyTextTemplate, 100000);
  if (!templateCode || !eventType || !CHANNELS.has(channel) || !bodyTextTemplate) {
    return res.status(400).json({ ok: false, message: 'Template code, event type, valid channel and text body are required.' });
  }
  const branch = companyScope(req) ? text(req.body?.branch, 120) : String(req.userBranch || '');
  const versionNo = Math.round(number(req.body?.versionNo, 1, 1, 10000));
  await prisma.$executeRawUnsafe(
    `INSERT INTO notification_template
       (template_id, template_code, event_type, channel, locale,
        branch, process_name, lob_name, subject_template,
        body_text_template, body_html_template, action_url_template,
        mandatory, version_no, active, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       event_type = VALUES(event_type), channel = VALUES(channel), locale = VALUES(locale),
       branch = VALUES(branch), process_name = VALUES(process_name), lob_name = VALUES(lob_name),
       subject_template = VALUES(subject_template), body_text_template = VALUES(body_text_template),
       body_html_template = VALUES(body_html_template), action_url_template = VALUES(action_url_template),
       mandatory = VALUES(mandatory), active = VALUES(active), created_by = VALUES(created_by)`,
    randomUUID(), templateCode, eventType, channel,
    text(req.body?.locale, 20) || 'en-IN', branch,
    text(req.body?.processName, 120), text(req.body?.lobName, 120),
    text(req.body?.subjectTemplate, 500) || null, bodyTextTemplate,
    text(req.body?.bodyHtmlTemplate, 100000) || null,
    text(req.body?.actionUrlTemplate, 1000) || null,
    bool(req.body?.mandatory, false) ? 1 : 0, versionNo,
    bool(req.body?.active, true) ? 1 : 0, String(req.userId),
  );
  await audit({ userIdentity: req.userId, userRole: 'admin', action: 'SAVE_NOTIFICATION_TEMPLATE', module: 'Notifications', referenceId: `${templateCode}:${versionNo}`, newValue: req.body });
  return res.json({ ok: true, message: 'Notification template saved.' });
}));

router.get('/admin/escalations', ...adminAuth, requirePermission('notify.configure'), route(async (req, res) => {
  const branch = companyScope(req) ? text(req.query?.branch, 120) : String(req.userBranch || '');
  const rows = await prisma.$queryRawUnsafe(
    `SELECT rule_id AS ruleId, rule_code AS ruleCode, event_type AS eventType,
            branch, process_name AS processName, lob_name AS lobName,
            trigger_after_minutes AS triggerAfterMinutes,
            repeat_every_minutes AS repeatEveryMinutes,
            max_escalations AS maxEscalations, target_type AS targetType,
            target_value AS targetValue, channels_json AS channelsJson,
            priority, active, updated_at AS updatedAt
       FROM notification_escalation_rule
      WHERE (? = '' OR branch IN ('', ?))
      ORDER BY event_type, rule_code`,
    branch, branch,
  );
  return res.json({ ok: true, data: rows });
}));

router.put('/admin/escalations', ...adminAuth, requirePermission('notify.configure'), route(async (req, res) => {
  const ruleCode = text(req.body?.ruleCode, 120).toUpperCase();
  const eventType = text(req.body?.eventType, 100).toUpperCase();
  const targetType = text(req.body?.targetType, 40).toUpperCase();
  const channels = parseJsonArray(req.body?.channels).map(item => text(item, 30).toUpperCase()).filter(item => CHANNELS.has(item));
  if (!ruleCode || !eventType || !ESCALATION_TARGETS.has(targetType) || !channels.length) {
    return res.status(400).json({ ok: false, message: 'Rule code, event type, target and at least one valid channel are required.' });
  }
  const branch = companyScope(req) ? text(req.body?.branch, 120) : String(req.userBranch || '');
  await prisma.$executeRawUnsafe(
    `INSERT INTO notification_escalation_rule
       (rule_id, rule_code, event_type, branch, process_name, lob_name,
        trigger_after_minutes, repeat_every_minutes, max_escalations,
        target_type, target_value, channels_json, priority, active, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       event_type = VALUES(event_type), branch = VALUES(branch),
       process_name = VALUES(process_name), lob_name = VALUES(lob_name),
       trigger_after_minutes = VALUES(trigger_after_minutes),
       repeat_every_minutes = VALUES(repeat_every_minutes),
       max_escalations = VALUES(max_escalations), target_type = VALUES(target_type),
       target_value = VALUES(target_value), channels_json = VALUES(channels_json),
       priority = VALUES(priority), active = VALUES(active), created_by = VALUES(created_by)`,
    randomUUID(), ruleCode, eventType, branch,
    text(req.body?.processName, 120), text(req.body?.lobName, 120),
    Math.round(number(req.body?.triggerAfterMinutes, 60, 0, 525600)),
    req.body?.repeatEveryMinutes == null ? null : Math.round(number(req.body.repeatEveryMinutes, 0, 1, 525600)),
    Math.round(number(req.body?.maxEscalations, 1, 1, 20)), targetType,
    text(req.body?.targetValue, 2000) || null, JSON.stringify(channels),
    ['LOW', 'NORMAL', 'HIGH', 'CRITICAL'].includes(text(req.body?.priority, 20).toUpperCase())
      ? text(req.body.priority, 20).toUpperCase() : 'HIGH',
    bool(req.body?.active, true) ? 1 : 0, String(req.userId),
  );
  await audit({ userIdentity: req.userId, userRole: 'admin', action: 'SAVE_NOTIFICATION_ESCALATION', module: 'Notifications', referenceId: ruleCode, newValue: req.body });
  return res.json({ ok: true, message: 'Escalation rule saved.' });
}));

export default router;

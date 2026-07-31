import { randomUUID } from 'crypto';
import { prisma } from '../utils/db.js';
import { sendEmail, sendSms, sendWhatsApp } from '../utils/notify.js';

const CHANNELS = ['IN_APP', 'EMAIL', 'SMS', 'WHATSAPP'];
const PRIORITY_ORDER = { CRITICAL: 0, HIGH: 1, NORMAL: 2, LOW: 3 };

function normalize(value) {
  if (typeof value === 'bigint') return Number(value);
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(item)]));
  }
  return value;
}

function json(value, fallback = {}) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function render(template, payload) {
  return String(template || '').replace(/{{\s*([\w.]+)\s*}}/g, (_match, path) => {
    const value = path.split('.').reduce((current, key) => current?.[key], payload);
    if (value == null) return '';
    if (value instanceof Date) return value.toISOString();
    return String(value);
  });
}

function retryDelay(attemptCount) {
  return Math.min(24 * 60, Math.max(2, 2 ** Math.max(1, attemptCount))) * 60 * 1000;
}

function nextQuietEnd(preference, now = new Date()) {
  if (!preference?.quietStart || !preference?.quietEnd) return null;
  const [startHour, startMinute] = String(preference.quietStart).split(':').map(Number);
  const [endHour, endMinute] = String(preference.quietEnd).split(':').map(Number);
  const localMinutes = now.getUTCHours() * 60 + now.getUTCMinutes() + 330;
  const normalizedMinutes = ((localMinutes % 1440) + 1440) % 1440;
  const start = startHour * 60 + startMinute;
  const end = endHour * 60 + endMinute;
  const inside = start <= end
    ? normalizedMinutes >= start && normalizedMinutes < end
    : normalizedMinutes >= start || normalizedMinutes < end;
  if (!inside) return null;
  let minutesUntilEnd = end - normalizedMinutes;
  if (minutesUntilEnd <= 0) minutesUntilEnd += 1440;
  return new Date(now.getTime() + minutesUntilEnd * 60 * 1000);
}

async function userContact(userType, userId) {
  if (userType === 'trainee') {
    const user = await prisma.traineeMaster.findUnique({
      where: { employeeId: String(userId) },
      select: { employeeId: true, traineeName: true, email: true, mobile: true, branch: true, process: true, lob: true, batchNo: true },
    });
    return user ? { ...user, userType: 'trainee', userId: user.employeeId, name: user.traineeName || user.employeeId } : null;
  }
  const user = await prisma.roleAccessMatrix.findUnique({
    where: { loginId: String(userId) },
    select: { loginId: true, name: true, email: true, mobile: true, branch: true, process: true, lob: true, role: true, active: true },
  });
  return user?.active ? { ...user, userType, userId: user.loginId, name: user.name || user.loginId } : null;
}

async function preferenceFor(userType, userId, eventType, channel) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT event_type AS eventType, channel, enabled, digest_mode AS digestMode,
            quiet_start AS quietStart, quiet_end AS quietEnd, timezone
       FROM notification_preference
      WHERE user_type = ? AND user_id = ?
        AND event_type IN (?, '*') AND channel = ?
      ORDER BY CASE WHEN event_type = ? THEN 0 ELSE 1 END
      LIMIT 1`,
    String(userType), String(userId), String(eventType), String(channel), String(eventType),
  );
  return normalize(rows[0] || { enabled: 1, digestMode: 'IMMEDIATE', timezone: 'Asia/Kolkata' });
}

async function resolveTemplate(event, channel, locale = 'en-IN') {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT template_id AS templateId, template_code AS templateCode,
            event_type AS eventType, channel, locale,
            subject_template AS subjectTemplate,
            body_text_template AS bodyTextTemplate,
            body_html_template AS bodyHtmlTemplate,
            action_url_template AS actionUrlTemplate,
            mandatory, version_no AS versionNo
       FROM notification_template
      WHERE event_type = ? AND channel = ? AND locale IN (?, 'en-IN')
        AND active = 1
        AND (branch = '' OR branch = ?)
        AND (process_name = '' OR process_name = ?)
        AND (lob_name = '' OR lob_name = ?)
      ORDER BY (branch <> '') DESC, (process_name <> '') DESC,
               (lob_name <> '') DESC, (locale = ?) DESC, version_no DESC
      LIMIT 1`,
    String(event.eventType), String(channel), String(locale), String(event.branch || ''),
    String(event.processName || ''), String(event.lobName || ''), String(locale),
  );
  return normalize(rows[0] || null);
}

function addressFor(channel, contact) {
  if (channel === 'EMAIL') return contact.email || null;
  if (channel === 'SMS' || channel === 'WHATSAPP') return contact.mobile || null;
  return null;
}

export async function emitNotificationEvent({
  eventType,
  entityType,
  entityId,
  actorId = null,
  actorType = null,
  branch = '',
  processName = '',
  lobName = '',
  payload = {},
  idempotencyKey,
}) {
  const eventId = randomUUID();
  await prisma.$executeRawUnsafe(
    `INSERT INTO notification_event
       (event_id, event_type, entity_type, entity_id, actor_id, actor_type,
        branch, process_name, lob_name, payload_json, idempotency_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE event_id = event_id`,
    eventId, String(eventType), String(entityType), String(entityId),
    actorId ? String(actorId) : null, actorType ? String(actorType) : null,
    String(branch || ''), String(processName || ''), String(lobName || ''),
    JSON.stringify(payload || {}), String(idempotencyKey),
  );
  const rows = await prisma.$queryRawUnsafe(
    `SELECT event_id AS eventId, status FROM notification_event WHERE idempotency_key = ? LIMIT 1`,
    String(idempotencyKey),
  );
  return normalize(rows[0]);
}

async function createOutboxForRecipient(event, recipient) {
  const contact = await userContact(recipient.userType, recipient.userId);
  if (!contact) return { created: 0, skipped: CHANNELS.length, reason: 'RECIPIENT_NOT_FOUND' };
  const payload = { ...json(event.payloadJson), ...recipient.payload, recipientName: contact.name };
  let created = 0;
  let skipped = 0;

  for (const channel of CHANNELS) {
    const template = await resolveTemplate(event, channel, recipient.locale || 'en-IN');
    if (!template) { skipped += 1; continue; }
    const preference = await preferenceFor(recipient.userType, recipient.userId, event.eventType, channel);
    if (!template.mandatory && (!preference.enabled || preference.digestMode === 'OFF')) {
      skipped += 1;
      continue;
    }
    const recipientAddress = addressFor(channel, contact);
    if (channel !== 'IN_APP' && !recipientAddress) { skipped += 1; continue; }
    const quietUntil = !template.mandatory && preference.digestMode === 'IMMEDIATE'
      ? nextQuietEnd(preference)
      : null;
    const nextAttemptAt = preference.digestMode === 'DAILY'
      ? new Date(Date.now() + 24 * 60 * 60 * 1000)
      : preference.digestMode === 'WEEKLY'
        ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
        : quietUntil || new Date();
    const idempotencyKey = `${event.idempotencyKey}:${recipient.userType}:${recipient.userId}:${channel}:${template.versionNo}`;
    await prisma.$executeRawUnsafe(
      `INSERT INTO notification_outbox
         (outbox_id, event_id, recipient_type, recipient_id, channel,
          recipient_address, template_id, title, body_text, body_html,
          action_url, payload_json, priority, status, idempotency_key,
          max_attempts, next_attempt_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?)
       ON DUPLICATE KEY UPDATE outbox_id = outbox_id`,
      randomUUID(), String(event.eventId), String(recipient.userType), String(recipient.userId), channel,
      recipientAddress, template.templateId, render(template.subjectTemplate, payload) || null,
      render(template.bodyTextTemplate, payload), render(template.bodyHtmlTemplate, payload) || null,
      render(template.actionUrlTemplate, payload) || null, JSON.stringify(payload),
      String(recipient.priority || payload.priority || 'NORMAL').toUpperCase(), idempotencyKey,
      Number(recipient.maxAttempts || 5), nextAttemptAt,
    );
    created += 1;
  }
  return { created, skipped };
}

async function recipientsForEvent(event) {
  const payload = json(event.payloadJson);
  if (Array.isArray(payload.recipients)) {
    return payload.recipients
      .filter(item => item?.userType && item?.userId)
      .map(item => ({ ...item, payload }));
  }
  if (payload.recipientType && payload.recipientId) {
    return [{ userType: payload.recipientType, userId: payload.recipientId, priority: payload.priority, payload }];
  }
  return [];
}

export async function processNotificationEvents(workerId = `event-worker-${process.pid}`, batchSize = 50) {
  const claimed = await prisma.$transaction(async tx => {
    const rows = await tx.$queryRawUnsafe(
      `SELECT event_id AS eventId, event_type AS eventType,
              entity_type AS entityType, entity_id AS entityId,
              branch, process_name AS processName, lob_name AS lobName,
              payload_json AS payloadJson, idempotency_key AS idempotencyKey
         FROM notification_event
        WHERE status = 'NEW'
        ORDER BY occurred_at
        LIMIT ? FOR UPDATE SKIP LOCKED`,
      Number(batchSize),
    );
    if (rows.length) {
      const placeholders = rows.map(() => '?').join(',');
      await tx.$executeRawUnsafe(
        `UPDATE notification_event SET status = 'PROCESSING', error_details = NULL
          WHERE event_id IN (${placeholders})`,
        ...rows.map(row => row.eventId),
      );
    }
    return normalize(rows);
  });

  let processed = 0;
  let failed = 0;
  let outboxCreated = 0;
  for (const event of claimed) {
    try {
      const recipients = await recipientsForEvent(event);
      for (const recipient of recipients) {
        const result = await createOutboxForRecipient(event, recipient);
        outboxCreated += result.created;
      }
      await prisma.$executeRawUnsafe(
        `UPDATE notification_event SET status = 'PROCESSED', processed_at = UTC_TIMESTAMP(3), error_details = NULL
          WHERE event_id = ?`,
        String(event.eventId),
      );
      processed += 1;
    } catch (error) {
      await prisma.$executeRawUnsafe(
        `UPDATE notification_event SET status = 'FAILED', error_details = ? WHERE event_id = ?`,
        String(error.message || error).slice(0, 10000), String(event.eventId),
      );
      failed += 1;
    }
  }
  return { workerId, claimed: claimed.length, processed, failed, outboxCreated };
}

async function deliver(item) {
  if (item.channel === 'IN_APP') {
    await prisma.$executeRawUnsafe(
      `INSERT INTO notification_inbox
         (inbox_id, outbox_id, user_type, user_id, event_type, title,
          body_text, action_url, priority, idempotency_key, expires_at)
       SELECT ?, ?, ?, ?, e.event_type, ?, ?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 180 DAY)
         FROM notification_event e WHERE e.event_id = ?
       ON DUPLICATE KEY UPDATE inbox_id = inbox_id`,
      randomUUID(), item.outboxId, item.recipientType, item.recipientId,
      item.title || 'MCN LMS notification', item.bodyText, item.actionUrl || null,
      item.priority, `inbox:${item.idempotencyKey}`, item.eventId,
    );
    return { providerMessageId: `inbox:${item.outboxId}` };
  }
  if (item.channel === 'EMAIL') {
    const result = await sendEmail({ to: item.recipientAddress, subject: item.title || 'MCN LMS notification', text: item.bodyText, html: item.bodyHtml || undefined });
    if (!result?.ok) throw new Error(result?.skipped ? 'Email channel is disabled.' : 'Email delivery failed.');
    return { providerMessageId: result.messageId || null };
  }
  if (item.channel === 'SMS') {
    const result = await sendSms({ to: item.recipientAddress, message: item.bodyText });
    if (!result?.ok) throw new Error(result?.skipped ? 'SMS channel is disabled.' : 'SMS delivery failed.');
    return { providerMessageId: result.data?.requestId || null };
  }
  if (item.channel === 'WHATSAPP') {
    const result = await sendWhatsApp({ to: item.recipientAddress, message: item.bodyText });
    if (!result?.ok) throw new Error(result?.skipped ? 'WhatsApp channel is disabled.' : 'WhatsApp delivery failed.');
    return { providerMessageId: result.data?.requestId || null };
  }
  throw new Error(`Unsupported notification channel: ${item.channel}`);
}

export async function processNotificationOutbox(workerId = `delivery-worker-${process.pid}`, batchSize = 50) {
  const claimed = await prisma.$transaction(async tx => {
    const rows = await tx.$queryRawUnsafe(
      `SELECT outbox_id AS outboxId, event_id AS eventId,
              recipient_type AS recipientType, recipient_id AS recipientId,
              channel, recipient_address AS recipientAddress,
              title, body_text AS bodyText, body_html AS bodyHtml,
              action_url AS actionUrl, priority, status,
              idempotency_key AS idempotencyKey, attempt_count AS attemptCount,
              max_attempts AS maxAttempts
         FROM notification_outbox
        WHERE status IN ('PENDING','RETRY')
          AND next_attempt_at <= UTC_TIMESTAMP(3)
          AND (locked_at IS NULL OR locked_at < DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 10 MINUTE))
        ORDER BY FIELD(priority, 'CRITICAL','HIGH','NORMAL','LOW'), created_at
        LIMIT ? FOR UPDATE SKIP LOCKED`,
      Number(batchSize),
    );
    if (rows.length) {
      const placeholders = rows.map(() => '?').join(',');
      await tx.$executeRawUnsafe(
        `UPDATE notification_outbox
            SET status = 'PROCESSING', locked_by = ?, locked_at = UTC_TIMESTAMP(3),
                attempt_count = attempt_count + 1, last_attempt_at = UTC_TIMESTAMP(3)
          WHERE outbox_id IN (${placeholders})`,
        String(workerId), ...rows.map(row => row.outboxId),
      );
    }
    return normalize(rows).map(item => ({ ...item, attemptCount: Number(item.attemptCount || 0) + 1 }));
  });

  let sent = 0;
  let retry = 0;
  let failed = 0;
  for (const item of claimed.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority])) {
    try {
      const result = await deliver(item);
      await prisma.$executeRawUnsafe(
        `UPDATE notification_outbox
            SET status = 'SENT', sent_at = UTC_TIMESTAMP(3), provider_message_id = ?,
                last_error = NULL, locked_by = NULL, locked_at = NULL
          WHERE outbox_id = ?`,
        result.providerMessageId || null, String(item.outboxId),
      );
      sent += 1;
    } catch (error) {
      const exhausted = item.attemptCount >= Number(item.maxAttempts || 5);
      await prisma.$executeRawUnsafe(
        `UPDATE notification_outbox
            SET status = ?, next_attempt_at = ?, last_error = ?,
                locked_by = NULL, locked_at = NULL
          WHERE outbox_id = ?`,
        exhausted ? 'FAILED' : 'RETRY',
        exhausted ? new Date() : new Date(Date.now() + retryDelay(item.attemptCount)),
        String(error.message || error).slice(0, 10000), String(item.outboxId),
      );
      if (exhausted) failed += 1; else retry += 1;
    }
  }
  return { workerId, claimed: claimed.length, sent, retry, failed };
}

export async function resetFailedNotification(outboxId, actorId) {
  const updated = await prisma.$executeRawUnsafe(
    `UPDATE notification_outbox
        SET status = 'RETRY', attempt_count = 0, next_attempt_at = UTC_TIMESTAMP(3),
            last_error = NULL, locked_by = NULL, locked_at = NULL
      WHERE outbox_id = ? AND status = 'FAILED'`,
    String(outboxId),
  );
  return { outboxId, reset: Number(updated || 0) > 0, actorId };
}

export async function notificationHealth(scope = {}) {
  const params = [];
  let where = '';
  if (scope.branch) {
    where = ` AND e.branch = ?`;
    params.push(String(scope.branch));
  }
  const [statusRows, eventRows] = await Promise.all([
    prisma.$queryRawUnsafe(
      `SELECT o.status, o.channel, COUNT(*) AS count
         FROM notification_outbox o
         INNER JOIN notification_event e ON e.event_id = o.event_id
        WHERE 1=1${where}
        GROUP BY o.status, o.channel`,
      ...params,
    ),
    prisma.$queryRawUnsafe(
      `SELECT status, COUNT(*) AS count FROM notification_event e
        WHERE 1=1${where} GROUP BY status`,
      ...params,
    ),
  ]);
  return normalize({ deliveries: statusRows, events: eventRows });
}

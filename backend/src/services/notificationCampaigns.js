import { randomUUID } from 'crypto';
import { prisma } from '../utils/db.js';
import { emitNotificationEvent, processNotificationEvents, processNotificationOutbox } from './notificationOutbox.js';

function iso(value) {
  return value instanceof Date ? value.toISOString() : value;
}

function dateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? 'unknown' : date.toISOString().slice(0, 10);
}

async function emitIltReminder(row, eventType) {
  await emitNotificationEvent({
    eventType,
    entityType: 'ILT_SESSION',
    entityId: row.sessionId,
    branch: row.branch || '',
    processName: row.processName || '',
    lobName: row.lobName || '',
    payload: {
      ...row,
      startAt: iso(row.startAt),
      endAt: iso(row.endAt),
      recipientType: 'trainee',
      recipientId: row.employeeId,
      priority: eventType === 'ILT_REMINDER_2H' ? 'HIGH' : 'NORMAL',
    },
    idempotencyKey: `ilt-reminder:${eventType}:${row.sessionId}:${row.employeeId}`,
  });
}

export async function generateIltReminders() {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT s.session_id AS sessionId, s.session_code AS sessionCode,
            s.title AS sessionTitle, s.start_at AS startAt, s.end_at AS endAt,
            s.branch, s.process_name AS processName, s.lob_name AS lobName,
            s.delivery_mode AS deliveryMode, s.virtual_join_url AS virtualJoinUrl,
            v.venue_name AS venueName, v.room_location AS roomLocation,
            e.employee_id AS employeeId, t.trainee_name AS traineeName,
            t.email, t.mobile, t.batch_no AS batchNo,
            TIMESTAMPDIFF(MINUTE, UTC_TIMESTAMP(3), s.start_at) AS minutesUntilStart
       FROM ilt_session s
       INNER JOIN ilt_session_enrollment e ON e.session_id = s.session_id
       LEFT JOIN ilt_venue v ON v.venue_id = s.venue_id
       LEFT JOIN trainee_master t ON t.employee_id = e.employee_id
      WHERE s.status = 'PUBLISHED'
        AND e.status = 'CONFIRMED'
        AND TIMESTAMPDIFF(MINUTE, UTC_TIMESTAMP(3), s.start_at) BETWEEN 90 AND 150
         OR (s.status = 'PUBLISHED'
        AND e.status = 'CONFIRMED'
        AND TIMESTAMPDIFF(MINUTE, UTC_TIMESTAMP(3), s.start_at) BETWEEN 1380 AND 1500)`,
  );
  let generated = 0;
  for (const row of rows) {
    const minutes = Number(row.minutesUntilStart || 0);
    const eventType = minutes <= 150 ? 'ILT_REMINDER_2H' : 'ILT_REMINDER_24H';
    await emitIltReminder(row, eventType);
    generated += 1;
  }
  return { generated };
}

export async function generateCoachingReminders() {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT cs.session_id AS coachingSessionId, cs.scheduled_at AS scheduledAt,
            cs.agenda, cp.plan_id AS planId, cp.title AS planTitle,
            cp.employee_id AS employeeId, cp.branch,
            cp.process_name AS processName, cp.lob_name AS lobName,
            t.trainee_name AS traineeName, t.email, t.mobile
       FROM coaching_session cs
       INNER JOIN coaching_plan cp ON cp.plan_id = cs.plan_id
       LEFT JOIN trainee_master t ON t.employee_id = cp.employee_id
      WHERE cs.status = 'SCHEDULED'
        AND TIMESTAMPDIFF(MINUTE, UTC_TIMESTAMP(3), cs.scheduled_at) BETWEEN 1380 AND 1500`,
  );
  for (const row of rows) {
    await emitNotificationEvent({
      eventType: 'COACHING_SESSION_REMINDER',
      entityType: 'COACHING_SESSION',
      entityId: row.coachingSessionId,
      branch: row.branch || '',
      processName: row.processName || '',
      lobName: row.lobName || '',
      payload: {
        ...row,
        scheduledAt: iso(row.scheduledAt),
        recipientType: 'trainee',
        recipientId: row.employeeId,
        priority: 'NORMAL',
      },
      idempotencyKey: `coaching-reminder:24h:${row.coachingSessionId}:${row.employeeId}`,
    });
  }
  return { generated: rows.length };
}

export async function generateCertificationReminders() {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT crc.case_id AS caseId, crc.employee_id AS employeeId,
            crc.status, crc.due_at AS dueAt, crc.grace_until AS graceUntil,
            crc.blocker_reason AS blockerReason,
            ec.certification_type AS certificationType,
            ec.credential_number AS credentialNumber,
            ec.branch, ec.process_name AS processName, ec.lob_name AS lobName,
            ec.batch_no AS batchNo,
            t.trainee_name AS traineeName, t.email, t.mobile,
            DATEDIFF(DATE(crc.due_at), UTC_DATE()) AS daysUntilDue
       FROM certification_renewal_case crc
       INNER JOIN employee_certification ec ON ec.certification_id = crc.certification_id
       LEFT JOIN trainee_master t ON t.employee_id = crc.employee_id
      WHERE crc.status IN ('OPEN','IN_PROGRESS','READY','OVERDUE')
        AND (
          DATEDIFF(DATE(crc.due_at), UTC_DATE()) IN (30,14,7,3,1,0)
          OR crc.status = 'OVERDUE'
          OR crc.due_at < UTC_TIMESTAMP(3)
        )`,
  );
  let generated = 0;
  for (const row of rows) {
    const overdue = row.status === 'OVERDUE' || new Date(row.dueAt) < new Date();
    const eventType = overdue ? 'CERT_RENEWAL_OVERDUE' : 'CERT_RENEWAL_DUE';
    const milestone = overdue ? 'overdue' : `${Number(row.daysUntilDue)}d`;
    await emitNotificationEvent({
      eventType,
      entityType: 'CERTIFICATION_RENEWAL',
      entityId: row.caseId,
      branch: row.branch || '',
      processName: row.processName || '',
      lobName: row.lobName || '',
      payload: {
        ...row,
        dueAt: iso(row.dueAt),
        graceUntil: iso(row.graceUntil),
        recipientType: 'trainee',
        recipientId: row.employeeId,
        priority: overdue ? 'CRITICAL' : Number(row.daysUntilDue) <= 3 ? 'HIGH' : 'NORMAL',
      },
      idempotencyKey: `cert-reminder:${eventType}:${row.caseId}:${milestone}`,
    });
    generated += 1;
  }
  return { generated };
}

async function scheduleEscalationInstances() {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT r.rule_id AS ruleId, r.trigger_after_minutes AS triggerAfterMinutes,
            r.max_escalations AS maxEscalations,
            e.event_id AS eventId, e.entity_type AS entityType, e.entity_id AS entityId,
            e.occurred_at AS occurredAt
       FROM notification_escalation_rule r
       INNER JOIN notification_event e ON e.event_type = r.event_type
      WHERE r.active = 1 AND e.status = 'PROCESSED'
        AND NOT EXISTS (
          SELECT 1 FROM notification_escalation_instance i
           WHERE i.rule_id = r.rule_id AND i.source_event_id = e.event_id
        )
      ORDER BY e.occurred_at
      LIMIT 500`,
  );
  for (const row of rows) {
    const dueAt = new Date(new Date(row.occurredAt).getTime() + Number(row.triggerAfterMinutes || 0) * 60000);
    await prisma.$executeRawUnsafe(
      `INSERT IGNORE INTO notification_escalation_instance
         (instance_id, rule_id, source_event_id, entity_type, entity_id,
          escalation_no, status, due_at)
       VALUES (?, ?, ?, ?, ?, 1, 'PENDING', ?)`,
      randomUUID(), row.ruleId, row.eventId, row.entityType, row.entityId, dueAt,
    );
  }
  return { scheduled: rows.length };
}

async function coordinatorRecipient(payload) {
  const batchNo = payload.batchNo || null;
  if (!batchNo) return null;
  const batch = await prisma.batchMaster.findUnique({
    where: { batchNo: String(batchNo) },
    select: { coordinatorLoginId: true },
  });
  return batch?.coordinatorLoginId
    ? { userType: 'coordinator', userId: batch.coordinatorLoginId }
    : null;
}

async function branchAdminRecipients(branch) {
  if (!branch) return [];
  const users = await prisma.roleAccessMatrix.findMany({
    where: { branch: String(branch), active: true, role: { in: ['Admin', 'Super Admin', 'SuperAdmin', 'CEO'] } },
    select: { loginId: true },
    take: 100,
  });
  return users.map(user => ({ userType: 'admin', userId: user.loginId }));
}

async function resolveEscalationRecipients(rule, event, payload) {
  if (rule.targetType === 'EVENT_OWNER' && event.actorId && event.actorType) {
    return [{ userType: event.actorType, userId: event.actorId }];
  }
  if (rule.targetType === 'BATCH_COORDINATOR') {
    const recipient = await coordinatorRecipient(payload);
    return recipient ? [recipient] : [];
  }
  if (rule.targetType === 'BRANCH_ADMINS') return branchAdminRecipients(event.branch);
  if (rule.targetType === 'EXPLICIT_RECIPIENTS') {
    try {
      const parsed = JSON.parse(rule.targetValue || '[]');
      return Array.isArray(parsed) ? parsed.filter(item => item?.userType && item?.userId) : [];
    } catch {
      return [];
    }
  }
  return [];
}

export async function processDueEscalations() {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT i.instance_id AS instanceId, i.escalation_no AS escalationNo,
            r.rule_id AS ruleId, r.rule_code AS ruleCode, r.event_type AS eventType,
            r.repeat_every_minutes AS repeatEveryMinutes,
            r.max_escalations AS maxEscalations, r.target_type AS targetType,
            r.target_value AS targetValue, r.channels_json AS channelsJson,
            r.priority,
            e.event_id AS eventId, e.event_type AS sourceEventType,
            e.entity_type AS entityType, e.entity_id AS entityId,
            e.actor_id AS actorId, e.actor_type AS actorType,
            e.branch, e.process_name AS processName, e.lob_name AS lobName,
            e.payload_json AS payloadJson
       FROM notification_escalation_instance i
       INNER JOIN notification_escalation_rule r ON r.rule_id = i.rule_id
       INNER JOIN notification_event e ON e.event_id = i.source_event_id
      WHERE i.status = 'PENDING' AND i.due_at <= UTC_TIMESTAMP(3)
      ORDER BY i.due_at
      LIMIT 100`,
  );
  let sent = 0;
  for (const row of rows) {
    const payload = typeof row.payloadJson === 'object' ? row.payloadJson : JSON.parse(row.payloadJson || '{}');
    const recipients = await resolveEscalationRecipients(row, row, payload);
    if (!recipients.length) {
      await prisma.$executeRawUnsafe(
        `UPDATE notification_escalation_instance
            SET status = 'FAILED', resolution_note = 'No escalation recipient could be resolved.'
          WHERE instance_id = ?`,
        row.instanceId,
      );
      continue;
    }
    const message = `${row.sourceEventType} requires attention for ${payload.traineeName || payload.employeeId || row.entityId}. ${payload.blockerReason || payload.sessionTitle || ''}`.trim();
    await emitNotificationEvent({
      eventType: 'ESCALATION_ALERT',
      entityType: row.entityType,
      entityId: row.entityId,
      branch: row.branch || '',
      processName: row.processName || '',
      lobName: row.lobName || '',
      payload: {
        sourceEventType: row.sourceEventType,
        message,
        actionUrl: row.sourceEventType.startsWith('ILT_') ? '/training-calendar' : '/development-hub',
        priority: row.priority,
        recipients: recipients.map(recipient => ({ ...recipient, priority: row.priority })),
      },
      idempotencyKey: `escalation:${row.ruleId}:${row.eventId}:${row.escalationNo}`,
    });
    await prisma.$executeRawUnsafe(
      `UPDATE notification_escalation_instance SET status = 'SENT', sent_at = UTC_TIMESTAMP(3)
        WHERE instance_id = ?`,
      row.instanceId,
    );
    const nextNo = Number(row.escalationNo) + 1;
    if (row.repeatEveryMinutes && nextNo <= Number(row.maxEscalations)) {
      await prisma.$executeRawUnsafe(
        `INSERT IGNORE INTO notification_escalation_instance
           (instance_id, rule_id, source_event_id, entity_type, entity_id,
            escalation_no, status, due_at)
         VALUES (?, ?, ?, ?, ?, ?, 'PENDING', DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? MINUTE))`,
        randomUUID(), row.ruleId, row.eventId, row.entityType, row.entityId,
        nextNo, Number(row.repeatEveryMinutes),
      );
    }
    sent += 1;
  }
  return { due: rows.length, sent };
}

export async function runNotificationCampaignCycle(workerId = `notification-campaign-${process.pid}`) {
  const [ilt, coaching, certifications] = await Promise.all([
    generateIltReminders(),
    generateCoachingReminders(),
    generateCertificationReminders(),
  ]);
  const eventsBeforeEscalation = await processNotificationEvents(`${workerId}-events`);
  const scheduledEscalations = await scheduleEscalationInstances();
  const escalations = await processDueEscalations();
  const eventsAfterEscalation = await processNotificationEvents(`${workerId}-escalations`);
  const deliveries = await processNotificationOutbox(`${workerId}-delivery`);
  return { ilt, coaching, certifications, eventsBeforeEscalation, scheduledEscalations, escalations, eventsAfterEscalation, deliveries };
}

export function campaignDateFingerprint() {
  return dateKey(new Date());
}

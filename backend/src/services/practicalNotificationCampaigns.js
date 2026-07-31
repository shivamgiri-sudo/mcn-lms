import { prisma } from '../utils/db.js';
import { emitNotificationEvent } from './notificationOutbox.js';

function normalize(value) {
  if (typeof value === 'bigint') return Number(value);
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    if (typeof value.toNumber === 'function') return value.toNumber();
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(item)]));
  }
  return value;
}

function dateKey(value) {
  return new Date(value).toISOString().slice(0, 10);
}

export async function generatePracticalAssessmentReminders(limit = 2000) {
  const rows = normalize(await prisma.$queryRawUnsafe(
    `SELECT a.assignment_id AS assignmentId, a.employee_id AS employeeId,
            a.batch_no AS batchNo, a.branch, a.process_name AS processName,
            a.lob_name AS lobName, a.due_at AS dueAt,
            DATEDIFF(DATE(a.due_at), UTC_DATE()) AS daysRemaining,
            p.template_name AS templateName, p.version_no AS versionNo,
            t.trainee_name AS traineeName,
            b.coordinator_login_id AS coordinatorId
       FROM practical_assessment_assignment a
       INNER JOIN practical_assessment_template p ON p.template_id = a.template_id
       LEFT JOIN trainee_master t ON t.employee_id = a.employee_id
       LEFT JOIN batch_master b ON b.batch_no = a.batch_no
      WHERE a.status IN ('ASSIGNED','IN_PROGRESS')
        AND a.due_at IS NOT NULL
        AND DATEDIFF(DATE(a.due_at), UTC_DATE()) BETWEEN -30 AND 3
      ORDER BY a.due_at
      LIMIT ?`,
    Number(limit),
  ));
  let due = 0;
  let overdue = 0;
  for (const row of rows) {
    const daysRemaining = Number(row.daysRemaining);
    const common = {
      employeeId: row.employeeId,
      traineeName: row.traineeName || row.employeeId,
      batchNo: row.batchNo,
      templateName: row.templateName,
      versionNo: row.versionNo,
      dueAt: row.dueAt,
    };
    if ([3, 1, 0].includes(daysRemaining)) {
      await emitNotificationEvent({
        eventType: 'PRACTICAL_DUE_REMINDER',
        entityType: 'PRACTICAL_ASSIGNMENT',
        entityId: row.assignmentId,
        branch: row.branch || '',
        processName: row.processName || '',
        lobName: row.lobName || '',
        payload: {
          ...common,
          recipientType: 'trainee',
          recipientId: row.employeeId,
          daysRemaining,
          priority: daysRemaining === 0 ? 'HIGH' : 'NORMAL',
        },
        idempotencyKey: `practical-due:${row.assignmentId}:${daysRemaining}:${dateKey(new Date())}`,
      });
      due += 1;
    }
    if (daysRemaining < 0 && [-1, -3, -7, -14, -30].includes(daysRemaining)) {
      const recipients = [{ userType: 'trainee', userId: row.employeeId, priority: 'HIGH' }];
      if (row.coordinatorId) recipients.push({ userType: 'coordinator', userId: row.coordinatorId, priority: 'HIGH' });
      await emitNotificationEvent({
        eventType: 'PRACTICAL_OVERDUE',
        entityType: 'PRACTICAL_ASSIGNMENT',
        entityId: row.assignmentId,
        branch: row.branch || '',
        processName: row.processName || '',
        lobName: row.lobName || '',
        payload: {
          ...common,
          recipients,
          overdueDays: Math.abs(daysRemaining),
          priority: 'HIGH',
        },
        idempotencyKey: `practical-overdue:${row.assignmentId}:${Math.abs(daysRemaining)}:${dateKey(new Date())}`,
      });
      overdue += 1;
    }
  }
  return { scanned: rows.length, due, overdue, generated: due + overdue };
}

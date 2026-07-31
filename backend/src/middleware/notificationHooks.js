import { prisma } from '../utils/db.js';
import { emitNotificationEvent } from '../services/notificationOutbox.js';

function safeBody(value) {
  return value && typeof value === 'object' ? value : {};
}

async function iltContext(sessionId, employeeId) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT s.session_id AS sessionId, s.session_code AS sessionCode,
            s.title AS sessionTitle, s.start_at AS startAt, s.end_at AS endAt,
            s.branch, s.process_name AS processName, s.lob_name AS lobName,
            s.delivery_mode AS deliveryMode, s.virtual_join_url AS virtualJoinUrl,
            v.venue_name AS venueName, v.room_location AS roomLocation,
            e.enrollment_id AS enrollmentId, e.status AS enrollmentStatus,
            e.waitlist_position AS waitlistPosition,
            t.employee_id AS employeeId, t.trainee_name AS traineeName,
            t.email, t.mobile, t.batch_no AS batchNo
       FROM ilt_session s
       LEFT JOIN ilt_venue v ON v.venue_id = s.venue_id
       LEFT JOIN ilt_session_enrollment e
              ON e.session_id = s.session_id AND e.employee_id = ?
       LEFT JOIN trainee_master t ON t.employee_id = ?
      WHERE s.session_id = ? LIMIT 1`,
    String(employeeId), String(employeeId), String(sessionId),
  );
  return rows[0] || null;
}

async function emitIltEnrollment(sessionId, employeeId, status, suffix = '') {
  const context = await iltContext(sessionId, employeeId);
  if (!context) return;
  const eventType = status === 'WAITLISTED' ? 'ILT_WAITLISTED' : 'ILT_ENROLLMENT_CONFIRMED';
  await emitNotificationEvent({
    eventType,
    entityType: 'ILT_SESSION',
    entityId: sessionId,
    branch: context.branch || '',
    processName: context.processName || '',
    lobName: context.lobName || '',
    payload: {
      ...context,
      startAt: context.startAt instanceof Date ? context.startAt.toISOString() : context.startAt,
      endAt: context.endAt instanceof Date ? context.endAt.toISOString() : context.endAt,
      recipientType: 'trainee',
      recipientId: employeeId,
      priority: 'HIGH',
    },
    idempotencyKey: `ilt-enrol:${sessionId}:${employeeId}:${status}${suffix ? `:${suffix}` : ''}`,
  });
}

async function emitWaitlistPromotion(sessionId, employeeId) {
  const context = await iltContext(sessionId, employeeId);
  if (!context) return;
  await emitNotificationEvent({
    eventType: 'ILT_WAITLIST_PROMOTED',
    entityType: 'ILT_SESSION',
    entityId: sessionId,
    branch: context.branch || '',
    processName: context.processName || '',
    lobName: context.lobName || '',
    payload: {
      ...context,
      startAt: context.startAt instanceof Date ? context.startAt.toISOString() : context.startAt,
      recipientType: 'trainee',
      recipientId: employeeId,
      priority: 'CRITICAL',
    },
    idempotencyKey: `ilt-promoted:${sessionId}:${employeeId}`,
  });
}

async function emitSessionCancellation(sessionId, reason) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT s.session_id AS sessionId, s.session_code AS sessionCode,
            s.title AS sessionTitle, s.start_at AS startAt,
            s.branch, s.process_name AS processName, s.lob_name AS lobName,
            e.employee_id AS employeeId, t.trainee_name AS traineeName
       FROM ilt_session s
       INNER JOIN ilt_session_enrollment e ON e.session_id = s.session_id
       LEFT JOIN trainee_master t ON t.employee_id = e.employee_id
      WHERE s.session_id = ? AND e.status = 'CANCELLED'`,
    String(sessionId),
  );
  for (const row of rows) {
    await emitNotificationEvent({
      eventType: 'ILT_SESSION_CANCELLED',
      entityType: 'ILT_SESSION',
      entityId: sessionId,
      branch: row.branch || '',
      processName: row.processName || '',
      lobName: row.lobName || '',
      payload: {
        ...row,
        startAt: row.startAt instanceof Date ? row.startAt.toISOString() : row.startAt,
        cancellationReason: reason || 'Session cancelled by training operations.',
        recipientType: 'trainee',
        recipientId: row.employeeId,
        priority: 'CRITICAL',
      },
      idempotencyKey: `ilt-cancelled:${sessionId}:${row.employeeId}`,
    });
  }
}

async function emitNoShows(sessionId) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT s.session_id AS sessionId, s.session_code AS sessionCode,
            s.title AS sessionTitle, s.start_at AS startAt,
            s.branch, s.process_name AS processName, s.lob_name AS lobName,
            e.employee_id AS employeeId, t.trainee_name AS traineeName,
            s.minimum_attendance_pct AS minimumAttendancePct
       FROM ilt_session s
       INNER JOIN ilt_session_enrollment e ON e.session_id = s.session_id
       LEFT JOIN trainee_master t ON t.employee_id = e.employee_id
      WHERE s.session_id = ? AND e.status = 'NO_SHOW'`,
    String(sessionId),
  );
  for (const row of rows) {
    await emitNotificationEvent({
      eventType: 'ILT_NO_SHOW',
      entityType: 'ILT_SESSION',
      entityId: sessionId,
      branch: row.branch || '',
      processName: row.processName || '',
      lobName: row.lobName || '',
      payload: {
        ...row,
        startAt: row.startAt instanceof Date ? row.startAt.toISOString() : row.startAt,
        recipientType: 'trainee',
        recipientId: row.employeeId,
        priority: 'HIGH',
      },
      idempotencyKey: `ilt-no-show:${sessionId}:${row.employeeId}`,
    });
  }
}

async function emitCoachingSession(planId, sessionId) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT cp.plan_id AS planId, cp.employee_id AS employeeId,
            cp.branch, cp.process_name AS processName, cp.lob_name AS lobName,
            cp.title AS planTitle, cs.session_id AS coachingSessionId,
            cs.scheduled_at AS scheduledAt, cs.agenda,
            t.trainee_name AS traineeName
       FROM coaching_session cs
       INNER JOIN coaching_plan cp ON cp.plan_id = cs.plan_id
       LEFT JOIN trainee_master t ON t.employee_id = cp.employee_id
      WHERE cp.plan_id = ? AND cs.session_id = ? LIMIT 1`,
    String(planId), String(sessionId),
  );
  const row = rows[0];
  if (!row) return;
  await emitNotificationEvent({
    eventType: 'COACHING_SESSION_SCHEDULED',
    entityType: 'COACHING_SESSION',
    entityId: sessionId,
    branch: row.branch || '',
    processName: row.processName || '',
    lobName: row.lobName || '',
    payload: {
      ...row,
      scheduledAt: row.scheduledAt instanceof Date ? row.scheduledAt.toISOString() : row.scheduledAt,
      recipientType: 'trainee',
      recipientId: row.employeeId,
      priority: 'NORMAL',
    },
    idempotencyKey: `coaching-scheduled:${sessionId}:${row.employeeId}`,
  });
}

async function emitCredentialRenewed(caseId) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT crc.case_id AS caseId, crc.employee_id AS employeeId,
            crc.renewed_certification_id AS certificationId,
            ec.credential_number AS credentialNumber,
            ec.certification_type AS certificationType,
            ec.issued_at AS issuedAt, ec.expires_at AS expiresAt,
            ec.branch, ec.process_name AS processName, ec.lob_name AS lobName,
            t.trainee_name AS traineeName
       FROM certification_renewal_case crc
       INNER JOIN employee_certification ec ON ec.certification_id = crc.renewed_certification_id
       LEFT JOIN trainee_master t ON t.employee_id = crc.employee_id
      WHERE crc.case_id = ? AND crc.status = 'COMPLETED' LIMIT 1`,
    String(caseId),
  );
  const row = rows[0];
  if (!row) return;
  await emitNotificationEvent({
    eventType: 'CERT_RENEWED',
    entityType: 'CERTIFICATION_RENEWAL',
    entityId: caseId,
    branch: row.branch || '',
    processName: row.processName || '',
    lobName: row.lobName || '',
    payload: {
      ...row,
      issuedAt: row.issuedAt instanceof Date ? row.issuedAt.toISOString() : row.issuedAt,
      expiresAt: row.expiresAt instanceof Date ? row.expiresAt.toISOString() : row.expiresAt,
      recipientType: 'trainee',
      recipientId: row.employeeId,
      priority: 'HIGH',
    },
    idempotencyKey: `cert-renewed:${caseId}:${row.certificationId}`,
  });
}

async function handleSuccessfulAction(req, responseBody) {
  const path = req.originalUrl.split('?')[0];
  const body = safeBody(responseBody);
  const enrolMatch = path.match(/^\/api\/ilt\/trainee\/sessions\/([^/]+)\/enroll$/);
  if (req.method === 'POST' && enrolMatch && body.ok) {
    const enrollment = body.data?.enrollment || body.data?.data?.enrollment;
    if (enrollment?.employeeId && enrollment?.status) {
      await emitIltEnrollment(enrolMatch[1], enrollment.employeeId, enrollment.status);
    }
    return;
  }

  const bulkMatch = path.match(/^\/api\/ilt\/(coordinator|admin)\/sessions\/([^/]+)\/enroll$/);
  if (req.method === 'POST' && bulkMatch && body.ok && Array.isArray(body.data)) {
    for (const result of body.data.filter(item => item.ok && item.employeeId && item.status)) {
      await emitIltEnrollment(bulkMatch[2], result.employeeId, result.status);
    }
    return;
  }

  const cancelEnrollmentMatch = path.match(/^\/api\/ilt\/trainee\/enrollments\/([^/]+)\/cancel$/);
  if (req.method === 'POST' && cancelEnrollmentMatch && body.ok) {
    const sessionId = body.data?.enrollment?.sessionId;
    for (const employeeId of body.data?.promoted || []) {
      await emitWaitlistPromotion(sessionId, employeeId);
    }
    return;
  }

  const cancelSessionMatch = path.match(/^\/api\/ilt\/(coordinator|admin)\/sessions\/([^/]+)\/cancel$/);
  if (req.method === 'POST' && cancelSessionMatch && body.ok) {
    await emitSessionCancellation(cancelSessionMatch[2], req.body?.reason);
    return;
  }

  const finalizeMatch = path.match(/^\/api\/ilt\/(coordinator|admin)\/sessions\/([^/]+)\/finalize$/);
  if (req.method === 'POST' && finalizeMatch && body.ok) {
    await emitNoShows(finalizeMatch[2]);
    return;
  }

  const coachingMatch = path.match(/^\/api\/development\/(coordinator|admin)\/plans\/([^/]+)\/sessions$/);
  if (req.method === 'POST' && coachingMatch && body.ok && body.data?.sessionId) {
    await emitCoachingSession(coachingMatch[2], body.data.sessionId);
    return;
  }

  const renewMatch = path.match(/^\/api\/development\/(coordinator|admin)\/renewals\/([^/]+)\/renew$/);
  if (req.method === 'POST' && renewMatch && body.ok) {
    await emitCredentialRenewed(renewMatch[2]);
  }
}

export function notificationEventHooks(req, res, next) {
  const originalJson = res.json.bind(res);
  let handled = false;
  res.json = payload => {
    const successful = res.statusCode >= 200 && res.statusCode < 300;
    if (!handled && successful) {
      handled = true;
      setImmediate(() => {
        handleSuccessfulAction(req, payload).catch(error => {
          console.warn(`[NOTIFY] Event hook failed for ${req.method} ${req.originalUrl}:`, error.message);
        });
      });
    }
    return originalJson(payload);
  };
  next();
}

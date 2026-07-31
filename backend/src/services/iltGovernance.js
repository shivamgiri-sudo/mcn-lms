import { createHash, randomInt, randomUUID } from 'crypto';
import { prisma } from '../utils/db.js';
import { syncEmployeeSkills, syncLearningPaths } from './talentGovernance.js';

function fail(status, message, code = 'ILT_ERROR') {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  throw error;
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function truthy(value) {
  return value === true || value === 1 || value === '1' || String(value || '').toLowerCase() === 'true';
}

function asDate(value) {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function hashCode(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function normalizeValue(value) {
  if (typeof value === 'bigint') return Number(value);
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeValue(item)]));
  }
  return value;
}

function overlapSql(alias = 's') {
  return `${alias}.start_at < ? AND ${alias}.end_at > ?`;
}

function durationMinutes(startAt, endAt) {
  const start = asDate(startAt);
  const end = asDate(endAt);
  if (!start || !end || end <= start) return 0;
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / 60000));
}

async function sessionRow(sessionId, db = prisma, lock = false) {
  const rows = await db.$queryRawUnsafe(
    `SELECT s.session_id AS sessionId, s.session_code AS sessionCode,
            s.series_id AS seriesId, s.occurrence_no AS occurrenceNo,
            s.classroom_id AS classroomId, s.module_id AS moduleId,
            s.batch_no AS batchNo, s.title, s.description,
            s.session_type AS sessionType, s.delivery_mode AS deliveryMode,
            s.branch, s.process_name AS processName, s.lob_name AS lobName,
            s.venue_id AS venueId, s.virtual_join_url AS virtualJoinUrl,
            s.timezone, s.start_at AS startAt, s.end_at AS endAt,
            s.registration_open_at AS registrationOpenAt,
            s.registration_close_at AS registrationCloseAt,
            s.capacity, s.minimum_attendees AS minimumAttendees,
            s.waitlist_enabled AS waitlistEnabled,
            s.self_enrollment_enabled AS selfEnrollmentEnabled,
            s.minimum_attendance_pct AS minimumAttendancePct,
            s.status, s.checkin_open_at AS checkinOpenAt,
            s.checkin_close_at AS checkinCloseAt,
            s.published_at AS publishedAt, s.started_at AS startedAt,
            s.completed_at AS completedAt, s.cancelled_at AS cancelledAt,
            s.cancellation_reason AS cancellationReason,
            v.venue_name AS venueName, v.venue_code AS venueCode,
            v.venue_type AS venueType, v.room_location AS roomLocation,
            v.capacity AS venueCapacity
       FROM ilt_session s
       LEFT JOIN ilt_venue v ON v.venue_id = s.venue_id
      WHERE s.session_id = ? LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
    String(sessionId),
  );
  return normalizeValue(rows[0] || null);
}

export async function resolveIltPolicy({ branch = '', processName = '', lobName = '' }, db = prisma) {
  const rows = await db.$queryRawUnsafe(
    `SELECT policy_id AS policyId, branch, process_name AS processName,
            lob_name AS lobName, default_capacity AS defaultCapacity,
            waitlist_enabled AS waitlistEnabled,
            auto_promote_waitlist AS autoPromoteWaitlist,
            self_enrollment_enabled AS selfEnrollmentEnabled,
            minimum_attendance_pct AS minimumAttendancePct,
            checkin_open_before_mins AS checkinOpenBeforeMins,
            checkin_close_after_mins AS checkinCloseAfterMins,
            cancellation_cutoff_mins AS cancellationCutoffMins
       FROM ilt_policy
      WHERE active = 1
        AND (branch = '' OR branch = ?)
        AND (process_name = '' OR process_name = ?)
        AND (lob_name = '' OR lob_name = ?)
      ORDER BY (branch <> '') DESC, (process_name <> '') DESC, (lob_name <> '') DESC
      LIMIT 1`,
    String(branch || ''), String(processName || ''), String(lobName || ''),
  );
  return normalizeValue(rows[0] || {
    defaultCapacity: 25,
    waitlistEnabled: 1,
    autoPromoteWaitlist: 1,
    selfEnrollmentEnabled: 1,
    minimumAttendancePct: 80,
    checkinOpenBeforeMins: 30,
    checkinCloseAfterMins: 30,
    cancellationCutoffMins: 120,
  });
}

export async function validateScheduleConflicts({ sessionId = null, venueId = null, batchNo = null, instructorIds = [], startAt, endAt }, db = prisma) {
  const start = asDate(startAt);
  const end = asDate(endAt);
  if (!start || !end || end <= start) fail(400, 'Session end time must be after the start time.', 'INVALID_SESSION_TIME');
  const excluded = sessionId ? String(sessionId) : '';
  const conflicts = { venue: [], batch: [], instructors: [] };

  if (venueId) {
    conflicts.venue = normalizeValue(await db.$queryRawUnsafe(
      `SELECT session_id AS sessionId, session_code AS sessionCode, title,
              start_at AS startAt, end_at AS endAt
         FROM ilt_session s
        WHERE s.venue_id = ? AND s.session_id <> ?
          AND s.status IN ('PUBLISHED', 'IN_PROGRESS')
          AND ${overlapSql('s')}
        ORDER BY s.start_at`,
      String(venueId), excluded, end, start,
    ));
  }

  if (batchNo) {
    conflicts.batch = normalizeValue(await db.$queryRawUnsafe(
      `SELECT session_id AS sessionId, session_code AS sessionCode, title,
              start_at AS startAt, end_at AS endAt
         FROM ilt_session s
        WHERE s.batch_no = ? AND s.session_id <> ?
          AND s.status IN ('PUBLISHED', 'IN_PROGRESS')
          AND ${overlapSql('s')}
        ORDER BY s.start_at`,
      String(batchNo), excluded, end, start,
    ));
  }

  if (instructorIds.length) {
    const placeholders = instructorIds.map(() => '?').join(',');
    conflicts.instructors = normalizeValue(await db.$queryRawUnsafe(
      `SELECT si.instructor_id AS instructorId, i.instructor_name AS instructorName,
              s.session_id AS sessionId, s.session_code AS sessionCode,
              s.title, s.start_at AS startAt, s.end_at AS endAt
         FROM ilt_session_instructor si
         INNER JOIN ilt_instructor i ON i.instructor_id = si.instructor_id
         INNER JOIN ilt_session s ON s.session_id = si.session_id
        WHERE si.instructor_id IN (${placeholders})
          AND s.session_id <> ?
          AND si.confirmation_status <> 'DECLINED'
          AND s.status IN ('PUBLISHED', 'IN_PROGRESS')
          AND ${overlapSql('s')}
        ORDER BY s.start_at`,
      ...instructorIds.map(String), excluded, end, start,
    ));
  }

  return { conflicts, hasConflict: Object.values(conflicts).some(rows => rows.length > 0) };
}

async function prerequisiteResult(sessionId, trainee, db = prisma) {
  const prerequisites = normalizeValue(await db.$queryRawUnsafe(
    `SELECT prerequisite_id AS prerequisiteId,
            prerequisite_type AS prerequisiteType,
            reference_id AS referenceId,
            minimum_score AS minimumScore, minimum_level AS minimumLevel,
            required
       FROM ilt_session_prerequisite
      WHERE session_id = ? AND active = 1
      ORDER BY required DESC, prerequisite_type, reference_id`,
    String(sessionId),
  ));
  if (!prerequisites.length) return { eligible: true, blockers: [], prerequisites: [] };

  const blockers = [];
  const evaluated = [];
  for (const item of prerequisites) {
    const type = String(item.prerequisiteType || '').toUpperCase();
    let passed = false;
    let actual = null;
    if (type === 'CONTENT') {
      const row = await db.contentProgress.findUnique({
        where: { employeeId_contentId: { employeeId: trainee.employeeId, contentId: item.referenceId } },
      });
      actual = number(row?.completionPct);
      passed = row?.completionStatus === 'Completed' || actual >= number(item.minimumScore, 100);
    } else if (type === 'ASSESSMENT') {
      const row = await db.assessmentResult.findUnique({
        where: { employeeId_assessmentId: { employeeId: trainee.employeeId, assessmentId: item.referenceId } },
      });
      actual = number(row?.bestPercentage);
      passed = row?.result === 'Pass' && actual >= number(item.minimumScore, 0);
    } else if (type === 'SKILL') {
      const rows = await db.$queryRawUnsafe(
        `SELECT current_level AS currentLevel FROM employee_skill_profile
          WHERE employee_id = ? AND skill_id = ? LIMIT 1`,
        String(trainee.employeeId), String(item.referenceId),
      );
      actual = number(rows[0]?.currentLevel);
      passed = actual >= number(item.minimumLevel, 1);
    } else if (type === 'PATH') {
      const rows = await db.$queryRawUnsafe(
        `SELECT status, progress_pct AS progressPct FROM learning_path_enrollment
          WHERE employee_id = ? AND path_id = ? LIMIT 1`,
        String(trainee.employeeId), String(item.referenceId),
      );
      actual = number(rows[0]?.progressPct);
      passed = rows[0]?.status === 'COMPLETED' || actual >= number(item.minimumScore, 100);
    } else if (type === 'CLASSROOM') {
      const row = await db.traineeClassroomMap.findFirst({
        where: { employeeId: trainee.employeeId, classroomId: item.referenceId, active: true },
      });
      actual = row ? 100 : 0;
      passed = Boolean(row);
    } else {
      passed = false;
    }
    const result = { ...item, passed, actual };
    evaluated.push(result);
    if (truthy(item.required) && !passed) blockers.push(result);
  }
  return { eligible: blockers.length === 0, blockers, prerequisites: evaluated };
}

async function ensureTraineeEligible(session, employeeId, db = prisma) {
  const trainee = await db.traineeMaster.findUnique({ where: { employeeId: String(employeeId) } });
  if (!trainee || trainee.status !== 'Active') fail(404, 'Active learner not found.', 'LEARNER_NOT_FOUND');
  if (session.batchNo && String(trainee.batchNo || '') !== String(session.batchNo)) {
    fail(403, 'This session is restricted to another batch.', 'SESSION_BATCH_RESTRICTED');
  }
  if (session.branch && String(trainee.branch || '') !== String(session.branch)) {
    fail(403, 'This session is outside the learner branch.', 'SESSION_BRANCH_RESTRICTED');
  }
  if (session.processName && String(trainee.process || '') !== String(session.processName)) {
    fail(403, 'This session is outside the learner process.', 'SESSION_PROCESS_RESTRICTED');
  }
  if (session.lobName && String(trainee.lob || '') !== String(session.lobName)) {
    fail(403, 'This session is outside the learner LOB.', 'SESSION_LOB_RESTRICTED');
  }
  const prerequisites = await prerequisiteResult(session.sessionId, trainee, db);
  if (!prerequisites.eligible) fail(409, 'Session prerequisites are not complete.', 'PREREQUISITES_INCOMPLETE');
  return { trainee, prerequisites };
}

async function employeeScheduleConflict(session, employeeId, db = prisma) {
  const rows = await db.$queryRawUnsafe(
    `SELECT s.session_id AS sessionId, s.session_code AS sessionCode,
            s.title, s.start_at AS startAt, s.end_at AS endAt
       FROM ilt_session_enrollment e
       INNER JOIN ilt_session s ON s.session_id = e.session_id
      WHERE e.employee_id = ? AND s.session_id <> ?
        AND e.status IN ('CONFIRMED', 'ATTENDED')
        AND s.status IN ('PUBLISHED', 'IN_PROGRESS')
        AND ${overlapSql('s')}
      LIMIT 10`,
    String(employeeId), String(session.sessionId), session.endAt, session.startAt,
  );
  return normalizeValue(rows);
}

async function addEnrollmentEvent(db, enrollment, eventType, fromStatus, toStatus, actorId, actorType, reason = null) {
  await db.$executeRawUnsafe(
    `INSERT INTO ilt_enrollment_event
       (event_id, enrollment_id, session_id, employee_id, event_type,
        from_status, to_status, reason, actor_id, actor_type)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    randomUUID(), String(enrollment.enrollmentId), String(enrollment.sessionId), String(enrollment.employeeId),
    String(eventType), fromStatus || null, toStatus || null, reason || null,
    actorId ? String(actorId) : null, actorType ? String(actorType) : null,
  );
}

async function promoteWaitlist(db, session, actorId, actorType) {
  if (!truthy(session.waitlistEnabled)) return [];
  const promoted = [];
  const lockedConfirmed = await db.$queryRawUnsafe(
    `SELECT enrollment_id FROM ilt_session_enrollment
      WHERE session_id = ? AND status IN ('CONFIRMED', 'ATTENDED') FOR UPDATE`,
    String(session.sessionId),
  );
  let available = Math.max(0, number(session.capacity) - lockedConfirmed.length);
  while (available > 0) {
    const rows = await db.$queryRawUnsafe(
      `SELECT enrollment_id AS enrollmentId, session_id AS sessionId,
              employee_id AS employeeId, status, waitlist_position AS waitlistPosition
         FROM ilt_session_enrollment
        WHERE session_id = ? AND status = 'WAITLISTED'
        ORDER BY waitlist_position, enrolled_at
        LIMIT 1 FOR UPDATE`,
      String(session.sessionId),
    );
    const next = normalizeValue(rows[0] || null);
    if (!next) break;
    await db.$executeRawUnsafe(
      `UPDATE ilt_session_enrollment
          SET status = 'CONFIRMED', waitlist_position = NULL,
              confirmed_at = UTC_TIMESTAMP(3), promoted_at = UTC_TIMESTAMP(3)
        WHERE enrollment_id = ?`,
      String(next.enrollmentId),
    );
    await addEnrollmentEvent(db, next, 'WAITLIST_PROMOTED', 'WAITLISTED', 'CONFIRMED', actorId, actorType, 'Seat became available.');
    promoted.push(next.employeeId);
    available -= 1;
  }
  return promoted;
}

export async function enrollEmployee({ sessionId, employeeId, source = 'SELF', actorId, actorType = 'trainee' }) {
  return prisma.$transaction(async tx => {
    const session = await sessionRow(sessionId, tx, true);
    if (!session) fail(404, 'Live session not found.', 'SESSION_NOT_FOUND');
    if (session.status !== 'PUBLISHED') fail(409, 'Only published sessions accept enrolment.', 'SESSION_NOT_OPEN');
    const now = new Date();
    if (session.registrationOpenAt && now < new Date(session.registrationOpenAt)) fail(409, 'Registration has not opened.', 'REGISTRATION_NOT_OPEN');
    if (session.registrationCloseAt && now > new Date(session.registrationCloseAt)) fail(409, 'Registration is closed.', 'REGISTRATION_CLOSED');
    if (actorType === 'trainee' && !truthy(session.selfEnrollmentEnabled)) fail(403, 'Self-enrolment is disabled for this session.', 'SELF_ENROLLMENT_DISABLED');

    const { trainee, prerequisites } = await ensureTraineeEligible(session, employeeId, tx);
    const overlaps = await employeeScheduleConflict(session, employeeId, tx);
    if (overlaps.length) fail(409, 'The learner is already confirmed in an overlapping session.', 'LEARNER_SCHEDULE_CONFLICT');

    const existingRows = await tx.$queryRawUnsafe(
      `SELECT enrollment_id AS enrollmentId, session_id AS sessionId,
              employee_id AS employeeId, status, waitlist_position AS waitlistPosition
         FROM ilt_session_enrollment
        WHERE session_id = ? AND employee_id = ? LIMIT 1 FOR UPDATE`,
      String(sessionId), String(employeeId),
    );
    const existing = normalizeValue(existingRows[0] || null);
    if (existing && ['CONFIRMED', 'WAITLISTED', 'ATTENDED'].includes(existing.status)) {
      return { enrollment: existing, prerequisites, unchanged: true };
    }

    const confirmedRows = await tx.$queryRawUnsafe(
      `SELECT enrollment_id FROM ilt_session_enrollment
        WHERE session_id = ? AND status IN ('CONFIRMED', 'ATTENDED') FOR UPDATE`,
      String(sessionId),
    );
    let status = confirmedRows.length < number(session.capacity) ? 'CONFIRMED' : 'WAITLISTED';
    if (status === 'WAITLISTED' && !truthy(session.waitlistEnabled)) fail(409, 'The session is full and waitlisting is disabled.', 'SESSION_FULL');
    let waitlistPosition = null;
    if (status === 'WAITLISTED') {
      const rows = await tx.$queryRawUnsafe(
        `SELECT COALESCE(MAX(waitlist_position), 0) + 1 AS nextPosition
           FROM ilt_session_enrollment WHERE session_id = ? AND status = 'WAITLISTED' FOR UPDATE`,
        String(sessionId),
      );
      waitlistPosition = number(rows[0]?.nextPosition, 1);
    }

    const enrollmentId = existing?.enrollmentId || randomUUID();
    if (existing) {
      await tx.$executeRawUnsafe(
        `UPDATE ilt_session_enrollment
            SET status = ?, waitlist_position = ?, source = ?, enrolled_by = ?,
                enrolled_at = UTC_TIMESTAMP(3), confirmed_at = ?, promoted_at = NULL,
                cancelled_at = NULL, cancellation_reason = NULL
          WHERE enrollment_id = ?`,
        status, waitlistPosition, String(source), actorId ? String(actorId) : null,
        status === 'CONFIRMED' ? new Date() : null, String(enrollmentId),
      );
    } else {
      await tx.$executeRawUnsafe(
        `INSERT INTO ilt_session_enrollment
           (enrollment_id, session_id, employee_id, batch_no, status,
            waitlist_position, source, enrolled_by, confirmed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        enrollmentId, String(sessionId), String(employeeId), trainee.batchNo || null,
        status, waitlistPosition, String(source), actorId ? String(actorId) : null,
        status === 'CONFIRMED' ? new Date() : null,
      );
    }
    const enrollment = { enrollmentId, sessionId, employeeId, status, waitlistPosition };
    await addEnrollmentEvent(tx, enrollment, existing ? 'REENROLLED' : 'ENROLLED', existing?.status || null, status, actorId, actorType);
    return { enrollment, prerequisites, unchanged: false };
  });
}

export async function cancelEnrollment({ enrollmentId, actorId, actorType = 'trainee', reason = '' }) {
  return prisma.$transaction(async tx => {
    const rows = await tx.$queryRawUnsafe(
      `SELECT e.enrollment_id AS enrollmentId, e.session_id AS sessionId,
              e.employee_id AS employeeId, e.status,
              s.start_at AS startAt, s.branch, s.process_name AS processName,
              s.lob_name AS lobName
         FROM ilt_session_enrollment e
         INNER JOIN ilt_session s ON s.session_id = e.session_id
        WHERE e.enrollment_id = ? LIMIT 1 FOR UPDATE`,
      String(enrollmentId),
    );
    const enrollment = normalizeValue(rows[0] || null);
    if (!enrollment) fail(404, 'Enrolment not found.', 'ENROLLMENT_NOT_FOUND');
    if (actorType === 'trainee' && String(enrollment.employeeId) !== String(actorId)) fail(403, 'This enrolment belongs to another learner.', 'ENROLLMENT_SCOPE');
    if (['CANCELLED', 'ATTENDED', 'NO_SHOW'].includes(enrollment.status)) return { enrollment, promoted: [], unchanged: true };

    if (actorType === 'trainee') {
      const policy = await resolveIltPolicy(enrollment, tx);
      const cutoff = number(policy.cancellationCutoffMins, 120) * 60000;
      if (new Date(enrollment.startAt).getTime() - Date.now() < cutoff) {
        fail(409, 'The self-cancellation cutoff has passed. Contact the coordinator.', 'CANCELLATION_CUTOFF');
      }
    }

    await tx.$executeRawUnsafe(
      `UPDATE ilt_session_enrollment
          SET status = 'CANCELLED', waitlist_position = NULL,
              cancelled_at = UTC_TIMESTAMP(3), cancellation_reason = ?
        WHERE enrollment_id = ?`,
      String(reason || 'Cancelled by user'), String(enrollmentId),
    );
    await addEnrollmentEvent(tx, enrollment, 'CANCELLED', enrollment.status, 'CANCELLED', actorId, actorType, reason || null);
    const session = await sessionRow(enrollment.sessionId, tx, true);
    const policy = await resolveIltPolicy(session, tx);
    const promoted = truthy(policy.autoPromoteWaitlist) ? await promoteWaitlist(tx, session, actorId, actorType) : [];
    return { enrollment: { ...enrollment, status: 'CANCELLED' }, promoted, unchanged: false };
  });
}

export async function publishSession(sessionId, actorId) {
  return prisma.$transaction(async tx => {
    const session = await sessionRow(sessionId, tx, true);
    if (!session) fail(404, 'Live session not found.', 'SESSION_NOT_FOUND');
    if (!['DRAFT', 'PUBLISHED'].includes(session.status)) fail(409, 'Only draft sessions can be published.', 'SESSION_NOT_DRAFT');
    if (new Date(session.endAt) <= new Date()) fail(409, 'Past sessions cannot be published.', 'SESSION_IN_PAST');
    if (session.venueId && number(session.venueCapacity) < number(session.capacity)) {
      fail(409, 'Session capacity exceeds venue capacity.', 'VENUE_CAPACITY_EXCEEDED');
    }
    const instructorRows = await tx.$queryRawUnsafe(
      `SELECT instructor_id AS instructorId, instructor_role AS instructorRole
         FROM ilt_session_instructor
        WHERE session_id = ? AND confirmation_status <> 'DECLINED'`,
      String(sessionId),
    );
    const instructorIds = instructorRows.map(row => row.instructorId);
    if (!instructorRows.some(row => row.instructorRole === 'LEAD')) fail(409, 'A lead instructor is required before publishing.', 'LEAD_INSTRUCTOR_REQUIRED');
    const conflictResult = await validateScheduleConflicts({ ...session, instructorIds }, tx);
    if (conflictResult.hasConflict) {
      const error = new Error('Venue, batch or instructor schedule conflict detected.');
      error.status = 409;
      error.code = 'SCHEDULE_CONFLICT';
      error.details = conflictResult.conflicts;
      throw error;
    }
    await tx.$executeRawUnsafe(
      `UPDATE ilt_session SET status = 'PUBLISHED', published_at = COALESCE(published_at, UTC_TIMESTAMP(3)),
              updated_by = ? WHERE session_id = ?`,
      String(actorId), String(sessionId),
    );
    return { ...session, status: 'PUBLISHED', conflicts: conflictResult.conflicts };
  });
}

export async function rotateCheckinCode(sessionId, actorId) {
  const session = await sessionRow(sessionId);
  if (!session) fail(404, 'Live session not found.', 'SESSION_NOT_FOUND');
  if (!['PUBLISHED', 'IN_PROGRESS'].includes(session.status)) fail(409, 'Check-in is only available for published sessions.', 'CHECKIN_NOT_AVAILABLE');
  const policy = await resolveIltPolicy(session);
  const code = String(randomInt(100000, 1000000));
  const openAt = new Date(new Date(session.startAt).getTime() - number(policy.checkinOpenBeforeMins, 30) * 60000);
  const closeAt = new Date(new Date(session.startAt).getTime() + number(policy.checkinCloseAfterMins, 30) * 60000);
  await prisma.$executeRawUnsafe(
    `UPDATE ilt_session SET checkin_code_hash = ?, checkin_open_at = ?, checkin_close_at = ?, updated_by = ?
      WHERE session_id = ?`,
    hashCode(code), openAt, closeAt, String(actorId), String(sessionId),
  );
  return { code, openAt, closeAt };
}

export async function learnerCheckin({ sessionId, employeeId, code }) {
  return prisma.$transaction(async tx => {
    const session = await sessionRow(sessionId, tx, true);
    if (!session) fail(404, 'Live session not found.', 'SESSION_NOT_FOUND');
    const now = new Date();
    if (!session.checkinOpenAt || !session.checkinCloseAt || now < new Date(session.checkinOpenAt) || now > new Date(session.checkinCloseAt)) {
      fail(409, 'The session check-in window is closed.', 'CHECKIN_WINDOW_CLOSED');
    }
    const hashRows = await tx.$queryRawUnsafe(`SELECT checkin_code_hash AS codeHash FROM ilt_session WHERE session_id = ? LIMIT 1`, String(sessionId));
    if (!hashRows[0]?.codeHash || hashCode(code) !== hashRows[0].codeHash) fail(400, 'Invalid check-in code.', 'INVALID_CHECKIN_CODE');
    const enrollmentRows = await tx.$queryRawUnsafe(
      `SELECT enrollment_id AS enrollmentId, status FROM ilt_session_enrollment
        WHERE session_id = ? AND employee_id = ? LIMIT 1 FOR UPDATE`,
      String(sessionId), String(employeeId),
    );
    const enrollment = normalizeValue(enrollmentRows[0] || null);
    if (!enrollment || enrollment.status !== 'CONFIRMED') fail(409, 'A confirmed enrolment is required for check-in.', 'CONFIRMED_ENROLLMENT_REQUIRED');
    await tx.$executeRawUnsafe(
      `INSERT INTO ilt_session_attendance
         (attendance_id, session_id, employee_id, attendance_status,
          checkin_at, source, evidence_reference)
       VALUES (?, ?, ?, 'PRESENT', UTC_TIMESTAMP(3), 'SELF_CHECKIN', ?)
       ON DUPLICATE KEY UPDATE
         checkin_at = COALESCE(checkin_at, UTC_TIMESTAMP(3)),
         attendance_status = CASE WHEN locked_at IS NULL THEN 'PRESENT' ELSE attendance_status END,
         source = CASE WHEN locked_at IS NULL THEN 'SELF_CHECKIN' ELSE source END`,
      randomUUID(), String(sessionId), String(employeeId), `checkin:${sessionId}`,
    );
    await addEnrollmentEvent(tx, { ...enrollment, sessionId, employeeId }, 'CHECKED_IN', enrollment.status, enrollment.status, employeeId, 'trainee');
    return { sessionId, employeeId, checkedInAt: now };
  });
}

export async function recordAttendance({ sessionId, employeeId, attendanceStatus, checkinAt, checkoutAt, attendedMinutes, source = 'INSTRUCTOR', notes = '', actorId }) {
  const session = await sessionRow(sessionId);
  if (!session) fail(404, 'Live session not found.', 'SESSION_NOT_FOUND');
  if (session.status === 'COMPLETED') fail(409, 'Attendance is locked for a completed session.', 'ATTENDANCE_LOCKED');
  const enrollmentRows = await prisma.$queryRawUnsafe(
    `SELECT enrollment_id AS enrollmentId, status FROM ilt_session_enrollment
      WHERE session_id = ? AND employee_id = ? LIMIT 1`,
    String(sessionId), String(employeeId),
  );
  if (!enrollmentRows.length) fail(404, 'The learner is not enrolled in this session.', 'ENROLLMENT_NOT_FOUND');
  const minutes = attendedMinutes === undefined
    ? durationMinutes(checkinAt || session.startAt, checkoutAt || session.endAt)
    : Math.max(0, Math.round(number(attendedMinutes)));
  const totalMinutes = durationMinutes(session.startAt, session.endAt);
  const attendancePct = totalMinutes ? Math.min(100, Math.round((minutes / totalMinutes) * 10000) / 100) : 0;
  const status = String(attendanceStatus || (attendancePct >= number(session.minimumAttendancePct) ? 'PRESENT' : attendancePct > 0 ? 'LATE' : 'ABSENT')).toUpperCase();
  if (!['PRESENT', 'LATE', 'ABSENT', 'EXCUSED'].includes(status)) fail(400, 'Invalid attendance status.', 'INVALID_ATTENDANCE_STATUS');
  await prisma.$executeRawUnsafe(
    `INSERT INTO ilt_session_attendance
       (attendance_id, session_id, employee_id, attendance_status,
        checkin_at, checkout_at, attended_minutes, attendance_pct,
        source, evidence_reference, verified_by, verified_at, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3), ?)
     ON DUPLICATE KEY UPDATE
       attendance_status = VALUES(attendance_status), checkin_at = VALUES(checkin_at),
       checkout_at = VALUES(checkout_at), attended_minutes = VALUES(attended_minutes),
       attendance_pct = VALUES(attendance_pct), source = VALUES(source),
       evidence_reference = VALUES(evidence_reference), verified_by = VALUES(verified_by),
       verified_at = UTC_TIMESTAMP(3), notes = VALUES(notes)`,
    randomUUID(), String(sessionId), String(employeeId), status,
    asDate(checkinAt), asDate(checkoutAt), minutes, attendancePct,
    String(source), `attendance:${sessionId}`, String(actorId), notes || null,
  );
  await prisma.$executeRawUnsafe(
    `UPDATE ilt_session_enrollment SET status = ? WHERE session_id = ? AND employee_id = ?`,
    status === 'ABSENT' ? 'NO_SHOW' : 'ATTENDED', String(sessionId), String(employeeId),
  );
  return { sessionId, employeeId, attendanceStatus: status, attendedMinutes: minutes, attendancePct };
}

export async function finalizeSession(sessionId, actorId, options = {}) {
  const affectedEmployees = [];
  const result = await prisma.$transaction(async tx => {
    const session = await sessionRow(sessionId, tx, true);
    if (!session) fail(404, 'Live session not found.', 'SESSION_NOT_FOUND');
    if (session.status === 'COMPLETED') return { session, affectedEmployees: [], unchanged: true };
    if (!['PUBLISHED', 'IN_PROGRESS'].includes(session.status)) fail(409, 'Only published sessions can be finalized.', 'SESSION_NOT_FINALIZABLE');
    if (!options.allowEarly && new Date(session.endAt) > new Date()) fail(409, 'The session has not ended yet.', 'SESSION_NOT_ENDED');

    const enrollments = normalizeValue(await tx.$queryRawUnsafe(
      `SELECT enrollment_id AS enrollmentId, employee_id AS employeeId,
              batch_no AS batchNo, status
         FROM ilt_session_enrollment
        WHERE session_id = ? AND status IN ('CONFIRMED', 'ATTENDED', 'NO_SHOW') FOR UPDATE`,
      String(sessionId),
    ));
    const attendance = normalizeValue(await tx.$queryRawUnsafe(
      `SELECT employee_id AS employeeId, attendance_status AS attendanceStatus,
              attendance_pct AS attendancePct, attended_minutes AS attendedMinutes
         FROM ilt_session_attendance WHERE session_id = ? FOR UPDATE`,
      String(sessionId),
    ));
    const attendanceByEmployee = new Map(attendance.map(row => [String(row.employeeId), row]));

    for (const enrollment of enrollments) {
      let record = attendanceByEmployee.get(String(enrollment.employeeId));
      if (!record) {
        await tx.$executeRawUnsafe(
          `INSERT INTO ilt_session_attendance
             (attendance_id, session_id, employee_id, attendance_status,
              attended_minutes, attendance_pct, source, evidence_reference,
              verified_by, verified_at, locked_at, notes)
           VALUES (?, ?, ?, 'ABSENT', 0, 0, 'SYSTEM', ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), 'No verified attendance recorded.')`,
          randomUUID(), String(sessionId), String(enrollment.employeeId),
          `attendance:${sessionId}`, String(actorId),
        );
        record = { employeeId: enrollment.employeeId, attendanceStatus: 'ABSENT', attendancePct: 0, attendedMinutes: 0 };
      } else {
        await tx.$executeRawUnsafe(
          `UPDATE ilt_session_attendance SET locked_at = UTC_TIMESTAMP(3),
                  verified_by = COALESCE(verified_by, ?), verified_at = COALESCE(verified_at, UTC_TIMESTAMP(3))
            WHERE session_id = ? AND employee_id = ?`,
          String(actorId), String(sessionId), String(enrollment.employeeId),
        );
      }
      const passed = ['PRESENT', 'LATE', 'EXCUSED'].includes(record.attendanceStatus)
        && number(record.attendancePct) >= number(session.minimumAttendancePct);
      await tx.$executeRawUnsafe(
        `UPDATE ilt_session_enrollment SET status = ? WHERE session_id = ? AND employee_id = ?`,
        passed ? 'ATTENDED' : 'NO_SHOW', String(sessionId), String(enrollment.employeeId),
      );

      const trainee = await tx.traineeMaster.findUnique({ where: { employeeId: enrollment.employeeId } });
      if (trainee?.batchNo) {
        const finalAttendance = passed ? 'Present' : 'Absent';
        const remarks = `ILT ${session.sessionCode}: ${record.attendanceStatus} (${number(record.attendancePct)}%)`;
        await tx.$executeRawUnsafe(
          `INSERT INTO attendance_inference
             (id, date, batch_no, employee_id, trainee_name, branch, process, lob,
              course_activity, mcq_activity, final_attendance, attendance_source, remarks)
           VALUES (?, DATE(?), ?, ?, ?, ?, ?, ?, ?, 0, ?, 'ILT', ?)
           ON DUPLICATE KEY UPDATE
             course_activity = GREATEST(course_activity, VALUES(course_activity)),
             final_attendance = CASE
               WHEN attendance_source IN ('Biometric', 'Manual', 'HRMS') THEN final_attendance
               ELSE VALUES(final_attendance)
             END,
             attendance_source = CASE
               WHEN attendance_source IN ('Biometric', 'Manual', 'HRMS') THEN attendance_source
               ELSE 'ILT'
             END,
             remarks = CONCAT_WS(' | ', NULLIF(remarks, ''), VALUES(remarks))`,
          randomUUID(), session.startAt, trainee.batchNo, trainee.employeeId,
          trainee.traineeName || null, trainee.branch || null, trainee.process || null, trainee.lob || null,
          passed ? 1 : 0, finalAttendance, remarks,
        );
      }

      if (passed) {
        await tx.$executeRawUnsafe(
          `INSERT INTO skill_evidence
             (id, employee_id, skill_id, evidence_type, reference_id,
              score_pct, level_awarded, evidence_status, notes, recorded_by, evidence_at)
           SELECT UUID(), ?, m.skill_id, 'ILT_ATTENDANCE', ?, ?, m.level_awarded,
                  'VALID', ?, ?, UTC_TIMESTAMP(3)
             FROM ilt_session_skill_map m
            WHERE m.session_id = ? AND m.active = 1
              AND ? >= m.minimum_attendance_pct
           ON DUPLICATE KEY UPDATE
             score_pct = VALUES(score_pct), level_awarded = VALUES(level_awarded),
             evidence_status = 'VALID', notes = VALUES(notes),
             recorded_by = VALUES(recorded_by), evidence_at = VALUES(evidence_at)`,
          String(enrollment.employeeId), String(sessionId), number(record.attendancePct),
          `Completed ${session.title}`, String(actorId), String(sessionId), number(record.attendancePct),
        );
      }
      affectedEmployees.push(String(enrollment.employeeId));
    }

    await tx.$executeRawUnsafe(
      `UPDATE ilt_session SET status = 'COMPLETED', completed_at = UTC_TIMESTAMP(3),
              checkin_code_hash = NULL, updated_by = ? WHERE session_id = ?`,
      String(actorId), String(sessionId),
    );
    return { session: { ...session, status: 'COMPLETED' }, affectedEmployees, unchanged: false };
  });

  for (const employeeId of [...new Set(affectedEmployees)]) {
    await syncEmployeeSkills(employeeId, 'ilt-session').catch(error => console.warn('[ILT] Skill sync failed:', error.message));
    await syncLearningPaths(employeeId).catch(error => console.warn('[ILT] Path sync failed:', error.message));
  }
  return result;
}

export async function getLearnerCalendar(employeeId, options = {}) {
  const trainee = await prisma.traineeMaster.findUnique({ where: { employeeId: String(employeeId) } });
  if (!trainee) return { trainee: null, upcoming: [], available: [], history: [], summary: {} };
  const from = asDate(options.from) || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const to = asDate(options.to) || new Date(Date.now() + 120 * 24 * 60 * 60 * 1000);
  const rows = normalizeValue(await prisma.$queryRawUnsafe(
    `SELECT s.session_id AS sessionId, s.session_code AS sessionCode,
            s.title, s.description, s.session_type AS sessionType,
            s.delivery_mode AS deliveryMode, s.classroom_id AS classroomId,
            s.module_id AS moduleId, s.batch_no AS batchNo,
            s.branch, s.process_name AS processName, s.lob_name AS lobName,
            s.start_at AS startAt, s.end_at AS endAt, s.timezone,
            s.capacity, s.minimum_attendance_pct AS minimumAttendancePct,
            s.self_enrollment_enabled AS selfEnrollmentEnabled,
            s.waitlist_enabled AS waitlistEnabled, s.status,
            v.venue_name AS venueName, v.room_location AS roomLocation,
            v.virtual_join_url AS venueJoinUrl, s.virtual_join_url AS virtualJoinUrl,
            e.enrollment_id AS enrollmentId, e.status AS enrollmentStatus,
            e.waitlist_position AS waitlistPosition,
            a.attendance_status AS attendanceStatus,
            a.attendance_pct AS attendancePct,
            (SELECT COUNT(*) FROM ilt_session_enrollment ce
              WHERE ce.session_id = s.session_id AND ce.status IN ('CONFIRMED', 'ATTENDED')) AS confirmedCount,
            (SELECT COUNT(*) FROM ilt_session_enrollment we
              WHERE we.session_id = s.session_id AND we.status = 'WAITLISTED') AS waitlistCount
       FROM ilt_session s
       LEFT JOIN ilt_venue v ON v.venue_id = s.venue_id
       LEFT JOIN ilt_session_enrollment e
              ON e.session_id = s.session_id AND e.employee_id = ?
       LEFT JOIN ilt_session_attendance a
              ON a.session_id = s.session_id AND a.employee_id = ?
      WHERE s.start_at BETWEEN ? AND ?
        AND s.status IN ('PUBLISHED', 'IN_PROGRESS', 'COMPLETED')
        AND (s.batch_no IS NULL OR s.batch_no = ?)
        AND (s.branch = '' OR s.branch = ?)
        AND (s.process_name = '' OR s.process_name = ?)
        AND (s.lob_name = '' OR s.lob_name = ?)
      ORDER BY s.start_at`,
    String(employeeId), String(employeeId), from, to,
    trainee.batchNo || '', trainee.branch || '', trainee.process || '', trainee.lob || '',
  ));

  const enriched = [];
  for (const row of rows) {
    const prerequisites = await prerequisiteResult(row.sessionId, trainee);
    enriched.push({
      ...row,
      confirmedCount: number(row.confirmedCount),
      waitlistCount: number(row.waitlistCount),
      seatsRemaining: Math.max(0, number(row.capacity) - number(row.confirmedCount)),
      prerequisites,
    });
  }
  const upcoming = enriched.filter(row => row.enrollmentId && new Date(row.endAt) >= new Date() && row.enrollmentStatus !== 'CANCELLED');
  const available = enriched.filter(row => !row.enrollmentId && new Date(row.startAt) > new Date() && row.status === 'PUBLISHED');
  const history = enriched.filter(row => new Date(row.endAt) < new Date() || row.status === 'COMPLETED');
  return {
    trainee,
    upcoming,
    available,
    history,
    summary: {
      confirmed: upcoming.filter(row => row.enrollmentStatus === 'CONFIRMED').length,
      waitlisted: upcoming.filter(row => row.enrollmentStatus === 'WAITLISTED').length,
      attended: history.filter(row => row.enrollmentStatus === 'ATTENDED').length,
      noShow: history.filter(row => row.enrollmentStatus === 'NO_SHOW').length,
      available: available.length,
    },
  };
}

export async function getScopedCalendar({ branch = '', coordinatorId = '', from, to }) {
  const start = asDate(from) || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const end = asDate(to) || new Date(Date.now() + 120 * 24 * 60 * 60 * 1000);
  const params = [start, end];
  let scopeSql = '';
  if (coordinatorId) {
    scopeSql = ` AND (s.batch_no IN (SELECT batch_no FROM batch_master WHERE coordinator_login_id = ?)
                      OR s.created_by = ?
                      OR EXISTS (SELECT 1 FROM ilt_session_instructor si
                                  INNER JOIN ilt_instructor i ON i.instructor_id = si.instructor_id
                                 WHERE si.session_id = s.session_id AND i.user_id = ?))`;
    params.push(String(coordinatorId), String(coordinatorId), String(coordinatorId));
  } else if (branch) {
    scopeSql = ' AND (s.branch = ? OR s.branch = \'\')';
    params.push(String(branch));
  }
  const sessions = normalizeValue(await prisma.$queryRawUnsafe(
    `SELECT s.session_id AS sessionId, s.session_code AS sessionCode,
            s.title, s.session_type AS sessionType, s.delivery_mode AS deliveryMode,
            s.batch_no AS batchNo, s.classroom_id AS classroomId,
            s.branch, s.process_name AS processName, s.lob_name AS lobName,
            s.start_at AS startAt, s.end_at AS endAt, s.timezone,
            s.capacity, s.minimum_attendees AS minimumAttendees,
            s.minimum_attendance_pct AS minimumAttendancePct, s.status,
            v.venue_name AS venueName, v.venue_code AS venueCode,
            (SELECT COUNT(*) FROM ilt_session_enrollment e
              WHERE e.session_id = s.session_id AND e.status IN ('CONFIRMED', 'ATTENDED')) AS confirmedCount,
            (SELECT COUNT(*) FROM ilt_session_enrollment e
              WHERE e.session_id = s.session_id AND e.status = 'WAITLISTED') AS waitlistCount,
            (SELECT COUNT(*) FROM ilt_session_enrollment e
              WHERE e.session_id = s.session_id AND e.status = 'NO_SHOW') AS noShowCount,
            (SELECT ROUND(AVG(f.rating), 2) FROM ilt_session_feedback f
              WHERE f.session_id = s.session_id) AS averageRating
       FROM ilt_session s
       LEFT JOIN ilt_venue v ON v.venue_id = s.venue_id
      WHERE s.start_at BETWEEN ? AND ?${scopeSql}
      ORDER BY s.start_at`,
    ...params,
  ));
  for (const session of sessions) {
    session.confirmedCount = number(session.confirmedCount);
    session.waitlistCount = number(session.waitlistCount);
    session.noShowCount = number(session.noShowCount);
    session.averageRating = session.averageRating == null ? null : number(session.averageRating);
    session.utilizationPct = number(session.capacity)
      ? Math.round((session.confirmedCount / number(session.capacity)) * 10000) / 100
      : 0;
  }
  return {
    sessions,
    summary: {
      total: sessions.length,
      draft: sessions.filter(item => item.status === 'DRAFT').length,
      published: sessions.filter(item => item.status === 'PUBLISHED').length,
      completed: sessions.filter(item => item.status === 'COMPLETED').length,
      waitlisted: sessions.reduce((sum, item) => sum + item.waitlistCount, 0),
      noShows: sessions.reduce((sum, item) => sum + item.noShowCount, 0),
      averageUtilization: sessions.length
        ? Math.round((sessions.reduce((sum, item) => sum + item.utilizationPct, 0) / sessions.length) * 100) / 100
        : 0,
    },
  };
}

export async function getSessionDetail(sessionId) {
  const session = await sessionRow(sessionId);
  if (!session) return null;
  const [instructors, prerequisites, skills, resources, enrollments, attendance, feedback] = await Promise.all([
    prisma.$queryRawUnsafe(
      `SELECT si.id, si.instructor_id AS instructorId, i.instructor_name AS instructorName,
              i.email, si.instructor_role AS instructorRole,
              si.confirmation_status AS confirmationStatus, si.notes
         FROM ilt_session_instructor si
         INNER JOIN ilt_instructor i ON i.instructor_id = si.instructor_id
        WHERE si.session_id = ? ORDER BY FIELD(si.instructor_role, 'LEAD', 'CO_FACILITATOR', 'OBSERVER')`,
      String(sessionId),
    ),
    prisma.$queryRawUnsafe(
      `SELECT prerequisite_id AS prerequisiteId, prerequisite_type AS prerequisiteType,
              reference_id AS referenceId, minimum_score AS minimumScore,
              minimum_level AS minimumLevel, required, active
         FROM ilt_session_prerequisite WHERE session_id = ? ORDER BY required DESC`,
      String(sessionId),
    ),
    prisma.$queryRawUnsafe(
      `SELECT m.id, m.skill_id AS skillId, s.skill_code AS skillCode,
              s.skill_name AS skillName, m.level_awarded AS levelAwarded,
              m.minimum_attendance_pct AS minimumAttendancePct, m.active
         FROM ilt_session_skill_map m
         INNER JOIN skill_master s ON s.skill_id = m.skill_id
        WHERE m.session_id = ? ORDER BY s.skill_name`,
      String(sessionId),
    ),
    prisma.$queryRawUnsafe(
      `SELECT resource_id AS resourceId, resource_type AS resourceType,
              reference_id AS referenceId, resource_title AS resourceTitle,
              resource_url AS resourceUrl, sort_order AS sortOrder
         FROM ilt_session_resource WHERE session_id = ? ORDER BY sort_order, resource_title`,
      String(sessionId),
    ),
    prisma.$queryRawUnsafe(
      `SELECT e.enrollment_id AS enrollmentId, e.employee_id AS employeeId,
              t.trainee_name AS traineeName, t.email, t.batch_no AS batchNo,
              e.status, e.waitlist_position AS waitlistPosition,
              e.source, e.enrolled_at AS enrolledAt, e.promoted_at AS promotedAt
         FROM ilt_session_enrollment e
         LEFT JOIN trainee_master t ON t.employee_id = e.employee_id
        WHERE e.session_id = ?
        ORDER BY FIELD(e.status, 'CONFIRMED', 'WAITLISTED', 'ATTENDED', 'NO_SHOW', 'CANCELLED'),
                 e.waitlist_position, e.enrolled_at`,
      String(sessionId),
    ),
    prisma.$queryRawUnsafe(
      `SELECT attendance_id AS attendanceId, employee_id AS employeeId,
              attendance_status AS attendanceStatus, checkin_at AS checkinAt,
              checkout_at AS checkoutAt, attended_minutes AS attendedMinutes,
              attendance_pct AS attendancePct, source, verified_by AS verifiedBy,
              verified_at AS verifiedAt, notes, locked_at AS lockedAt
         FROM ilt_session_attendance WHERE session_id = ?`,
      String(sessionId),
    ),
    prisma.$queryRawUnsafe(
      `SELECT feedback_id AS feedbackId, employee_id AS employeeId, rating,
              confidence_before AS confidenceBefore, confidence_after AS confidenceAfter,
              comments, submitted_at AS submittedAt
         FROM ilt_session_feedback WHERE session_id = ? ORDER BY submitted_at DESC`,
      String(sessionId),
    ),
  ]);
  return normalizeValue({ session, instructors, prerequisites, skills, resources, enrollments, attendance, feedback });
}

export async function submitFeedback({ sessionId, employeeId, rating, confidenceBefore, confidenceAfter, comments }) {
  const enrollmentRows = await prisma.$queryRawUnsafe(
    `SELECT status FROM ilt_session_enrollment WHERE session_id = ? AND employee_id = ? LIMIT 1`,
    String(sessionId), String(employeeId),
  );
  if (!enrollmentRows.length || !['ATTENDED', 'NO_SHOW'].includes(enrollmentRows[0].status)) {
    fail(409, 'Feedback is available after the session is finalized.', 'FEEDBACK_NOT_AVAILABLE');
  }
  const safeRating = Math.round(number(rating));
  if (safeRating < 1 || safeRating > 5) fail(400, 'Rating must be between 1 and 5.', 'INVALID_RATING');
  const before = confidenceBefore == null ? null : Math.round(number(confidenceBefore));
  const after = confidenceAfter == null ? null : Math.round(number(confidenceAfter));
  await prisma.$executeRawUnsafe(
    `INSERT INTO ilt_session_feedback
       (feedback_id, session_id, employee_id, rating,
        confidence_before, confidence_after, comments)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       rating = VALUES(rating), confidence_before = VALUES(confidence_before),
       confidence_after = VALUES(confidence_after), comments = VALUES(comments),
       updated_at = UTC_TIMESTAMP(3)`,
    randomUUID(), String(sessionId), String(employeeId), safeRating, before, after, comments || null,
  );
  return { sessionId, employeeId, rating: safeRating, confidenceBefore: before, confidenceAfter: after };
}

export { normalizeValue, sessionRow, prerequisiteResult };

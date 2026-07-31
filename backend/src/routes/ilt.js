import { Router } from 'express';
import { randomInt, randomUUID } from 'crypto';
import { prisma } from '../utils/db.js';
import { requirePermission } from '../middleware/permissions.js';
import { requireRole, requireSession } from '../middleware/auth.js';
import { audit } from '../utils/audit.js';
import {
  cancelEnrollment,
  enrollEmployee,
  finalizeSession,
  getLearnerCalendar,
  getScopedCalendar,
  getSessionDetail,
  learnerCheckin,
  normalizeValue,
  publishSession,
  recordAttendance,
  resolveIltPolicy,
  rotateCheckinCode,
  sessionRow,
  submitFeedback,
  validateScheduleConflicts,
} from '../services/iltGovernance.js';

const router = Router();
const traineeAuth = [requireSession, requireRole('trainee')];
const coordinatorAuth = [requireSession, requireRole('coordinator')];
const adminAuth = [requireSession, requireRole('admin')];
const SESSION_STATUSES = new Set(['DRAFT', 'PUBLISHED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']);
const DELIVERY_MODES = new Set(['IN_PERSON', 'VIRTUAL', 'HYBRID']);
const SESSION_TYPES = new Set(['ILT', 'VILT', 'WORKSHOP', 'PRACTICE', 'CALIBRATION', 'COACHING']);
const PREREQUISITE_TYPES = new Set(['CONTENT', 'ASSESSMENT', 'SKILL', 'PATH', 'CLASSROOM']);

function route(handler) {
  return async (req, res) => {
    try {
      return await handler(req, res);
    } catch (error) {
      console.error(`[ILT] ${req.method} ${req.originalUrl}:`, error.message);
      const status = Number(error.status || 500);
      return res.status(status).json({
        ok: false,
        message: status >= 500 ? 'Instructor-led training service failed.' : error.message,
        code: error.code || 'ILT_ERROR',
        details: status < 500 ? error.details || null : null,
      });
    }
  };
}

function text(value, max = 240) {
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

function date(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function companyScope(req) {
  return req.permissionScope === 'company' || (!req.userBranch && ['Super Admin', 'SuperAdmin', 'CEO'].includes(req.adminInfo?.role));
}

function sessionCode(startAt, occurrenceNo = 1) {
  const stamp = new Date(startAt).toISOString().slice(0, 10).replaceAll('-', '');
  return `ILT-${stamp}-${randomInt(1000, 10000)}-${String(occurrenceNo).padStart(2, '0')}`;
}

async function ownedBatch(batchNo, coordinatorId) {
  return prisma.batchMaster.findFirst({ where: { batchNo: String(batchNo), coordinatorLoginId: String(coordinatorId) } });
}

async function ensureSessionScope(req, actorType, sessionId) {
  const session = await sessionRow(sessionId);
  if (!session) {
    const error = new Error('Live session not found.');
    error.status = 404;
    throw error;
  }
  if (actorType === 'coordinator') {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT s.session_id
         FROM ilt_session s
         LEFT JOIN batch_master b ON b.batch_no = s.batch_no
        WHERE s.session_id = ?
          AND (b.coordinator_login_id = ? OR s.created_by = ?
               OR EXISTS (
                 SELECT 1 FROM ilt_session_instructor si
                 INNER JOIN ilt_instructor i ON i.instructor_id = si.instructor_id
                 WHERE si.session_id = s.session_id AND i.user_id = ?
               )) LIMIT 1`,
      String(sessionId), String(req.userId), String(req.userId), String(req.userId),
    );
    if (!rows.length) {
      const error = new Error('Session is outside your owned-batch scope.');
      error.status = 404;
      throw error;
    }
  }
  if (actorType === 'admin' && !companyScope(req) && session.branch && String(session.branch) !== String(req.userBranch || '')) {
    const error = new Error('Session is outside your branch scope.');
    error.status = 404;
    throw error;
  }
  return session;
}

async function validateReference(type, referenceId) {
  if (type === 'CONTENT') return prisma.contentMaster.findUnique({ where: { contentId: referenceId }, select: { contentId: true } });
  if (type === 'ASSESSMENT') return prisma.assessmentMaster.findUnique({ where: { assessmentId: referenceId }, select: { assessmentId: true } });
  if (type === 'CLASSROOM') return prisma.classroomMaster.findUnique({ where: { classroomId: referenceId }, select: { classroomId: true } });
  if (type === 'SKILL') {
    const rows = await prisma.$queryRawUnsafe(`SELECT skill_id FROM skill_master WHERE skill_id = ? AND active = 1 LIMIT 1`, String(referenceId));
    return rows[0] || null;
  }
  if (type === 'PATH') {
    const rows = await prisma.$queryRawUnsafe(`SELECT path_id FROM learning_path_master WHERE path_id = ? AND active = 1 AND status = 'PUBLISHED' LIMIT 1`, String(referenceId));
    return rows[0] || null;
  }
  return null;
}

async function saveSessionChildren(sessionId, body, actorId) {
  const instructorAssignments = Array.isArray(body.instructorAssignments) ? body.instructorAssignments.slice(0, 20) : [];
  for (const assignment of instructorAssignments) {
    const instructorId = text(assignment?.instructorId, 36);
    if (!instructorId) continue;
    const exists = await prisma.$queryRawUnsafe(`SELECT instructor_id FROM ilt_instructor WHERE instructor_id = ? AND active = 1 LIMIT 1`, instructorId);
    if (!exists.length) continue;
    await prisma.$executeRawUnsafe(
      `INSERT INTO ilt_session_instructor
         (id, session_id, instructor_id, instructor_role, confirmation_status, confirmed_at, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         instructor_role = VALUES(instructor_role), confirmation_status = VALUES(confirmation_status),
         confirmed_at = VALUES(confirmed_at), notes = VALUES(notes)`,
      randomUUID(), String(sessionId), instructorId,
      ['LEAD', 'CO_FACILITATOR', 'OBSERVER'].includes(text(assignment.instructorRole, 30).toUpperCase())
        ? text(assignment.instructorRole, 30).toUpperCase() : 'CO_FACILITATOR',
      'CONFIRMED', new Date(), text(assignment.notes, 5000) || null,
    );
  }

  const prerequisites = Array.isArray(body.prerequisites) ? body.prerequisites.slice(0, 50) : [];
  for (const item of prerequisites) {
    const prerequisiteType = text(item?.prerequisiteType, 30).toUpperCase();
    const referenceId = text(item?.referenceId, 160);
    if (!PREREQUISITE_TYPES.has(prerequisiteType) || !referenceId) continue;
    if (!await validateReference(prerequisiteType, referenceId)) continue;
    await prisma.$executeRawUnsafe(
      `INSERT INTO ilt_session_prerequisite
         (prerequisite_id, session_id, prerequisite_type, reference_id,
          minimum_score, minimum_level, required, active, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
       ON DUPLICATE KEY UPDATE
         minimum_score = VALUES(minimum_score), minimum_level = VALUES(minimum_level),
         required = VALUES(required), active = 1`,
      randomUUID(), String(sessionId), prerequisiteType, referenceId,
      item.minimumScore == null ? null : number(item.minimumScore, 0, 0, 100),
      item.minimumLevel == null ? null : number(item.minimumLevel, 1, 0, 10),
      bool(item.required, true) ? 1 : 0, String(actorId),
    );
  }

  const skillMappings = Array.isArray(body.skillMappings) ? body.skillMappings.slice(0, 50) : [];
  for (const item of skillMappings) {
    const skillId = text(item?.skillId, 36);
    if (!skillId || !await validateReference('SKILL', skillId)) continue;
    await prisma.$executeRawUnsafe(
      `INSERT INTO ilt_session_skill_map
         (id, session_id, skill_id, level_awarded, minimum_attendance_pct, active, mapped_by)
       VALUES (?, ?, ?, ?, ?, 1, ?)
       ON DUPLICATE KEY UPDATE
         level_awarded = VALUES(level_awarded),
         minimum_attendance_pct = VALUES(minimum_attendance_pct), active = 1,
         mapped_by = VALUES(mapped_by)`,
      randomUUID(), String(sessionId), skillId,
      number(item.levelAwarded, 1, 0, 10), number(item.minimumAttendancePct, 80, 0, 100), String(actorId),
    );
  }

  const resources = Array.isArray(body.resources) ? body.resources.slice(0, 100) : [];
  for (let index = 0; index < resources.length; index += 1) {
    const item = resources[index];
    const resourceTitle = text(item?.resourceTitle, 220);
    if (!resourceTitle) continue;
    await prisma.$executeRawUnsafe(
      `INSERT INTO ilt_session_resource
         (resource_id, session_id, resource_type, reference_id,
          resource_title, resource_url, sort_order, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      randomUUID(), String(sessionId), text(item.resourceType, 30).toUpperCase() || 'CONTENT',
      text(item.referenceId, 160) || null, resourceTitle, text(item.resourceUrl, 4000) || null,
      number(item.sortOrder, index, 0, 10000), String(actorId),
    );
  }
}

async function createSessions(req, res, actorType) {
  const title = text(req.body?.title, 220);
  const startAt = date(req.body?.startAt);
  const endAt = date(req.body?.endAt);
  if (!title || !startAt || !endAt || endAt <= startAt) {
    return res.status(400).json({ ok: false, message: 'Title and valid start/end times are required.' });
  }

  let batch = null;
  const batchNo = text(req.body?.batchNo, 191) || null;
  if (actorType === 'coordinator') {
    if (!batchNo) return res.status(400).json({ ok: false, message: 'Coordinators must select an owned batch.' });
    batch = await ownedBatch(batchNo, req.userId);
    if (!batch) return res.status(404).json({ ok: false, message: 'Owned batch not found.' });
  } else if (batchNo) {
    batch = await prisma.batchMaster.findUnique({ where: { batchNo } });
    if (!batch) return res.status(404).json({ ok: false, message: 'Batch not found.' });
  }

  const branch = text(batch?.branch || req.body?.branch, 120);
  if (actorType === 'admin' && !companyScope(req) && branch !== String(req.userBranch || '')) {
    return res.status(403).json({ ok: false, message: 'Session branch is outside your scope.' });
  }
  const processName = text(batch?.process || req.body?.processName, 120);
  const lobName = text(batch?.lob || req.body?.lobName, 120);
  const policy = await resolveIltPolicy({ branch, processName, lobName });
  const capacity = Math.round(number(req.body?.capacity, number(policy.defaultCapacity, 25), 1, 10000));
  const venueId = text(req.body?.venueId, 36) || null;
  if (venueId) {
    const venueRows = await prisma.$queryRawUnsafe(
      `SELECT venue_id AS venueId, capacity, branch FROM ilt_venue WHERE venue_id = ? AND active = 1 LIMIT 1`,
      venueId,
    );
    const venue = venueRows[0];
    if (!venue) return res.status(404).json({ ok: false, message: 'Active venue not found.' });
    if (number(venue.capacity) < capacity) return res.status(409).json({ ok: false, message: 'Capacity exceeds venue capacity.' });
    if (actorType === 'admin' && !companyScope(req) && venue.branch && String(venue.branch) !== String(req.userBranch || '')) {
      return res.status(403).json({ ok: false, message: 'Venue is outside your branch scope.' });
    }
  }

  const classroomId = text(req.body?.classroomId, 191) || null;
  const moduleId = text(req.body?.moduleId, 191) || null;
  if (classroomId && !await prisma.classroomMaster.findUnique({ where: { classroomId }, select: { classroomId: true } })) {
    return res.status(404).json({ ok: false, message: 'Classroom not found.' });
  }
  if (moduleId) {
    const module = await prisma.moduleMaster.findUnique({ where: { moduleId }, select: { moduleId: true, classroomId: true } });
    if (!module || (classroomId && module.classroomId !== classroomId)) {
      return res.status(404).json({ ok: false, message: 'Module not found in the selected classroom.' });
    }
  }

  const repeatCount = Math.round(number(req.body?.repeatCount, 1, 1, 60));
  const repeatEveryDays = Math.round(number(req.body?.repeatEveryDays, 1, 1, 365));
  const seriesId = repeatCount > 1 ? randomUUID() : null;
  const created = [];
  for (let index = 0; index < repeatCount; index += 1) {
    const shiftedStart = new Date(startAt.getTime() + index * repeatEveryDays * 86400000);
    const shiftedEnd = new Date(endAt.getTime() + index * repeatEveryDays * 86400000);
    const sessionId = randomUUID();
    const code = sessionCode(shiftedStart, index + 1);
    await prisma.$executeRawUnsafe(
      `INSERT INTO ilt_session
         (session_id, session_code, series_id, occurrence_no,
          classroom_id, module_id, batch_no, title, description,
          session_type, delivery_mode, branch, process_name, lob_name,
          venue_id, virtual_join_url, timezone, start_at, end_at,
          registration_open_at, registration_close_at, capacity,
          minimum_attendees, waitlist_enabled, self_enrollment_enabled,
          minimum_attendance_pct, status, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?)`,
      sessionId, code, seriesId, index + 1,
      classroomId, moduleId, batchNo, title, text(req.body?.description, 20000) || null,
      SESSION_TYPES.has(text(req.body?.sessionType, 40).toUpperCase()) ? text(req.body.sessionType, 40).toUpperCase() : 'ILT',
      DELIVERY_MODES.has(text(req.body?.deliveryMode, 30).toUpperCase()) ? text(req.body.deliveryMode, 30).toUpperCase() : 'IN_PERSON',
      branch, processName, lobName, venueId, text(req.body?.virtualJoinUrl, 4000) || null,
      text(req.body?.timezone, 80) || 'Asia/Kolkata', shiftedStart, shiftedEnd,
      date(req.body?.registrationOpenAt), date(req.body?.registrationCloseAt), capacity,
      Math.round(number(req.body?.minimumAttendees, 1, 0, capacity)),
      bool(req.body?.waitlistEnabled, bool(policy.waitlistEnabled, true)) ? 1 : 0,
      bool(req.body?.selfEnrollmentEnabled, bool(policy.selfEnrollmentEnabled, true)) ? 1 : 0,
      number(req.body?.minimumAttendancePct, number(policy.minimumAttendancePct, 80), 0, 100),
      String(req.userId), String(req.userId),
    );
    await saveSessionChildren(sessionId, req.body || {}, req.userId);
    created.push({ sessionId, sessionCode: code, occurrenceNo: index + 1, startAt: shiftedStart, endAt: shiftedEnd });
  }

  await audit({
    userIdentity: req.userId,
    userRole: actorType,
    action: 'CREATE_ILT_SESSION',
    module: 'Instructor-led Training',
    referenceId: seriesId || created[0].sessionId,
    newValue: { title, batchNo, repeatCount, created },
  });
  return res.status(201).json({ ok: true, data: { seriesId, sessions: created }, message: `${created.length} session occurrence(s) created as draft.` });
}

async function updateSession(req, res, actorType) {
  const session = await ensureSessionScope(req, actorType, req.params.sessionId);
  if (session.status !== 'DRAFT') return res.status(409).json({ ok: false, message: 'Only draft sessions can be edited.' });
  const startAt = date(req.body?.startAt) || new Date(session.startAt);
  const endAt = date(req.body?.endAt) || new Date(session.endAt);
  if (endAt <= startAt) return res.status(400).json({ ok: false, message: 'End time must be after start time.' });
  const venueId = req.body?.venueId === undefined ? session.venueId : (text(req.body.venueId, 36) || null);
  const capacity = Math.round(number(req.body?.capacity, number(session.capacity), 1, 10000));
  if (venueId) {
    const rows = await prisma.$queryRawUnsafe(`SELECT capacity, branch FROM ilt_venue WHERE venue_id = ? AND active = 1 LIMIT 1`, venueId);
    if (!rows.length || number(rows[0].capacity) < capacity) return res.status(409).json({ ok: false, message: 'Venue is unavailable or too small.' });
  }
  const conflictResult = await validateScheduleConflicts({
    sessionId: session.sessionId,
    venueId,
    batchNo: session.batchNo,
    startAt,
    endAt,
    instructorIds: [],
  });
  if (conflictResult.hasConflict) return res.status(409).json({ ok: false, message: 'Draft schedule conflicts with a published session.', details: conflictResult.conflicts });
  await prisma.$executeRawUnsafe(
    `UPDATE ilt_session
        SET title = ?, description = ?, session_type = ?, delivery_mode = ?,
            venue_id = ?, virtual_join_url = ?, timezone = ?, start_at = ?, end_at = ?,
            registration_open_at = ?, registration_close_at = ?, capacity = ?,
            minimum_attendees = ?, waitlist_enabled = ?, self_enrollment_enabled = ?,
            minimum_attendance_pct = ?, updated_by = ?
      WHERE session_id = ?`,
    text(req.body?.title, 220) || session.title,
    req.body?.description === undefined ? session.description : (text(req.body.description, 20000) || null),
    SESSION_TYPES.has(text(req.body?.sessionType, 40).toUpperCase()) ? text(req.body.sessionType, 40).toUpperCase() : session.sessionType,
    DELIVERY_MODES.has(text(req.body?.deliveryMode, 30).toUpperCase()) ? text(req.body.deliveryMode, 30).toUpperCase() : session.deliveryMode,
    venueId,
    req.body?.virtualJoinUrl === undefined ? session.virtualJoinUrl : (text(req.body.virtualJoinUrl, 4000) || null),
    text(req.body?.timezone, 80) || session.timezone,
    startAt, endAt,
    req.body?.registrationOpenAt === undefined ? session.registrationOpenAt : date(req.body.registrationOpenAt),
    req.body?.registrationCloseAt === undefined ? session.registrationCloseAt : date(req.body.registrationCloseAt),
    capacity,
    Math.round(number(req.body?.minimumAttendees, number(session.minimumAttendees), 0, capacity)),
    bool(req.body?.waitlistEnabled, bool(session.waitlistEnabled)) ? 1 : 0,
    bool(req.body?.selfEnrollmentEnabled, bool(session.selfEnrollmentEnabled)) ? 1 : 0,
    number(req.body?.minimumAttendancePct, number(session.minimumAttendancePct), 0, 100),
    String(req.userId), String(session.sessionId),
  );
  await saveSessionChildren(session.sessionId, req.body || {}, req.userId);
  await audit({ userIdentity: req.userId, userRole: actorType, action: 'UPDATE_ILT_SESSION', module: 'Instructor-led Training', referenceId: session.sessionId, newValue: req.body });
  return res.json({ ok: true, data: await getSessionDetail(session.sessionId), message: 'Draft session updated.' });
}

async function bulkEnroll(req, res, actorType) {
  const session = await ensureSessionScope(req, actorType, req.params.sessionId);
  let employeeIds = Array.isArray(req.body?.employeeIds) ? req.body.employeeIds.map(item => text(item, 120)).filter(Boolean) : [];
  if (req.body?.batchNo) {
    const batchNo = text(req.body.batchNo, 191);
    if (actorType === 'coordinator' && !await ownedBatch(batchNo, req.userId)) return res.status(404).json({ ok: false, message: 'Owned batch not found.' });
    const trainees = await prisma.traineeMaster.findMany({ where: { batchNo, status: 'Active' }, select: { employeeId: true }, take: 1000 });
    employeeIds.push(...trainees.map(item => item.employeeId));
  }
  employeeIds = [...new Set(employeeIds)].slice(0, 1000);
  if (!employeeIds.length) return res.status(400).json({ ok: false, message: 'Select at least one learner or batch.' });
  const results = [];
  for (const employeeId of employeeIds) {
    try {
      const result = await enrollEmployee({ sessionId: session.sessionId, employeeId, source: actorType === 'coordinator' ? 'COORDINATOR' : 'ADMIN', actorId: req.userId, actorType });
      results.push({ employeeId, ok: true, status: result.enrollment.status, unchanged: Boolean(result.unchanged) });
    } catch (error) {
      results.push({ employeeId, ok: false, message: error.message, code: error.code || 'ENROLLMENT_FAILED' });
    }
  }
  await audit({ userIdentity: req.userId, userRole: actorType, action: 'BULK_ENROLL_ILT', module: 'Instructor-led Training', referenceId: session.sessionId, newValue: { requested: employeeIds.length, results } });
  return res.json({ ok: true, data: results, summary: { requested: employeeIds.length, enrolled: results.filter(item => item.ok).length, failed: results.filter(item => !item.ok).length } });
}

async function cancelSession(req, res, actorType) {
  const session = await ensureSessionScope(req, actorType, req.params.sessionId);
  if (['COMPLETED', 'CANCELLED'].includes(session.status)) return res.status(409).json({ ok: false, message: 'This session cannot be cancelled.' });
  const reason = text(req.body?.reason, 10000);
  if (reason.length < 10) return res.status(400).json({ ok: false, message: 'A cancellation reason of at least 10 characters is required.' });
  await prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe(
      `UPDATE ilt_session SET status = 'CANCELLED', cancelled_at = UTC_TIMESTAMP(3),
              cancellation_reason = ?, checkin_code_hash = NULL, updated_by = ?
        WHERE session_id = ?`,
      reason, String(req.userId), String(session.sessionId),
    );
    await tx.$executeRawUnsafe(
      `UPDATE ilt_session_enrollment SET status = 'CANCELLED', cancelled_at = UTC_TIMESTAMP(3),
              cancellation_reason = ?
        WHERE session_id = ? AND status IN ('CONFIRMED', 'WAITLISTED')`,
      `Session cancelled: ${reason}`, String(session.sessionId),
    );
  });
  await audit({ userIdentity: req.userId, userRole: actorType, action: 'CANCEL_ILT_SESSION', module: 'Instructor-led Training', referenceId: session.sessionId, newValue: { reason } });
  return res.json({ ok: true, message: 'Session and open enrolments cancelled.' });
}

async function savePolicy(req, res) {
  const branch = companyScope(req) ? text(req.body?.branch, 120) : String(req.userBranch || '');
  const processName = text(req.body?.processName, 120);
  const lobName = text(req.body?.lobName, 120);
  await prisma.$executeRawUnsafe(
    `INSERT INTO ilt_policy
       (policy_id, branch, process_name, lob_name, default_capacity,
        waitlist_enabled, auto_promote_waitlist, self_enrollment_enabled,
        minimum_attendance_pct, checkin_open_before_mins,
        checkin_close_after_mins, cancellation_cutoff_mins, active, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       default_capacity = VALUES(default_capacity), waitlist_enabled = VALUES(waitlist_enabled),
       auto_promote_waitlist = VALUES(auto_promote_waitlist),
       self_enrollment_enabled = VALUES(self_enrollment_enabled),
       minimum_attendance_pct = VALUES(minimum_attendance_pct),
       checkin_open_before_mins = VALUES(checkin_open_before_mins),
       checkin_close_after_mins = VALUES(checkin_close_after_mins),
       cancellation_cutoff_mins = VALUES(cancellation_cutoff_mins),
       active = VALUES(active), created_by = VALUES(created_by)`,
    randomUUID(), branch, processName, lobName,
    Math.round(number(req.body?.defaultCapacity, 25, 1, 10000)),
    bool(req.body?.waitlistEnabled, true) ? 1 : 0,
    bool(req.body?.autoPromoteWaitlist, true) ? 1 : 0,
    bool(req.body?.selfEnrollmentEnabled, true) ? 1 : 0,
    number(req.body?.minimumAttendancePct, 80, 0, 100),
    Math.round(number(req.body?.checkinOpenBeforeMins, 30, 0, 1440)),
    Math.round(number(req.body?.checkinCloseAfterMins, 30, 0, 1440)),
    Math.round(number(req.body?.cancellationCutoffMins, 120, 0, 10080)),
    bool(req.body?.active, true) ? 1 : 0, String(req.userId),
  );
  await audit({ userIdentity: req.userId, userRole: 'admin', action: 'SAVE_ILT_POLICY', module: 'Instructor-led Training', referenceId: `${branch}/${processName}/${lobName}`, newValue: req.body });
  return res.json({ ok: true, data: await resolveIltPolicy({ branch, processName, lobName }), message: 'ILT policy saved.' });
}

async function catalog(req, actorType) {
  const branch = actorType === 'admin' && !companyScope(req) ? String(req.userBranch || '') : '';
  const coordinatorId = actorType === 'coordinator' ? String(req.userId) : '';
  const [venues, instructors, policies, classrooms, modules, batches, skills] = await Promise.all([
    prisma.$queryRawUnsafe(
      `SELECT venue_id AS venueId, venue_code AS venueCode, venue_name AS venueName,
              branch, venue_type AS venueType, room_location AS roomLocation,
              timezone, capacity, virtual_join_url AS virtualJoinUrl,
              accessibility_notes AS accessibilityNotes, active
         FROM ilt_venue WHERE active = 1 ${branch ? 'AND (branch = ? OR branch = \'\')' : ''}
         ORDER BY branch, venue_name`,
      ...(branch ? [branch] : []),
    ),
    prisma.$queryRawUnsafe(
      `SELECT instructor_id AS instructorId, user_id AS userId, user_type AS userType,
              instructor_name AS instructorName, email, branch,
              process_name AS processName, lob_name AS lobName,
              max_daily_minutes AS maxDailyMinutes, active
         FROM ilt_instructor WHERE active = 1 ${branch ? 'AND (branch = ? OR branch = \'\')' : ''}
         ORDER BY branch, instructor_name`,
      ...(branch ? [branch] : []),
    ),
    prisma.$queryRawUnsafe(
      `SELECT policy_id AS policyId, branch, process_name AS processName,
              lob_name AS lobName, default_capacity AS defaultCapacity,
              waitlist_enabled AS waitlistEnabled,
              auto_promote_waitlist AS autoPromoteWaitlist,
              self_enrollment_enabled AS selfEnrollmentEnabled,
              minimum_attendance_pct AS minimumAttendancePct,
              checkin_open_before_mins AS checkinOpenBeforeMins,
              checkin_close_after_mins AS checkinCloseAfterMins,
              cancellation_cutoff_mins AS cancellationCutoffMins, active
         FROM ilt_policy WHERE active = 1 ${branch ? 'AND (branch = ? OR branch = \'\')' : ''}
         ORDER BY (branch = '') DESC, branch, process_name, lob_name`,
      ...(branch ? [branch] : []),
    ),
    prisma.classroomMaster.findMany({ where: { active: true, ...(branch ? { OR: [{ branch }, { branch: null }] } : {}) }, select: { classroomId: true, classroomName: true, branch: true, process: true, lob: true }, orderBy: { classroomName: 'asc' }, take: 1000 }),
    prisma.moduleMaster.findMany({ where: { active: true }, select: { moduleId: true, moduleTitle: true, classroomId: true, dayNo: true }, orderBy: [{ classroomId: 'asc' }, { dayNo: 'asc' }, { moduleOrder: 'asc' }], take: 5000 }),
    coordinatorId
      ? prisma.batchMaster.findMany({ where: { coordinatorLoginId: coordinatorId }, select: { batchNo: true, batchName: true, branch: true, process: true, lob: true, batchStatus: true, totalTrainees: true }, orderBy: { startDate: 'desc' }, take: 500 })
      : prisma.batchMaster.findMany({ where: branch ? { branch } : {}, select: { batchNo: true, batchName: true, branch: true, process: true, lob: true, batchStatus: true, totalTrainees: true }, orderBy: { startDate: 'desc' }, take: 2000 }),
    prisma.$queryRawUnsafe(`SELECT skill_id AS skillId, skill_code AS skillCode, skill_name AS skillName, category FROM skill_master WHERE active = 1 ORDER BY category, skill_name`),
  ]);
  return normalizeValue({ venues, instructors, policies, classrooms, modules, batches, skills });
}

router.get('/trainee/calendar', ...traineeAuth, requirePermission('ilt.view_self'), route(async (req, res) => {
  const data = await getLearnerCalendar(req.userId, req.query || {});
  return res.json({ ok: true, data });
}));

router.post('/trainee/sessions/:sessionId/enroll', ...traineeAuth, requirePermission('ilt.enroll_self'), route(async (req, res) => {
  const result = await enrollEmployee({ sessionId: req.params.sessionId, employeeId: req.userId, source: 'SELF', actorId: req.userId, actorType: 'trainee' });
  await audit({ userIdentity: req.userId, userRole: 'trainee', action: 'SELF_ENROLL_ILT', module: 'Instructor-led Training', referenceId: req.params.sessionId, newValue: result.enrollment });
  return res.status(result.unchanged ? 200 : 201).json({ ok: true, data: result, message: result.enrollment.status === 'WAITLISTED' ? 'Added to the waitlist.' : 'Session enrolment confirmed.' });
}));

router.post('/trainee/enrollments/:enrollmentId/cancel', ...traineeAuth, requirePermission('ilt.enroll_self'), route(async (req, res) => {
  const result = await cancelEnrollment({ enrollmentId: req.params.enrollmentId, actorId: req.userId, actorType: 'trainee', reason: text(req.body?.reason, 10000) });
  await audit({ userIdentity: req.userId, userRole: 'trainee', action: 'CANCEL_ILT_ENROLLMENT', module: 'Instructor-led Training', referenceId: req.params.enrollmentId, newValue: result });
  return res.json({ ok: true, data: result, message: 'Enrolment cancelled.' });
}));

router.post('/trainee/sessions/:sessionId/check-in', ...traineeAuth, requirePermission('ilt.view_self'), route(async (req, res) => {
  const result = await learnerCheckin({ sessionId: req.params.sessionId, employeeId: req.userId, code: text(req.body?.code, 20) });
  return res.json({ ok: true, data: result, message: 'Check-in recorded.' });
}));

router.post('/trainee/sessions/:sessionId/feedback', ...traineeAuth, requirePermission('ilt.view_self'), route(async (req, res) => {
  const result = await submitFeedback({ sessionId: req.params.sessionId, employeeId: req.userId, rating: req.body?.rating, confidenceBefore: req.body?.confidenceBefore, confidenceAfter: req.body?.confidenceAfter, comments: text(req.body?.comments, 10000) });
  return res.json({ ok: true, data: result, message: 'Feedback saved.' });
}));

router.get('/coordinator/dashboard', ...coordinatorAuth, requirePermission('ilt.view_scope'), route(async (req, res) => {
  return res.json({ ok: true, data: await getScopedCalendar({ coordinatorId: req.userId, ...req.query }) });
}));
router.get('/coordinator/catalog', ...coordinatorAuth, requirePermission('ilt.manage_owned'), route(async (req, res) => res.json({ ok: true, data: await catalog(req, 'coordinator') })));
router.get('/coordinator/sessions/:sessionId', ...coordinatorAuth, requirePermission('ilt.view_scope'), route(async (req, res) => {
  await ensureSessionScope(req, 'coordinator', req.params.sessionId);
  return res.json({ ok: true, data: await getSessionDetail(req.params.sessionId) });
}));
router.post('/coordinator/sessions', ...coordinatorAuth, requirePermission('ilt.manage_owned'), route((req, res) => createSessions(req, res, 'coordinator')));
router.put('/coordinator/sessions/:sessionId', ...coordinatorAuth, requirePermission('ilt.manage_owned'), route((req, res) => updateSession(req, res, 'coordinator')));
router.post('/coordinator/sessions/:sessionId/publish', ...coordinatorAuth, requirePermission('ilt.manage_owned'), route(async (req, res) => {
  await ensureSessionScope(req, 'coordinator', req.params.sessionId);
  const result = await publishSession(req.params.sessionId, req.userId);
  await audit({ userIdentity: req.userId, userRole: 'coordinator', action: 'PUBLISH_ILT_SESSION', module: 'Instructor-led Training', referenceId: req.params.sessionId, newValue: result });
  return res.json({ ok: true, data: result, message: 'Session published.' });
}));
router.post('/coordinator/sessions/:sessionId/enroll', ...coordinatorAuth, requirePermission('ilt.manage_owned'), route((req, res) => bulkEnroll(req, res, 'coordinator')));
router.post('/coordinator/sessions/:sessionId/check-in-code', ...coordinatorAuth, requirePermission('ilt.attendance_owned'), route(async (req, res) => {
  await ensureSessionScope(req, 'coordinator', req.params.sessionId);
  return res.json({ ok: true, data: await rotateCheckinCode(req.params.sessionId, req.userId) });
}));
router.put('/coordinator/sessions/:sessionId/attendance/:employeeId', ...coordinatorAuth, requirePermission('ilt.attendance_owned'), route(async (req, res) => {
  await ensureSessionScope(req, 'coordinator', req.params.sessionId);
  const data = await recordAttendance({ sessionId: req.params.sessionId, employeeId: req.params.employeeId, ...req.body, actorId: req.userId });
  return res.json({ ok: true, data, message: 'Attendance saved.' });
}));
router.post('/coordinator/sessions/:sessionId/finalize', ...coordinatorAuth, requirePermission('ilt.attendance_owned'), route(async (req, res) => {
  await ensureSessionScope(req, 'coordinator', req.params.sessionId);
  const data = await finalizeSession(req.params.sessionId, req.userId, { allowEarly: bool(req.body?.allowEarly, false) });
  await audit({ userIdentity: req.userId, userRole: 'coordinator', action: 'FINALIZE_ILT_SESSION', module: 'Instructor-led Training', referenceId: req.params.sessionId, newValue: data });
  return res.json({ ok: true, data, message: 'Session attendance finalized.' });
}));
router.post('/coordinator/sessions/:sessionId/cancel', ...coordinatorAuth, requirePermission('ilt.manage_owned'), route((req, res) => cancelSession(req, res, 'coordinator')));

router.get('/admin/dashboard', ...adminAuth, requirePermission('ilt.view_scope'), route(async (req, res) => {
  return res.json({ ok: true, data: await getScopedCalendar({ branch: companyScope(req) ? '' : req.userBranch, ...req.query }) });
}));
router.get('/admin/catalog', ...adminAuth, requirePermission('ilt.view_scope'), route(async (req, res) => res.json({ ok: true, data: await catalog(req, 'admin') })));
router.get('/admin/sessions/:sessionId', ...adminAuth, requirePermission('ilt.view_scope'), route(async (req, res) => {
  await ensureSessionScope(req, 'admin', req.params.sessionId);
  return res.json({ ok: true, data: await getSessionDetail(req.params.sessionId) });
}));
router.post('/admin/sessions', ...adminAuth, requirePermission('ilt.manage_scope'), route((req, res) => createSessions(req, res, 'admin')));
router.put('/admin/sessions/:sessionId', ...adminAuth, requirePermission('ilt.manage_scope'), route((req, res) => updateSession(req, res, 'admin')));
router.post('/admin/sessions/:sessionId/publish', ...adminAuth, requirePermission('ilt.manage_scope'), route(async (req, res) => {
  await ensureSessionScope(req, 'admin', req.params.sessionId);
  const result = await publishSession(req.params.sessionId, req.userId);
  await audit({ userIdentity: req.userId, userRole: 'admin', action: 'PUBLISH_ILT_SESSION', module: 'Instructor-led Training', referenceId: req.params.sessionId, newValue: result });
  return res.json({ ok: true, data: result, message: 'Session published.' });
}));
router.post('/admin/sessions/:sessionId/enroll', ...adminAuth, requirePermission('ilt.manage_scope'), route((req, res) => bulkEnroll(req, res, 'admin')));
router.post('/admin/sessions/:sessionId/check-in-code', ...adminAuth, requirePermission('ilt.manage_scope'), route(async (req, res) => {
  await ensureSessionScope(req, 'admin', req.params.sessionId);
  return res.json({ ok: true, data: await rotateCheckinCode(req.params.sessionId, req.userId) });
}));
router.put('/admin/sessions/:sessionId/attendance/:employeeId', ...adminAuth, requirePermission('ilt.manage_scope'), route(async (req, res) => {
  await ensureSessionScope(req, 'admin', req.params.sessionId);
  const data = await recordAttendance({ sessionId: req.params.sessionId, employeeId: req.params.employeeId, ...req.body, actorId: req.userId });
  return res.json({ ok: true, data, message: 'Attendance saved.' });
}));
router.post('/admin/sessions/:sessionId/finalize', ...adminAuth, requirePermission('ilt.manage_scope'), route(async (req, res) => {
  await ensureSessionScope(req, 'admin', req.params.sessionId);
  const data = await finalizeSession(req.params.sessionId, req.userId, { allowEarly: bool(req.body?.allowEarly, false) });
  await audit({ userIdentity: req.userId, userRole: 'admin', action: 'FINALIZE_ILT_SESSION', module: 'Instructor-led Training', referenceId: req.params.sessionId, newValue: data });
  return res.json({ ok: true, data, message: 'Session attendance finalized.' });
}));
router.post('/admin/sessions/:sessionId/cancel', ...adminAuth, requirePermission('ilt.manage_scope'), route((req, res) => cancelSession(req, res, 'admin')));

router.post('/admin/venues', ...adminAuth, requirePermission('ilt.manage_scope'), route(async (req, res) => {
  const branch = companyScope(req) ? text(req.body?.branch, 120) : String(req.userBranch || '');
  const venueCode = text(req.body?.venueCode, 60).toUpperCase();
  const venueName = text(req.body?.venueName, 180);
  if (!venueCode || !venueName) return res.status(400).json({ ok: false, message: 'Venue code and name are required.' });
  const venueId = randomUUID();
  await prisma.$executeRawUnsafe(
    `INSERT INTO ilt_venue
       (venue_id, venue_code, venue_name, branch, venue_type, room_location,
        timezone, capacity, virtual_join_url, accessibility_notes, active, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    venueId, venueCode, venueName, branch,
    ['CLASSROOM', 'VIRTUAL', 'HYBRID'].includes(text(req.body?.venueType, 30).toUpperCase()) ? text(req.body.venueType, 30).toUpperCase() : 'CLASSROOM',
    text(req.body?.roomLocation, 500) || null, text(req.body?.timezone, 80) || 'Asia/Kolkata',
    Math.round(number(req.body?.capacity, 25, 1, 10000)), text(req.body?.virtualJoinUrl, 4000) || null,
    text(req.body?.accessibilityNotes, 10000) || null, bool(req.body?.active, true) ? 1 : 0, String(req.userId),
  );
  await audit({ userIdentity: req.userId, userRole: 'admin', action: 'CREATE_ILT_VENUE', module: 'Instructor-led Training', referenceId: venueId, newValue: req.body });
  return res.status(201).json({ ok: true, data: { venueId }, message: 'Venue created.' });
}));

router.post('/admin/instructors', ...adminAuth, requirePermission('ilt.manage_scope'), route(async (req, res) => {
  const branch = companyScope(req) ? text(req.body?.branch, 120) : String(req.userBranch || '');
  const userId = text(req.body?.userId, 120);
  const instructorName = text(req.body?.instructorName, 180);
  if (!userId || !instructorName) return res.status(400).json({ ok: false, message: 'User ID and instructor name are required.' });
  const instructorId = randomUUID();
  await prisma.$executeRawUnsafe(
    `INSERT INTO ilt_instructor
       (instructor_id, user_id, user_type, instructor_name, email,
        branch, process_name, lob_name, max_daily_minutes, active, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       instructor_name = VALUES(instructor_name), email = VALUES(email),
       branch = VALUES(branch), process_name = VALUES(process_name), lob_name = VALUES(lob_name),
       max_daily_minutes = VALUES(max_daily_minutes), active = VALUES(active), created_by = VALUES(created_by)`,
    instructorId, userId, text(req.body?.userType, 30) || 'coordinator', instructorName,
    text(req.body?.email, 240) || null, branch, text(req.body?.processName, 120), text(req.body?.lobName, 120),
    Math.round(number(req.body?.maxDailyMinutes, 480, 30, 1440)), bool(req.body?.active, true) ? 1 : 0, String(req.userId),
  );
  await audit({ userIdentity: req.userId, userRole: 'admin', action: 'SAVE_ILT_INSTRUCTOR', module: 'Instructor-led Training', referenceId: instructorId, newValue: req.body });
  return res.status(201).json({ ok: true, data: { instructorId }, message: 'Instructor profile saved.' });
}));

router.put('/admin/policies', ...adminAuth, requirePermission('ilt.configure'), route(savePolicy));

export default router;

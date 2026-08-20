// Buddy/Mentor Pairing v1 — pairs a new hire (trainee) with a senior trainee
// or coordinator during onboarding. Kept lean: a pairing lifecycle
// (ACTIVE/COMPLETED/CANCELLED) plus a lightweight check-in log, not a full
// 1:1-notes app. mentorId is a loosely-coupled string matched against either
// TraineeMaster.employeeId (mentorType TRAINEE) or RoleAccessMatrix.loginId
// (mentorType COORDINATOR) — see prisma/schema.prisma MentorPairing.
import { prisma } from '../utils/db.js';
import { audit } from '../utils/audit.js';

const VALID_STATUS = new Set(['ACTIVE', 'COMPLETED', 'CANCELLED']);
const VALID_MENTOR_TYPE = new Set(['TRAINEE', 'COORDINATOR']);
const VALID_RATING = new Set(['GOOD', 'NEEDS_ATTENTION', 'CONCERN']);
const MENTOR_LOAD_CAP = 3; // heuristic: a mentor with fewer active mentees than this ranks higher in suggestions

function text(value, max = 200) {
  return String(value ?? '').trim().slice(0, max);
}

function dateOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// Resolves the mentor's display name and confirms it exists/active in the
// table its mentorType points at.
async function resolveMentor(mentorId, mentorType) {
  if (mentorType === 'COORDINATOR') {
    const row = await prisma.roleAccessMatrix.findFirst({
      where: { loginId: mentorId, active: true },
      select: { loginId: true, name: true, branch: true, process: true },
    });
    return row ? { mentorName: row.name || row.loginId, branch: row.branch, process: row.process } : null;
  }
  const row = await prisma.traineeMaster.findFirst({
    where: { employeeId: mentorId, status: 'Active' },
    select: { employeeId: true, traineeName: true, branch: true, process: true, batchNo: true },
  });
  return row ? { mentorName: row.traineeName || row.employeeId, branch: row.branch, process: row.process, batchNo: row.batchNo } : null;
}

// Scope filter applied on top of query filters — coordinators only see
// pairings whose mentee sits in a batch they own; branch-scoped admins only
// see their branch. Company-wide admins (no branch) see everything.
async function scopeWhere(req) {
  if (req.userType === 'coordinator') {
    const owned = await prisma.batchMaster.findMany({ where: { coordinatorLoginId: req.userId }, select: { batchNo: true } });
    const batchNos = owned.map(b => b.batchNo);
    return { batchNo: { in: batchNos.length ? batchNos : ['__none__'] } };
  }
  if (req.userType === 'admin' && req.userBranch) {
    return { branch: req.userBranch };
  }
  return {};
}

function toDto(row) {
  return {
    id: row.id,
    menteeEmployeeId: row.menteeEmployeeId,
    menteeName: row.menteeName,
    mentorId: row.mentorId,
    mentorType: row.mentorType,
    mentorName: row.mentorName,
    batchNo: row.batchNo,
    branch: row.branch,
    process: row.process,
    status: row.status,
    pairedBy: row.pairedBy,
    pairedAt: row.pairedAt,
    targetEndDate: row.targetEndDate,
    endedAt: row.endedAt,
    endedReason: row.endedReason,
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ── Admin/Coordinator: list + filter ────────────────────────────────────────
export async function listPairings(req, res) {
  try {
    const where = { ...(await scopeWhere(req)) };
    const q = req.query || {};
    if (q.batchNo) where.batchNo = q.batchNo;
    if (q.branch) where.branch = q.branch;
    if (q.process) where.process = q.process;
    if (q.status && VALID_STATUS.has(String(q.status).toUpperCase())) where.status = String(q.status).toUpperCase();

    const take = Math.min(Math.max(parseInt(q.limit, 10) || 100, 1), 500);
    const rows = await prisma.mentorPairing.findMany({ where, orderBy: { pairedAt: 'desc' }, take });
    return res.json({ ok: true, data: rows.map(toDto) });
  } catch (err) {
    console.error('[MentorPairing] listPairings failed:', err.message);
    return res.status(500).json({ ok: false, message: 'Could not load mentor pairings.' });
  }
}

// ── Admin/Coordinator: simple mentor suggestions ────────────────────────────
// Heuristic only: certified/high-completion active trainees in the same
// batch (falling back to process), plus the batch's coordinator, ranked by
// current active-mentee load ascending. No optimization, no ML.
export async function suggestMentors(req, res) {
  try {
    const batchNo = text(req.query?.batchNo, 120);
    const process = text(req.query?.process, 120);
    if (!batchNo && !process) return res.status(400).json({ ok: false, message: 'batchNo or process is required.' });

    const where = { status: 'Active' };
    if (batchNo) where.batchNo = batchNo;
    else where.process = process;

    const candidates = await prisma.traineeMaster.findMany({
      where: { ...where, OR: [{ certificationStatus: 'Certified' }, { courseCompletionPct: { gte: 90 } }] },
      select: { employeeId: true, traineeName: true, batchNo: true, branch: true, process: true, certificationStatus: true, courseCompletionPct: true },
      take: 50,
    });

    const loadCounts = await prisma.mentorPairing.groupBy({
      by: ['mentorId'],
      where: { status: 'ACTIVE', mentorId: { in: candidates.map(c => c.employeeId) } },
      _count: { mentorId: true },
    });
    const loadByMentor = new Map(loadCounts.map(row => [row.mentorId, row._count.mentorId]));

    const suggestions = candidates
      .map(c => ({
        mentorId: c.employeeId,
        mentorType: 'TRAINEE',
        mentorName: c.traineeName || c.employeeId,
        batchNo: c.batchNo,
        branch: c.branch,
        process: c.process,
        certificationStatus: c.certificationStatus,
        courseCompletionPct: c.courseCompletionPct,
        activeMenteeCount: loadByMentor.get(c.employeeId) || 0,
      }))
      .filter(c => c.activeMenteeCount < MENTOR_LOAD_CAP)
      .sort((a, b) => a.activeMenteeCount - b.activeMenteeCount || b.courseCompletionPct - a.courseCompletionPct)
      .slice(0, 10);

    let coordinatorSuggestion = null;
    if (batchNo) {
      const batch = await prisma.batchMaster.findUnique({ where: { batchNo }, select: { coordinatorLoginId: true, coordinatorName: true } });
      if (batch?.coordinatorLoginId) {
        coordinatorSuggestion = { mentorId: batch.coordinatorLoginId, mentorType: 'COORDINATOR', mentorName: batch.coordinatorName || batch.coordinatorLoginId };
      }
    }

    return res.json({ ok: true, data: { trainees: suggestions, coordinator: coordinatorSuggestion } });
  } catch (err) {
    console.error('[MentorPairing] suggestMentors failed:', err.message);
    return res.status(500).json({ ok: false, message: 'Could not compute mentor suggestions.' });
  }
}

// ── Admin/Coordinator: create a pairing ─────────────────────────────────────
export async function createPairing(req, res) {
  try {
    const menteeEmployeeId = text(req.body?.menteeEmployeeId, 191);
    const mentorId = text(req.body?.mentorId, 191);
    const mentorType = text(req.body?.mentorType, 30).toUpperCase() || 'TRAINEE';
    if (!menteeEmployeeId || !mentorId || !VALID_MENTOR_TYPE.has(mentorType)) {
      return res.status(400).json({ ok: false, message: 'Mentee, mentor and a valid mentor type are required.' });
    }
    if (menteeEmployeeId === mentorId) {
      return res.status(400).json({ ok: false, message: 'A trainee cannot be paired with themselves.' });
    }

    const mentee = await prisma.traineeMaster.findFirst({
      where: { employeeId: menteeEmployeeId, status: 'Active' },
      select: { employeeId: true, traineeName: true, batchNo: true, branch: true, process: true },
    });
    if (!mentee) return res.status(404).json({ ok: false, message: 'Active trainee not found for menteeEmployeeId.' });

    if (req.userType === 'coordinator') {
      const owns = await prisma.batchMaster.findFirst({ where: { batchNo: mentee.batchNo, coordinatorLoginId: req.userId } });
      if (!owns) return res.status(403).json({ ok: false, message: 'Mentee is outside your owned batches.' });
    } else if (req.userType === 'admin' && req.userBranch && mentee.branch !== req.userBranch) {
      return res.status(403).json({ ok: false, message: 'Mentee is outside your branch scope.' });
    }

    const mentor = await resolveMentor(mentorId, mentorType);
    if (!mentor) return res.status(404).json({ ok: false, message: 'Active mentor not found for mentorId/mentorType.' });

    const existingActive = await prisma.mentorPairing.findFirst({ where: { menteeEmployeeId, status: 'ACTIVE' } });
    if (existingActive) return res.status(409).json({ ok: false, message: 'This trainee already has an active mentor pairing.' });

    const row = await prisma.mentorPairing.create({
      data: {
        menteeEmployeeId,
        menteeName: mentee.traineeName,
        mentorId,
        mentorType,
        mentorName: mentor.mentorName,
        batchNo: mentee.batchNo,
        branch: mentee.branch,
        process: mentee.process,
        status: 'ACTIVE',
        pairedBy: req.userId,
        targetEndDate: dateOrNull(req.body?.targetEndDate),
        notes: text(req.body?.notes, 5000) || null,
      },
    });

    await audit({ userIdentity: req.userId, userRole: req.userType === 'admin' ? 'Admin' : 'Coordinator', action: 'CREATE_MENTOR_PAIRING', module: 'MentorPairing', referenceId: row.id, newValue: { menteeEmployeeId, mentorId, mentorType } });
    return res.status(201).json({ ok: true, data: toDto(row) });
  } catch (err) {
    console.error('[MentorPairing] createPairing failed:', err.message);
    return res.status(500).json({ ok: false, message: 'Could not create mentor pairing.' });
  }
}

// ── Admin/Coordinator: end a pairing ────────────────────────────────────────
export async function endPairing(req, res) {
  try {
    const id = text(req.params?.id, 191);
    const status = text(req.body?.status, 20).toUpperCase() || 'COMPLETED';
    if (!['COMPLETED', 'CANCELLED'].includes(status)) return res.status(400).json({ ok: false, message: 'status must be COMPLETED or CANCELLED.' });

    const where = { id, ...(await scopeWhere(req)) };
    const pairing = await prisma.mentorPairing.findFirst({ where });
    if (!pairing) return res.status(404).json({ ok: false, message: 'Pairing not found in your scope.' });
    if (pairing.status !== 'ACTIVE') return res.status(409).json({ ok: false, message: 'Only an active pairing can be ended.' });

    const updated = await prisma.mentorPairing.update({
      where: { id },
      data: { status, endedAt: new Date(), endedReason: text(req.body?.reason, 2000) || null },
    });
    await audit({ userIdentity: req.userId, userRole: req.userType === 'admin' ? 'Admin' : 'Coordinator', action: 'END_MENTOR_PAIRING', module: 'MentorPairing', referenceId: id, newValue: { status } });
    return res.json({ ok: true, data: toDto(updated) });
  } catch (err) {
    console.error('[MentorPairing] endPairing failed:', err.message);
    return res.status(500).json({ ok: false, message: 'Could not end mentor pairing.' });
  }
}

async function listCheckinsFor(pairingId) {
  return prisma.mentorPairingCheckin.findMany({ where: { pairingId }, orderBy: { checkinDate: 'desc' }, take: 200 });
}

// ── Admin/Coordinator: check-ins on a pairing ───────────────────────────────
export async function listCheckinsAdmin(req, res) {
  try {
    const id = text(req.params?.id, 191);
    const pairing = await prisma.mentorPairing.findFirst({ where: { id, ...(await scopeWhere(req)) } });
    if (!pairing) return res.status(404).json({ ok: false, message: 'Pairing not found in your scope.' });
    const rows = await listCheckinsFor(id);
    return res.json({ ok: true, data: { pairing: toDto(pairing), checkins: rows } });
  } catch (err) {
    console.error('[MentorPairing] listCheckinsAdmin failed:', err.message);
    return res.status(500).json({ ok: false, message: 'Could not load check-ins.' });
  }
}

export async function logCheckinAdmin(req, res) {
  try {
    const id = text(req.params?.id, 191);
    const pairing = await prisma.mentorPairing.findFirst({ where: { id, ...(await scopeWhere(req)) } });
    if (!pairing) return res.status(404).json({ ok: false, message: 'Pairing not found in your scope.' });
    return res.status(201).json({ ok: true, data: await createCheckin(pairing, req, req.userType === 'admin' ? 'ADMIN' : 'COORDINATOR') });
  } catch (err) {
    console.error('[MentorPairing] logCheckinAdmin failed:', err.message);
    return res.status(500).json({ ok: false, message: 'Could not log check-in.' });
  }
}

async function createCheckin(pairing, req, loggedByType) {
  const rating = text(req.body?.rating, 20).toUpperCase() || 'GOOD';
  const remarks = text(req.body?.remarks, 3000) || null;
  const row = await prisma.mentorPairingCheckin.create({
    data: {
      pairingId: pairing.id,
      loggedBy: req.userId,
      loggedByType,
      rating: VALID_RATING.has(rating) ? rating : 'GOOD',
      remarks,
    },
  });
  await audit({ userIdentity: req.userId, userRole: loggedByType, action: 'LOG_MENTOR_CHECKIN', module: 'MentorPairing', referenceId: pairing.id, newValue: { rating: row.rating } });
  return row;
}

// ── Trainee: my pairing(s) as mentee and/or mentor ──────────────────────────
export async function getMyPairing(req, res) {
  try {
    const employeeId = req.userId;
    const [asMentee, asMentor] = await Promise.all([
      prisma.mentorPairing.findMany({ where: { menteeEmployeeId: employeeId }, orderBy: { pairedAt: 'desc' }, take: 20 }),
      prisma.mentorPairing.findMany({ where: { mentorId: employeeId, mentorType: 'TRAINEE' }, orderBy: { pairedAt: 'desc' }, take: 50 }),
    ]);

    const pairingIds = [...asMentee, ...asMentor].map(row => row.id);
    const checkins = pairingIds.length
      ? await prisma.mentorPairingCheckin.findMany({ where: { pairingId: { in: pairingIds } }, orderBy: { checkinDate: 'desc' }, take: 200 })
      : [];
    const checkinsByPairing = new Map();
    for (const checkin of checkins) {
      if (!checkinsByPairing.has(checkin.pairingId)) checkinsByPairing.set(checkin.pairingId, []);
      checkinsByPairing.get(checkin.pairingId).push(checkin);
    }

    return res.json({
      ok: true,
      data: {
        asMentee: asMentee.map(row => ({ ...toDto(row), checkins: checkinsByPairing.get(row.id) || [] })),
        asMentor: asMentor.map(row => ({ ...toDto(row), checkins: checkinsByPairing.get(row.id) || [] })),
      },
    });
  } catch (err) {
    console.error('[MentorPairing] getMyPairing failed:', err.message);
    return res.status(500).json({ ok: false, message: 'Could not load your mentor pairing.' });
  }
}

// ── Trainee: log a check-in on your own pairing (as mentee or mentor) ──────
export async function logCheckinSelf(req, res) {
  try {
    const pairingId = text(req.body?.pairingId, 191);
    if (!pairingId) return res.status(400).json({ ok: false, message: 'pairingId is required.' });

    const pairing = await prisma.mentorPairing.findUnique({ where: { id: pairingId } });
    if (!pairing) return res.status(404).json({ ok: false, message: 'Pairing not found.' });

    const isMentee = pairing.menteeEmployeeId === req.userId;
    const isMentor = pairing.mentorType === 'TRAINEE' && pairing.mentorId === req.userId;
    if (!isMentee && !isMentor) return res.status(403).json({ ok: false, message: 'You are not part of this pairing.' });
    if (pairing.status !== 'ACTIVE') return res.status(409).json({ ok: false, message: 'Check-ins can only be logged on an active pairing.' });

    const row = await createCheckin(pairing, req, isMentee ? 'MENTEE' : 'MENTOR');
    return res.status(201).json({ ok: true, data: row });
  } catch (err) {
    console.error('[MentorPairing] logCheckinSelf failed:', err.message);
    return res.status(500).json({ ok: false, message: 'Could not log check-in.' });
  }
}

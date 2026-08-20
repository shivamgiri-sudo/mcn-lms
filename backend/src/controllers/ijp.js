// Internal Job Posting (IJP) / Promotion Tracker v1 — lets Admin/Coordinator
// post an open internal role (a process/branch/level opening), lets
// trainees apply, and lets Admin/Coordinator review applications and mark
// outcomes. Kept lean, not a full ATS: one posting lifecycle
// (OPEN/CLOSED/FILLED) plus one application lifecycle
// (APPLIED/SHORTLISTED/SELECTED/REJECTED/WITHDRAWN). See
// prisma/schema.prisma InternalJobPosting / InternalJobApplication.
//
// Eligibility filter design decision (documented per task spec): the
// trainee-facing "open postings" list is filtered, not hard-gated —
// eligibleOnly=true (the default) hides postings whose targetBranch/
// targetProcess don't match the trainee's own branch/process (when set on
// the posting) and whose minTenureMonths (when set) exceeds the trainee's
// tenure computed from TraineeMaster.doj. Passing eligibleOnly=false
// returns every OPEN posting with an `eligible` flag instead, so a trainee
// can still see (but be informed they may not qualify for) a wider role.
// targetDesignation is informational only — it is not filtered on, since
// "level" comparisons are fuzzy and the task explicitly said this should be
// a filter, not a hard gate.
import { prisma } from '../utils/db.js';
import { audit } from '../utils/audit.js';

const VALID_POSTING_STATUS = new Set(['OPEN', 'CLOSED', 'FILLED']);
const VALID_APPLICATION_STATUS = new Set(['APPLIED', 'SHORTLISTED', 'SELECTED', 'REJECTED', 'WITHDRAWN']);
const REVIEW_STATUS = new Set(['SHORTLISTED', 'SELECTED', 'REJECTED']);

function text(value, max = 200) {
  return String(value ?? '').trim().slice(0, max);
}

function dateOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function intOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function tenureMonths(doj) {
  if (!doj) return null;
  const start = new Date(doj);
  if (Number.isNaN(start.getTime())) return null;
  const now = new Date();
  return (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
}

function postingDto(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    targetBranch: row.targetBranch,
    targetProcess: row.targetProcess,
    targetLob: row.targetLob,
    targetDesignation: row.targetDesignation,
    minTenureMonths: row.minTenureMonths,
    status: row.status,
    postedBy: row.postedBy,
    postedAt: row.postedAt,
    closesAt: row.closesAt,
    filledBy: row.filledBy,
    filledAt: row.filledAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function applicationDto(row) {
  return {
    id: row.id,
    postingId: row.postingId,
    applicantEmployeeId: row.applicantEmployeeId,
    applicantName: row.applicantName,
    currentDesignation: row.currentDesignation,
    currentBranch: row.currentBranch,
    currentProcess: row.currentProcess,
    status: row.status,
    appliedAt: row.appliedAt,
    reviewedBy: row.reviewedBy,
    reviewedAt: row.reviewedAt,
    reviewNotes: row.reviewNotes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ── Admin/Coordinator: create a posting ─────────────────────────────────────
export async function createPosting(req, res) {
  try {
    const title = text(req.body?.title, 191);
    if (!title) return res.status(400).json({ ok: false, message: 'title is required.' });

    const row = await prisma.internalJobPosting.create({
      data: {
        title,
        description: text(req.body?.description, 5000) || null,
        targetBranch: text(req.body?.targetBranch, 191) || null,
        targetProcess: text(req.body?.targetProcess, 191) || null,
        targetLob: text(req.body?.targetLob, 191) || null,
        targetDesignation: text(req.body?.targetDesignation, 191) || null,
        minTenureMonths: intOrNull(req.body?.minTenureMonths),
        status: 'OPEN',
        postedBy: req.userId,
        closesAt: dateOrNull(req.body?.closesAt),
      },
    });

    await audit({ userIdentity: req.userId, userRole: req.userType === 'admin' ? 'Admin' : 'Coordinator', action: 'CREATE_IJP_POSTING', module: 'InternalJobPosting', referenceId: row.id, newValue: { title } });
    return res.status(201).json({ ok: true, data: postingDto(row) });
  } catch (err) {
    console.error('[IJP] createPosting failed:', err.message);
    return res.status(500).json({ ok: false, message: 'Could not create posting.' });
  }
}

// ── Admin/Coordinator: list + filter postings ───────────────────────────────
export async function listPostingsAdmin(req, res) {
  try {
    const q = req.query || {};
    const where = {};
    if (q.status && VALID_POSTING_STATUS.has(String(q.status).toUpperCase())) where.status = String(q.status).toUpperCase();
    if (q.branch) where.targetBranch = q.branch;
    if (q.process) where.targetProcess = q.process;

    const take = Math.min(Math.max(parseInt(q.limit, 10) || 100, 1), 500);
    const rows = await prisma.internalJobPosting.findMany({ where, orderBy: { postedAt: 'desc' }, take });

    const postingIds = rows.map(r => r.id);
    const counts = postingIds.length
      ? await prisma.internalJobApplication.groupBy({ by: ['postingId'], where: { postingId: { in: postingIds } }, _count: { postingId: true } })
      : [];
    const countByPosting = new Map(counts.map(c => [c.postingId, c._count.postingId]));

    return res.json({ ok: true, data: rows.map(row => ({ ...postingDto(row), applicationCount: countByPosting.get(row.id) || 0 })) });
  } catch (err) {
    console.error('[IJP] listPostingsAdmin failed:', err.message);
    return res.status(500).json({ ok: false, message: 'Could not load postings.' });
  }
}

// ── Admin/Coordinator: close or fill a posting ──────────────────────────────
export async function closePosting(req, res) {
  try {
    const id = text(req.params?.id, 191);
    const posting = await prisma.internalJobPosting.findUnique({ where: { id } });
    if (!posting) return res.status(404).json({ ok: false, message: 'Posting not found.' });
    if (posting.status !== 'OPEN') return res.status(409).json({ ok: false, message: 'Only an open posting can be closed.' });

    const updated = await prisma.internalJobPosting.update({ where: { id }, data: { status: 'CLOSED' } });
    await audit({ userIdentity: req.userId, userRole: req.userType === 'admin' ? 'Admin' : 'Coordinator', action: 'CLOSE_IJP_POSTING', module: 'InternalJobPosting', referenceId: id, newValue: { status: 'CLOSED' } });
    return res.json({ ok: true, data: postingDto(updated) });
  } catch (err) {
    console.error('[IJP] closePosting failed:', err.message);
    return res.status(500).json({ ok: false, message: 'Could not close posting.' });
  }
}

export async function fillPosting(req, res) {
  try {
    const id = text(req.params?.id, 191);
    const filledBy = text(req.body?.filledBy, 191);
    if (!filledBy) return res.status(400).json({ ok: false, message: 'filledBy (the applicant employeeId who was selected) is required.' });

    const posting = await prisma.internalJobPosting.findUnique({ where: { id } });
    if (!posting) return res.status(404).json({ ok: false, message: 'Posting not found.' });
    if (posting.status === 'FILLED') return res.status(409).json({ ok: false, message: 'Posting is already marked FILLED.' });

    const updated = await prisma.internalJobPosting.update({
      where: { id },
      data: { status: 'FILLED', filledBy, filledAt: new Date() },
    });

    // Best-effort: mark the winning application SELECTED and auto-reject the
    // rest of the still-open applications on this posting.
    await prisma.internalJobApplication.updateMany({
      where: { postingId: id, applicantEmployeeId: filledBy },
      data: { status: 'SELECTED', reviewedBy: req.userId, reviewedAt: new Date() },
    });
    await prisma.internalJobApplication.updateMany({
      where: { postingId: id, applicantEmployeeId: { not: filledBy }, status: { in: ['APPLIED', 'SHORTLISTED'] } },
      data: { status: 'REJECTED', reviewedBy: req.userId, reviewedAt: new Date() },
    });

    await audit({ userIdentity: req.userId, userRole: req.userType === 'admin' ? 'Admin' : 'Coordinator', action: 'FILL_IJP_POSTING', module: 'InternalJobPosting', referenceId: id, newValue: { filledBy } });
    return res.json({ ok: true, data: postingDto(updated) });
  } catch (err) {
    console.error('[IJP] fillPosting failed:', err.message);
    return res.status(500).json({ ok: false, message: 'Could not fill posting.' });
  }
}

// ── Admin/Coordinator: list + review applications on a posting ─────────────
export async function listApplicationsAdmin(req, res) {
  try {
    const id = text(req.params?.id, 191);
    const posting = await prisma.internalJobPosting.findUnique({ where: { id } });
    if (!posting) return res.status(404).json({ ok: false, message: 'Posting not found.' });

    const rows = await prisma.internalJobApplication.findMany({ where: { postingId: id }, orderBy: { appliedAt: 'desc' } });
    return res.json({ ok: true, data: { posting: postingDto(posting), applications: rows.map(applicationDto) } });
  } catch (err) {
    console.error('[IJP] listApplicationsAdmin failed:', err.message);
    return res.status(500).json({ ok: false, message: 'Could not load applications.' });
  }
}

export async function reviewApplication(req, res) {
  try {
    const id = text(req.params?.id, 191);
    const status = text(req.body?.status, 20).toUpperCase();
    if (!REVIEW_STATUS.has(status)) return res.status(400).json({ ok: false, message: 'status must be SHORTLISTED, SELECTED or REJECTED.' });

    const application = await prisma.internalJobApplication.findUnique({ where: { id } });
    if (!application) return res.status(404).json({ ok: false, message: 'Application not found.' });
    if (!['APPLIED', 'SHORTLISTED'].includes(application.status)) {
      return res.status(409).json({ ok: false, message: 'Only an open application (APPLIED/SHORTLISTED) can be reviewed.' });
    }

    const updated = await prisma.internalJobApplication.update({
      where: { id },
      data: { status, reviewedBy: req.userId, reviewedAt: new Date(), reviewNotes: text(req.body?.reviewNotes, 3000) || null },
    });

    await audit({ userIdentity: req.userId, userRole: req.userType === 'admin' ? 'Admin' : 'Coordinator', action: 'REVIEW_IJP_APPLICATION', module: 'InternalJobApplication', referenceId: id, newValue: { status } });
    return res.json({ ok: true, data: applicationDto(updated) });
  } catch (err) {
    console.error('[IJP] reviewApplication failed:', err.message);
    return res.status(500).json({ ok: false, message: 'Could not review application.' });
  }
}

// ── Trainee: eligible open postings ─────────────────────────────────────────
export async function listOpenPostingsSelf(req, res) {
  try {
    const employeeId = req.userId;
    const trainee = await prisma.traineeMaster.findFirst({
      where: { employeeId, status: 'Active' },
      select: { employeeId: true, traineeName: true, branch: true, process: true, designation: true, doj: true },
    });
    if (!trainee) return res.status(404).json({ ok: false, message: 'Trainee record not found.' });

    const eligibleOnly = String(req.query?.eligibleOnly ?? 'true') !== 'false';
    const myTenure = tenureMonths(trainee.doj);

    const postings = await prisma.internalJobPosting.findMany({ where: { status: 'OPEN' }, orderBy: { postedAt: 'desc' }, take: 200 });
    const myApplications = await prisma.internalJobApplication.findMany({
      where: { applicantEmployeeId: employeeId, postingId: { in: postings.map(p => p.id) } },
      select: { postingId: true, status: true },
    });
    const appliedByPosting = new Map(myApplications.map(a => [a.postingId, a.status]));

    const withEligibility = postings.map(row => {
      const branchOk = !row.targetBranch || row.targetBranch === trainee.branch;
      const processOk = !row.targetProcess || row.targetProcess === trainee.process;
      const tenureOk = row.minTenureMonths == null || (myTenure != null && myTenure >= row.minTenureMonths);
      return {
        ...postingDto(row),
        eligible: branchOk && processOk && tenureOk,
        alreadyApplied: appliedByPosting.has(row.id),
        myApplicationStatus: appliedByPosting.get(row.id) || null,
      };
    });

    const data = eligibleOnly ? withEligibility.filter(p => p.eligible) : withEligibility;
    return res.json({ ok: true, data });
  } catch (err) {
    console.error('[IJP] listOpenPostingsSelf failed:', err.message);
    return res.status(500).json({ ok: false, message: 'Could not load open postings.' });
  }
}

// ── Trainee: apply to a posting ─────────────────────────────────────────────
export async function applyToPosting(req, res) {
  try {
    const postingId = text(req.params?.id, 191);
    const employeeId = req.userId;

    const posting = await prisma.internalJobPosting.findUnique({ where: { id: postingId } });
    if (!posting) return res.status(404).json({ ok: false, message: 'Posting not found.' });
    if (posting.status !== 'OPEN') return res.status(409).json({ ok: false, message: 'This posting is no longer open.' });

    const trainee = await prisma.traineeMaster.findFirst({
      where: { employeeId, status: 'Active' },
      select: { employeeId: true, traineeName: true, branch: true, process: true, designation: true },
    });
    if (!trainee) return res.status(404).json({ ok: false, message: 'Trainee record not found.' });

    const existing = await prisma.internalJobApplication.findFirst({ where: { postingId, applicantEmployeeId: employeeId } });
    if (existing) return res.status(409).json({ ok: false, message: 'You have already applied to this posting.' });

    const row = await prisma.internalJobApplication.create({
      data: {
        postingId,
        applicantEmployeeId: employeeId,
        applicantName: trainee.traineeName,
        currentDesignation: trainee.designation,
        currentBranch: trainee.branch,
        currentProcess: trainee.process,
        status: 'APPLIED',
      },
    });

    await audit({ userIdentity: employeeId, userRole: 'Trainee', action: 'APPLY_IJP_POSTING', module: 'InternalJobApplication', referenceId: row.id, newValue: { postingId } });
    return res.status(201).json({ ok: true, data: applicationDto(row) });
  } catch (err) {
    // Unique constraint race (double-submit) surfaces as a 409, not a 500.
    if (err?.code === 'P2002') return res.status(409).json({ ok: false, message: 'You have already applied to this posting.' });
    console.error('[IJP] applyToPosting failed:', err.message);
    return res.status(500).json({ ok: false, message: 'Could not submit application.' });
  }
}

// ── Trainee: own application history ────────────────────────────────────────
export async function myApplications(req, res) {
  try {
    const employeeId = req.userId;
    const rows = await prisma.internalJobApplication.findMany({ where: { applicantEmployeeId: employeeId }, orderBy: { appliedAt: 'desc' } });
    const postings = await prisma.internalJobPosting.findMany({ where: { id: { in: rows.map(r => r.postingId) } } });
    const postingById = new Map(postings.map(p => [p.id, postingDto(p)]));

    return res.json({ ok: true, data: rows.map(row => ({ ...applicationDto(row), posting: postingById.get(row.postingId) || null })) });
  } catch (err) {
    console.error('[IJP] myApplications failed:', err.message);
    return res.status(500).json({ ok: false, message: 'Could not load your applications.' });
  }
}

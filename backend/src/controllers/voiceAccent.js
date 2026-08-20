// Voice & Accent Assessment v1 — trainees record a script reading or scenario
// role-play; a trainer/coordinator/QA evaluator scores it against a flexible
// rubric (dimension -> 0-100 stored as JSON, not fixed columns, so the rubric
// stays editable). Follows the mentor-pairing/IJP precedent on this branch:
// a standalone controller + route file, denormalized batchNo/branch/process
// on the submission so review-queue and access-scope queries never need a
// join. See prisma/schema.prisma VoiceAccentPrompt / VoiceAccentSubmission.
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { prisma } from '../utils/db.js';
import { audit } from '../utils/audit.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = process.env.UPLOAD_DIR || 'uploads';
const voiceRoot = path.isAbsolute(UPLOAD_DIR)
  ? path.join(UPLOAD_DIR, 'voice')
  : path.resolve(__dirname, '..', '..', UPLOAD_DIR, 'voice');

const VALID_PROMPT_TYPE = new Set(['SCRIPT_READING', 'SCENARIO_ROLEPLAY']);
const VALID_STATUS = new Set(['SUBMITTED', 'SCORED']);
const DEFAULT_RUBRIC_DIMENSIONS = ['clarity', 'pace', 'accentNeutrality', 'tone', 'grammar'];

function text(value, max = 200) {
  return String(value ?? '').trim().slice(0, max);
}

function scoreOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function sanitizeRubricScores(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const out = {};
  for (const [key, value] of Object.entries(input)) {
    const k = text(key, 60);
    const v = scoreOrNull(value);
    if (k && v !== null) out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

// Scope filter for admin/coordinator review — same pattern as
// controllers/mentorPairing.js scopeWhere: coordinators see only their owned
// batches, branch-scoped admins only their branch, company-wide admins see
// everything.
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

function toPromptDto(row) {
  return {
    id: row.id,
    title: row.title,
    promptText: row.promptText,
    promptType: row.promptType,
    category: row.category,
    level: row.level,
    active: row.active,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toSubmissionDto(row) {
  return {
    id: row.id,
    promptId: row.promptId,
    employeeId: row.employeeId,
    employeeName: row.employeeName,
    batchNo: row.batchNo,
    branch: row.branch,
    process: row.process,
    originalFilename: row.originalFilename,
    mimeType: row.mimeType,
    fileSize: row.fileSize,
    durationSeconds: row.durationSeconds,
    submittedAt: row.submittedAt,
    status: row.status,
    scoredBy: row.scoredBy,
    scoredAt: row.scoredAt,
    overallScore: row.overallScore,
    rubricScores: row.rubricScores,
    feedbackNotes: row.feedbackNotes,
    audioUrl: `/api/voice-accent/audio/${row.id}`,
  };
}

// ── Admin/Coordinator: manage prompts ───────────────────────────────────────
export async function listPrompts(req, res) {
  try {
    const where = {};
    const q = req.query || {};
    if (q.active === 'true') where.active = true;
    else if (q.active === 'false') where.active = false;
    if (q.category) where.category = q.category;
    const rows = await prisma.voiceAccentPrompt.findMany({ where, orderBy: { createdAt: 'desc' }, take: 500 });
    return res.json({ ok: true, data: rows.map(toPromptDto) });
  } catch (err) {
    console.error('[VoiceAccent] listPrompts failed:', err.message);
    return res.status(500).json({ ok: false, message: 'Could not load voice & accent prompts.' });
  }
}

export async function createPrompt(req, res) {
  try {
    const title = text(req.body?.title, 191);
    const promptText = text(req.body?.promptText, 8000);
    const promptType = text(req.body?.promptType, 30).toUpperCase() || 'SCRIPT_READING';
    if (!title || !promptText) return res.status(400).json({ ok: false, message: 'Title and prompt text are required.' });
    if (!VALID_PROMPT_TYPE.has(promptType)) return res.status(400).json({ ok: false, message: 'promptType must be SCRIPT_READING or SCENARIO_ROLEPLAY.' });

    const row = await prisma.voiceAccentPrompt.create({
      data: {
        title,
        promptText,
        promptType,
        category: text(req.body?.category, 120) || null,
        level: text(req.body?.level, 60) || null,
        active: req.body?.active === undefined ? true : Boolean(req.body.active),
        createdBy: req.userId,
      },
    });
    await audit({ userIdentity: req.userId, userRole: req.userType === 'admin' ? 'Admin' : 'Coordinator', action: 'CREATE_VOICE_ACCENT_PROMPT', module: 'VoiceAccentAssessment', referenceId: row.id, newValue: { title, promptType } });
    return res.status(201).json({ ok: true, data: toPromptDto(row) });
  } catch (err) {
    console.error('[VoiceAccent] createPrompt failed:', err.message);
    return res.status(500).json({ ok: false, message: 'Could not create prompt.' });
  }
}

export async function updatePrompt(req, res) {
  try {
    const id = text(req.params?.id, 191);
    const existing = await prisma.voiceAccentPrompt.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ ok: false, message: 'Prompt not found.' });

    const data = {};
    if (req.body?.title !== undefined) data.title = text(req.body.title, 191);
    if (req.body?.promptText !== undefined) data.promptText = text(req.body.promptText, 8000);
    if (req.body?.promptType !== undefined) {
      const promptType = text(req.body.promptType, 30).toUpperCase();
      if (!VALID_PROMPT_TYPE.has(promptType)) return res.status(400).json({ ok: false, message: 'promptType must be SCRIPT_READING or SCENARIO_ROLEPLAY.' });
      data.promptType = promptType;
    }
    if (req.body?.category !== undefined) data.category = text(req.body.category, 120) || null;
    if (req.body?.level !== undefined) data.level = text(req.body.level, 60) || null;
    if (req.body?.active !== undefined) data.active = Boolean(req.body.active);
    if (data.title === '') return res.status(400).json({ ok: false, message: 'Title cannot be empty.' });
    if (data.promptText === '') return res.status(400).json({ ok: false, message: 'Prompt text cannot be empty.' });

    const row = await prisma.voiceAccentPrompt.update({ where: { id }, data });
    await audit({ userIdentity: req.userId, userRole: req.userType === 'admin' ? 'Admin' : 'Coordinator', action: 'UPDATE_VOICE_ACCENT_PROMPT', module: 'VoiceAccentAssessment', referenceId: id, newValue: data });
    return res.json({ ok: true, data: toPromptDto(row) });
  } catch (err) {
    console.error('[VoiceAccent] updatePrompt failed:', err.message);
    return res.status(500).json({ ok: false, message: 'Could not update prompt.' });
  }
}

// ── Trainee: active prompts to choose from ──────────────────────────────────
export async function listActivePrompts(req, res) {
  try {
    const rows = await prisma.voiceAccentPrompt.findMany({ where: { active: true }, orderBy: { createdAt: 'desc' }, take: 200 });
    return res.json({ ok: true, data: rows.map(toPromptDto) });
  } catch (err) {
    console.error('[VoiceAccent] listActivePrompts failed:', err.message);
    return res.status(500).json({ ok: false, message: 'Could not load voice & accent prompts.' });
  }
}

// ── Trainee: submit a recording ─────────────────────────────────────────────
export async function submitRecording(req, res) {
  try {
    if (!req.file) return res.status(400).json({ ok: false, message: 'A voice recording file is required.' });
    const promptId = text(req.body?.promptId, 191);
    if (!promptId) return res.status(400).json({ ok: false, message: 'promptId is required.' });

    const prompt = await prisma.voiceAccentPrompt.findFirst({ where: { id: promptId, active: true } });
    if (!prompt) return res.status(404).json({ ok: false, message: 'Active prompt not found.' });

    const trainee = await prisma.traineeMaster.findFirst({
      where: { employeeId: req.userId, status: 'Active' },
      select: { employeeId: true, traineeName: true, batchNo: true, branch: true, process: true },
    });
    if (!trainee) return res.status(404).json({ ok: false, message: 'Active trainee record not found.' });

    const durationSeconds = scoreOrNullInt(req.body?.durationSeconds);

    const row = await prisma.voiceAccentSubmission.create({
      data: {
        promptId,
        employeeId: trainee.employeeId,
        employeeName: trainee.traineeName,
        batchNo: trainee.batchNo,
        branch: trainee.branch,
        process: trainee.process,
        audioFilePath: path.join('voice', req.file.filename),
        originalFilename: text(req.file.originalname, 255) || null,
        mimeType: text(req.file.mimetype, 100) || null,
        fileSize: req.file.size || null,
        durationSeconds,
        status: 'SUBMITTED',
      },
    });
    await audit({ userIdentity: req.userId, userRole: 'Trainee', action: 'SUBMIT_VOICE_ACCENT_RECORDING', module: 'VoiceAccentAssessment', referenceId: row.id, newValue: { promptId } });
    return res.status(201).json({ ok: true, data: toSubmissionDto(row) });
  } catch (err) {
    console.error('[VoiceAccent] submitRecording failed:', err.message);
    return res.status(500).json({ ok: false, message: 'Could not submit recording.' });
  }
}

function scoreOrNullInt(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

// ── Trainee: my submission history ──────────────────────────────────────────
export async function getMySubmissions(req, res) {
  try {
    const rows = await prisma.voiceAccentSubmission.findMany({
      where: { employeeId: req.userId },
      orderBy: { submittedAt: 'desc' },
      take: 200,
    });
    const promptIds = [...new Set(rows.map(r => r.promptId))];
    const prompts = promptIds.length
      ? await prisma.voiceAccentPrompt.findMany({ where: { id: { in: promptIds } }, select: { id: true, title: true, promptType: true } })
      : [];
    const promptById = new Map(prompts.map(p => [p.id, p]));
    return res.json({
      ok: true,
      data: rows.map(row => ({ ...toSubmissionDto(row), prompt: promptById.get(row.promptId) || null })),
    });
  } catch (err) {
    console.error('[VoiceAccent] getMySubmissions failed:', err.message);
    return res.status(500).json({ ok: false, message: 'Could not load your submissions.' });
  }
}

// ── Admin/Coordinator: review queue ─────────────────────────────────────────
export async function listSubmissions(req, res) {
  try {
    const where = { ...(await scopeWhere(req)) };
    const q = req.query || {};
    if (q.batchNo) where.batchNo = q.batchNo;
    if (q.branch) where.branch = q.branch;
    if (q.process) where.process = q.process;
    if (q.employeeId) where.employeeId = q.employeeId;
    if (q.status && VALID_STATUS.has(String(q.status).toUpperCase())) where.status = String(q.status).toUpperCase();

    const take = Math.min(Math.max(parseInt(q.limit, 10) || 100, 1), 500);
    const rows = await prisma.voiceAccentSubmission.findMany({ where, orderBy: { submittedAt: 'desc' }, take });
    const promptIds = [...new Set(rows.map(r => r.promptId))];
    const prompts = promptIds.length
      ? await prisma.voiceAccentPrompt.findMany({ where: { id: { in: promptIds } }, select: { id: true, title: true, promptType: true } })
      : [];
    const promptById = new Map(prompts.map(p => [p.id, p]));
    return res.json({
      ok: true,
      data: rows.map(row => ({ ...toSubmissionDto(row), prompt: promptById.get(row.promptId) || null })),
    });
  } catch (err) {
    console.error('[VoiceAccent] listSubmissions failed:', err.message);
    return res.status(500).json({ ok: false, message: 'Could not load submissions.' });
  }
}

// ── Admin/Coordinator: score a submission ───────────────────────────────────
export async function scoreSubmission(req, res) {
  try {
    const id = text(req.params?.id, 191);
    const submission = await prisma.voiceAccentSubmission.findFirst({ where: { id, ...(await scopeWhere(req)) } });
    if (!submission) return res.status(404).json({ ok: false, message: 'Submission not found in your scope.' });

    const overallScore = scoreOrNull(req.body?.overallScore);
    const rubricScores = sanitizeRubricScores(req.body?.rubricScores);
    if (overallScore === null && !rubricScores) {
      return res.status(400).json({ ok: false, message: 'Provide an overallScore and/or rubricScores.' });
    }

    const row = await prisma.voiceAccentSubmission.update({
      where: { id },
      data: {
        status: 'SCORED',
        scoredBy: req.userId,
        scoredAt: new Date(),
        overallScore: overallScore === null ? submission.overallScore : overallScore,
        rubricScores: rubricScores || submission.rubricScores,
        feedbackNotes: text(req.body?.feedbackNotes, 5000) || null,
      },
    });
    await audit({ userIdentity: req.userId, userRole: req.userType === 'admin' ? 'Admin' : 'Coordinator', action: 'SCORE_VOICE_ACCENT_SUBMISSION', module: 'VoiceAccentAssessment', referenceId: id, newValue: { overallScore: row.overallScore } });
    return res.json({ ok: true, data: toSubmissionDto(row) });
  } catch (err) {
    console.error('[VoiceAccent] scoreSubmission failed:', err.message);
    return res.status(500).json({ ok: false, message: 'Could not score submission.' });
  }
}

// ── Protected audio streaming ───────────────────────────────────────────────
// Never a public URL: trainees may only stream their own recording; admin/
// coordinator must satisfy the same batch/branch review scope used for the
// review queue. Mirrors routes/contentFiles.js's private, no-store,
// path.basename-guarded serving pattern.
export async function streamAudio(req, res) {
  try {
    const id = text(req.params?.id, 191);
    const submission = await prisma.voiceAccentSubmission.findUnique({ where: { id } });
    if (!submission) return res.status(404).json({ ok: false, message: 'Recording not found.' });

    if (req.userType === 'trainee') {
      if (submission.employeeId !== req.userId) {
        return res.status(403).json({ ok: false, message: 'This recording does not belong to you.' });
      }
    } else if (['admin', 'coordinator'].includes(req.userType)) {
      const scope = await scopeWhere(req);
      if (scope.branch && submission.branch !== scope.branch) {
        return res.status(403).json({ ok: false, message: 'This recording is outside your branch scope.' });
      }
      if (scope.batchNo?.in && !scope.batchNo.in.includes(submission.batchNo)) {
        return res.status(403).json({ ok: false, message: 'This recording is outside your owned batches.' });
      }
    } else {
      return res.status(403).json({ ok: false, message: 'Access denied.' });
    }

    const filename = path.basename(submission.audioFilePath);
    const target = path.resolve(voiceRoot, filename);
    if (!target.startsWith(`${voiceRoot}${path.sep}`)) {
      return res.status(400).json({ ok: false, message: 'Invalid audio path.' });
    }
    const stat = await fs.promises.stat(target).catch(() => null);
    if (!stat?.isFile()) return res.status(404).json({ ok: false, message: 'Audio file not found.' });

    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `inline; filename="${filename.replaceAll('"', '')}"`);
    return res.sendFile(filename, { root: voiceRoot, dotfiles: 'deny', acceptRanges: true });
  } catch (err) {
    console.error('[VoiceAccent] streamAudio failed:', err.message);
    return res.status(500).json({ ok: false, message: 'Could not stream audio.' });
  }
}

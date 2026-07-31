import 'dotenv/config';
import { randomUUID } from 'crypto';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { prisma } from './utils/db.js';
import { sendDailySummaryEmail } from './utils/mailer.js';
import { cleanExpiredSessions, validateSessionSecurityConfig } from './utils/session.js';
import { startScheduler } from './utils/scheduler.js';
import { expireAllStaleVerifications } from './services/talentGovernance.js';
import { syncCertificationLifecycleForEmployee } from './services/developmentGovernance.js';
import { normalizeIltAttendanceRequest } from './middleware/iltAttendanceStability.js';
import { buildHttpSecurityPolicy } from './security/httpSecurity.js';

import browserAuthRoutes from './routes/browserAuth.js';
import passwordStabilityRoutes from './routes/passwordStability.js';
import certificationHooks from './routes/certificationHooks.js';
import authRoutes from './routes/auth.js';
import bridgeRoutes from './routes/bridge.js';
import coordinatorStabilityRoutes from './routes/coordinatorStability.js';
import coordinatorRoutes from './routes/coordinator.js';
import traineeStabilityRoutes from './routes/traineeStability.js';
import traineeRoutes from './routes/trainee.js';
import adminStabilityRoutes from './routes/adminStability.js';
import adminRoutes from './routes/admin.js';
import diagnosticsRoutes from './routes/diagnostics.js';
import managementRoutes from './routes/management.js';
import driveRoutes from './routes/drive.js';
import uploadRoutes from './routes/upload.js';
import contentFilesRoutes from './routes/contentFiles.js';
import reportRoutes from './routes/reports.js';
import empMappingRoutes from './routes/empMapping.js';
import complianceRoutes from './routes/compliance.js';
import scormRoutes from './routes/scorm.js';
import talentRoutes from './routes/talent.js';
import talentEvidenceRoutes from './routes/talentEvidence.js';
import developmentRoutes from './routes/development.js';
import iltRoutes from './routes/ilt.js';

validateSessionSecurityConfig(process.env);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number.parseInt(process.env.PORT || '4000', 10);
const isProduction = process.env.NODE_ENV === 'production';
const uploadsRoot = path.resolve(__dirname, '..', 'uploads');
const contentUploadDir = path.join(uploadsRoot, 'content');
const scormUploadDir = path.join(uploadsRoot, 'scorm');
const frontendDist = path.resolve(__dirname, '../../frontend/dist');

if (isProduction && !String(process.env.FRONTEND_URL || '').trim()) {
  throw new Error('FRONTEND_URL is required in production.');
}

app.disable('x-powered-by');
app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : false);
app.use((req, res, next) => {
  const requestId = String(req.headers['x-request-id'] || '').trim().slice(0, 100) || randomUUID();
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  next();
});

app.use(helmet(buildHttpSecurityPolicy(process.env)));

const allowedOrigins = String(process.env.FRONTEND_URL || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);
if (!isProduction) allowedOrigins.push('http://localhost:5173', 'http://localhost:3000');
const uniqueAllowedOrigins = [...new Set(allowedOrigins)];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || uniqueAllowedOrigins.includes(origin)) return callback(null, true);
    const error = new Error('Origin is not allowed.');
    error.status = 403;
    return callback(error);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Authorization',
    'Content-Type',
    'X-Request-Id',
    'X-HR-API-Key',
    'X-LMS-Role',
    'X-CSRF-Token',
  ],
  exposedHeaders: ['X-Request-Id', 'X-LMS-Session-Role', 'X-LMS-Session-Expires-At', 'X-LMS-Elevated-Until'],
}));

app.use(morgan(isProduction ? 'combined' : 'dev'));
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '2mb' }));
app.use(express.urlencoded({ extended: true, limit: process.env.FORM_BODY_LIMIT || '2mb' }));

if (!isProduction) {
  app.use('/uploads/content', express.static(contentUploadDir, {
    index: false,
    fallthrough: false,
    setHeaders(res) {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, max-age=3600');
    },
  }));
}

if (!isProduction && process.env.SCORM_ALLOW_SAME_ORIGIN === 'true') {
  app.use('/uploads/scorm', express.static(scormUploadDir, {
    index: false,
    fallthrough: false,
    setHeaders(res) {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
    },
  }));
}

app.get('/api/health/live', (_req, res) => {
  res.json({ ok: true, service: 'lms-platform', time: new Date().toISOString() });
});

async function readiness(_req, res) {
  const checks = { database: false, uploadStorage: false, frontend: true };
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = true;
  } catch {
    checks.database = false;
  }
  try {
    if (!fs.existsSync(contentUploadDir)) fs.mkdirSync(contentUploadDir, { recursive: true });
    fs.accessSync(contentUploadDir, fs.constants.W_OK);
    checks.uploadStorage = true;
  } catch {
    checks.uploadStorage = false;
  }
  if (process.env.SERVE_FRONTEND !== 'false') checks.frontend = fs.existsSync(frontendDist);
  const ok = Object.values(checks).every(Boolean);
  return res.status(ok ? 200 : 503).json({ ok, service: 'lms-platform', checks, time: new Date().toISOString() });
}

app.get('/api/health/ready', readiness);
app.get('/api/health', readiness);

// Secure cookie/CSRF routes are mounted first and own every authentication
// state change. Legacy route modules remain for non-overlapping recovery and
// profile endpoints plus an explicitly controlled compatibility window.
app.use('/api', browserAuthRoutes);
app.use('/api', passwordStabilityRoutes);
app.use('/api', certificationHooks);
app.use('/api/auth', authRoutes);
app.use('/api/auth/bridge', bridgeRoutes);
app.use('/api/coordinator', coordinatorStabilityRoutes);
app.use('/api/trainee', traineeStabilityRoutes);
app.use('/api/admin/diagnostics', diagnosticsRoutes);
app.use('/api/admin', adminStabilityRoutes);
app.use('/api/coordinator', coordinatorRoutes);
app.use('/api/trainee', traineeRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/admin/compliance', complianceRoutes);
app.use('/api/management', managementRoutes);
app.use('/api/drive', driveRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/content', contentFilesRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/emp-mapping', empMappingRoutes);
app.use('/api/scorm', scormRoutes);
app.use('/api/talent', talentEvidenceRoutes);
app.use('/api/talent', talentRoutes);
app.use('/api/development', developmentRoutes);
app.use('/api/ilt', normalizeIltAttendanceRequest);
app.use('/api/ilt', iltRoutes);

if (process.env.SERVE_FRONTEND !== 'false' && fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist, { index: false }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    return res.sendFile(path.join(frontendDist, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => res.status(200).send('LMS API is running.'));
}

app.use((err, req, res, _next) => {
  console.error(`[${req.requestId || 'no-request-id'}]`, err);
  const status = Number(err.status || 500);
  return res.status(status).json({
    ok: false,
    requestId: req.requestId,
    message: status >= 400 && status < 500 ? (err.message || 'Bad request') : 'Internal server error',
  });
});

async function runKpiSnapshot() {
  try {
    const period = new Date().toISOString().slice(0, 7);
    const [totalTrainees, activeBatches, averages, certifiedCount] = await Promise.all([
      prisma.traineeMaster.count({ where: { status: 'Active' } }),
      prisma.batchMaster.count({ where: { batchStatus: 'Active' } }),
      prisma.traineeMaster.aggregate({
        where: { status: 'Active' },
        _avg: { courseCompletionPct: true, assessmentPassPct: true, attendancePct: true },
      }),
      prisma.traineeMaster.count({ where: { status: 'Active', certificationStatus: 'Certified' } }),
    ]);
    await prisma.historicalTrainingKpi.upsert({
      where: { period_branch_process_lob: { period, branch: '', process: '', lob: '' } },
      create: {
        period, branch: '', process: '', lob: '', totalTrainees, activeBatches,
        avgCoursePct: Math.round(averages._avg.courseCompletionPct || 0),
        avgMcqPct: Math.round(averages._avg.assessmentPassPct || 0),
        avgAttendancePct: Math.round(averages._avg.attendancePct || 0), certifiedCount,
      },
      update: {
        totalTrainees, activeBatches,
        avgCoursePct: Math.round(averages._avg.courseCompletionPct || 0),
        avgMcqPct: Math.round(averages._avg.assessmentPassPct || 0),
        avgAttendancePct: Math.round(averages._avg.attendancePct || 0), certifiedCount,
      },
    });
    console.log(`[KPI] Snapshot saved for ${period}`);
  } catch (error) {
    console.error('[KPI] Snapshot error:', error.message);
  }
}

async function runTalentGovernanceCleanup() {
  try {
    const result = await expireAllStaleVerifications();
    if (Number(result.expiredEvidence || 0) || Number(result.expiredProfiles || 0)) {
      console.log(`[Talent] Expired ${result.expiredEvidence} evidence rows and ${result.expiredProfiles} verified profiles.`);
    }
  } catch (error) {
    console.warn('[Talent] Verification expiry cleanup skipped:', error.message);
  }
}

async function runCertificationLifecycleSync() {
  try {
    const employees = await prisma.traineeMaster.findMany({
      where: { status: 'Active', certificationStatus: { in: ['Certified', 'Expired', 'Revoked'] } },
      select: { employeeId: true },
      take: 5000,
    });
    let failures = 0;
    for (const employee of employees) {
      try {
        await syncCertificationLifecycleForEmployee(employee.employeeId, 'certification-worker');
      } catch (error) {
        failures += 1;
        console.warn(`[Certification] ${employee.employeeId} sync failed:`, error.message);
      }
    }
    console.log(`[Certification] Synchronized ${employees.length - failures}/${employees.length} learners.`);
  } catch (error) {
    console.warn('[Certification] Lifecycle sync skipped:', error.message);
  }
}

function scheduleDailyEmail() {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 1, 30, 0));
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  const timeout = setTimeout(async () => {
    const recipients = String(process.env.DAILY_SUMMARY_EMAILS || '').split(',').map(email => email.trim()).filter(Boolean);
    if (recipients.length) {
      try {
        await sendDailySummaryEmail(recipients);
      } catch (error) {
        console.error('[MAILER] Daily summary failed:', error.message);
      }
    }
    scheduleDailyEmail();
  }, next.getTime() - now.getTime());
  timeout.unref?.();
}

function startBackgroundWork() {
  if (process.env.LMS_RUN_SCHEDULERS !== 'true') {
    console.log('[WORKER] In-process schedules are disabled. Run one designated worker with LMS_RUN_SCHEDULERS=true.');
    return;
  }
  runKpiSnapshot();
  const kpiTimer = setInterval(runKpiSnapshot, 24 * 60 * 60 * 1000);
  kpiTimer.unref?.();
  scheduleDailyEmail();
  startScheduler();
  const sessionTimer = setInterval(() => {
    cleanExpiredSessions().catch(error => console.error('[Sessions] Cleanup failed:', error.message));
  }, 60 * 60 * 1000);
  sessionTimer.unref?.();
  const talentTimer = setInterval(runTalentGovernanceCleanup, 60 * 60 * 1000);
  talentTimer.unref?.();
  runCertificationLifecycleSync();
  const certificationTimer = setInterval(runCertificationLifecycleSync, 6 * 60 * 60 * 1000);
  certificationTimer.unref?.();
  async function cleanVideoWatchLogs() {
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    try {
      const deleted = await prisma.videoWatchLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
      if (deleted.count) console.log(`[Cleanup] Deleted ${deleted.count} expired video-watch rows.`);
    } catch (error) {
      console.error('[Cleanup] Video watch log error:', error.message);
    }
  }
  cleanVideoWatchLogs();
  const logTimer = setInterval(cleanVideoWatchLogs, 6 * 60 * 60 * 1000);
  logTimer.unref?.();
}

const server = app.listen(PORT, () => {
  console.log(`LMS running on port ${PORT}`);
  runTalentGovernanceCleanup();
  startBackgroundWork();
});

async function shutdown(signal) {
  console.log(`[Shutdown] ${signal} received.`);
  server.close(async () => {
    await prisma.$disconnect().catch(() => {});
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export default app;

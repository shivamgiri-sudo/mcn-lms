import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { prisma } from './utils/db.js';
import { sendDailySummaryEmail } from './utils/mailer.js';
import { cleanExpiredSessions } from './utils/session.js';
import { startScheduler } from './utils/scheduler.js';

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
import reportRoutes from './routes/reports.js';
import empMappingRoutes from './routes/empMapping.js';
import complianceRoutes from './routes/compliance.js';
import scormRoutes from './routes/scorm.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 4000;

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: false,
    frameguard: false, // allow iframe embedding from HRMS portal
  })
);

// CORS — lock to explicit origins, never open to all
const allowedOrigins = process.env.FRONTEND_URL
  ? process.env.FRONTEND_URL.split(',').map(o => o.trim())
  : ['http://localhost:5173', 'http://localhost:3000'];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
  })
);

app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));
// SCORM packages served as static files — needs directory listing disabled
app.use('/uploads/scorm', express.static(path.join(__dirname, '..', 'uploads', 'scorm'), { index: false }));

app.use('/api/auth', authRoutes);
app.use('/api/auth/bridge', bridgeRoutes);

// Production-stabilization overrides must be mounted before the legacy route files.
// These handlers fix specific deployed issues while preserving the existing controllers.
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
app.use('/api/reports', reportRoutes);
app.use('/api/emp-mapping', empMappingRoutes);
app.use('/api/scorm', scormRoutes);

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'lms-platform',
    mode: process.env.LMS_DEMO_MODE === 'true' ? 'demo' : 'database',
    time: new Date().toISOString(),
  });
});

const frontendDist = path.resolve(__dirname, '../../frontend/dist');

if (process.env.SERVE_FRONTEND !== 'false' && fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));

  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    return res.sendFile(path.join(frontendDist, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => {
    res.status(200).send(
      'LMS API is running. Frontend build not found. Run: cd ../frontend && npm run build'
    );
  });
}

// Global error handler — only expose message for 4xx client errors
app.use((err, _req, res, _next) => {
  console.error(err);
  const status = err.status || 500;
  res.status(status).json({
    ok: false,
    message: status >= 400 && status < 500 ? (err.message || 'Bad request') : 'Internal server error',
  });
});

// FIX 6: Historical KPI snapshot — runs on startup and every 24 hours
async function runKpiSnapshot() {
  try {
    const period = new Date().toISOString().slice(0, 7);
    const [trainees, batches] = await Promise.all([
      prisma.traineeMaster.findMany({ where: { status: 'Active' } }),
      prisma.batchMaster.findMany({ where: { batchStatus: 'Active' } }),
    ]);
    const totalTrainees = trainees.length;
    const avgCourse = totalTrainees > 0 ? Math.round(trainees.reduce((s, t) => s + (t.courseCompletionPct || 0), 0) / totalTrainees) : 0;
    const avgMcq = totalTrainees > 0 ? Math.round(trainees.reduce((s, t) => s + (t.assessmentPassPct || 0), 0) / totalTrainees) : 0;
    const avgAttendance = totalTrainees > 0 ? Math.round(trainees.reduce((s, t) => s + (t.attendancePct || 0), 0) / totalTrainees) : 0;
    const certified = trainees.filter(t => t.certificationStatus === 'Certified').length;

    await prisma.historicalTrainingKpi.upsert({
      where: { period_branch_process_lob: { period, branch: '', process: '', lob: '' } },
      create: { period, branch: '', process: '', lob: '', totalTrainees, activeBatches: batches.length, avgCoursePct: avgCourse, avgMcqPct: avgMcq, avgAttendancePct: avgAttendance, certifiedCount: certified },
      update: { totalTrainees, activeBatches: batches.length, avgCoursePct: avgCourse, avgMcqPct: avgMcq, avgAttendancePct: avgAttendance, certifiedCount: certified },
    });
    console.log(`[KPI] Snapshot saved for ${period}`);
  } catch (err) {
    console.error('[KPI] Snapshot error:', err.message);
  }
}

// Daily summary email — fires at 07:00 IST (01:30 UTC) every day.
// Set DAILY_SUMMARY_EMAILS as a comma-separated list in env vars.
function scheduleDailyEmail() {
  const now = new Date();
  // Target: 01:30 UTC = 07:00 IST
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 1, 30, 0));
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  const delay = next - now;

  setTimeout(async () => {
    const emailEnv = process.env.DAILY_SUMMARY_EMAILS || '';
    const recipients = emailEnv.split(',').map(e => e.trim()).filter(Boolean);
    if (recipients.length > 0) {
      try {
        await sendDailySummaryEmail(recipients);
      } catch (err) {
        console.error('[MAILER] Daily summary failed:', err.message);
      }
    }
    scheduleDailyEmail(); // reschedule for next day
  }, delay);

  const hh = String(next.getUTCHours()).padStart(2, '0');
  const mm = String(next.getUTCMinutes()).padStart(2, '0');
  console.log(`[MAILER] Daily summary scheduled for ${next.toDateString()} ${hh}:${mm} UTC`);
}

app.listen(PORT, () => {
  console.log(`LMS running on http://localhost:${PORT}`);
  console.log(`Frontend path checked: ${frontendDist}`);
  runKpiSnapshot();
  setInterval(runKpiSnapshot, 24 * 60 * 60 * 1000);
  scheduleDailyEmail();
  startScheduler();
  // Clean expired portal sessions every hour to prevent DB bloat
  setInterval(() => {
    cleanExpiredSessions().catch(err => console.error('[Sessions] Cleanup failed:', err.message));
  }, 60 * 60 * 1000);

  // Video watch log TTL cleanup — remove rows older than 90 days, runs every 6 hours
  async function cleanVideoWatchLogs() {
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    try {
      const del = await prisma.videoWatchLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
      if (del.count > 0) console.log(`[Cleanup] Deleted ${del.count} video watch log rows older than 90 days`);
    } catch (e) {
      console.error('[Cleanup] Video watch log error:', e.message);
    }
  }
  cleanVideoWatchLogs();
  setInterval(cleanVideoWatchLogs, 6 * 60 * 60 * 1000);
});

export default app;

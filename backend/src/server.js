import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { prisma } from './utils/db.js';

import authRoutes from './routes/auth.js';
import coordinatorRoutes from './routes/coordinator.js';
import traineeRoutes from './routes/trainee.js';
import adminRoutes from './routes/admin.js';
import managementRoutes from './routes/management.js';
import driveRoutes from './routes/drive.js';
import uploadRoutes from './routes/upload.js';
import reportRoutes from './routes/reports.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 4000;

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: false,
    frameguard: false,
  })
);

app.use(
  cors({
    origin: process.env.FRONTEND_URL || true,
    credentials: true,
  })
);

app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

app.use('/api/auth', authRoutes);
app.use('/api/coordinator', coordinatorRoutes);
app.use('/api/trainee', traineeRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/management', managementRoutes);
app.use('/api/drive', driveRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/reports', reportRoutes);

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

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({
    ok: false,
    message: err.message || 'Internal server error',
  });
});

// FIX 6: Historical KPI snapshot — runs on startup and every 24 hours
async function runKpiSnapshot() {
  try {
    const period = new Date().toISOString().slice(0, 7);
    const [trainees, batches] = await Promise.all([
      prisma.traineeMaster.findMany({ where: { status: "Active" } }),
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

app.listen(PORT, () => {
  console.log(`LMS running on http://localhost:${PORT}`);
  console.log(`Frontend path checked: ${frontendDist}`);
  // Run KPI snapshot on startup, then every 24 hours
  runKpiSnapshot();
  setInterval(runKpiSnapshot, 24 * 60 * 60 * 1000);
});

export default app;

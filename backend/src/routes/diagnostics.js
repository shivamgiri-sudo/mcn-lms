import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { prisma } from '../utils/db.js';
import { requireSession, requireRole } from '../middleware/auth.js';

const router = Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function present(value) {
  return Boolean(String(value || '').trim());
}

async function safeCount(modelName) {
  try {
    return { ok: true, count: await prisma[modelName].count() };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

router.get('/', requireSession, requireRole('admin'), async (_req, res) => {
  const startedAt = Date.now();
  const checks = {
    service: 'lms-platform',
    checkedAt: new Date().toISOString(),
    database: { ok: false },
    environment: {
      nodeEnv: process.env.NODE_ENV || 'development',
      port: process.env.PORT || '4000',
      frontendUrlConfigured: present(process.env.FRONTEND_URL),
      apiUrlConfigured: present(process.env.API_URL),
      databaseUrlConfigured: present(process.env.DATABASE_URL),
      sessionSecretConfigured: present(process.env.SESSION_SECRET),
      driveServiceAccountConfigured: present(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
      driveOAuthConfigured: present(process.env.GOOGLE_CLIENT_ID) && present(process.env.GOOGLE_CLIENT_SECRET),
      smtpConfigured: present(process.env.SMTP_HOST) || present(process.env.DAILY_SUMMARY_EMAILS),
      serveFrontend: process.env.SERVE_FRONTEND !== 'false',
    },
    storage: {
      uploadsPath: path.resolve(__dirname, '../../uploads'),
      uploadsExists: false,
      uploadsWritable: false,
      frontendDistPath: path.resolve(__dirname, '../../../frontend/dist'),
      frontendDistExists: false,
    },
    tables: {},
  };

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = { ok: true };
  } catch (err) {
    checks.database = { ok: false, message: err.message };
  }

  try {
    checks.storage.uploadsExists = fs.existsSync(checks.storage.uploadsPath);
    if (!checks.storage.uploadsExists) fs.mkdirSync(checks.storage.uploadsPath, { recursive: true });
    fs.accessSync(checks.storage.uploadsPath, fs.constants.W_OK);
    checks.storage.uploadsWritable = true;
  } catch (err) {
    checks.storage.uploadsWritable = false;
    checks.storage.uploadsMessage = err.message;
  }

  checks.storage.frontendDistExists = fs.existsSync(checks.storage.frontendDistPath);

  const tableModels = [
    'traineeMaster',
    'userMaster',
    'batchMaster',
    'classroomMaster',
    'moduleMaster',
    'contentMaster',
    'assessmentMaster',
    'questionBank',
    'contentProgress',
    'assessmentResult',
    'traineeQueryLog',
    'trainingRiskLog',
    'pendingActivityLog',
  ];

  for (const model of tableModels) {
    checks.tables[model] = await safeCount(model);
  }

  const failedTables = Object.values(checks.tables).filter(t => !t.ok).length;
  checks.ok = checks.database.ok && checks.storage.uploadsWritable && failedTables === 0;
  checks.durationMs = Date.now() - startedAt;

  res.status(checks.ok ? 200 : 500).json({ ok: checks.ok, data: checks });
});

export default router;

import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { prisma } from '../utils/db.js';
import { requireSession, requireRole, requireSuperAdmin } from '../middleware/auth.js';

const router = Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function present(value) {
  return Boolean(String(value || '').trim());
}

async function safeCount(modelName) {
  try {
    return { ok: true, count: await prisma[modelName].count() };
  } catch {
    return { ok: false, message: 'Table validation failed.' };
  }
}

router.get('/', requireSession, requireRole('admin'), requireSuperAdmin, async (_req, res) => {
  const startedAt = Date.now();
  const uploadsPath = path.resolve(__dirname, '../../uploads');
  const frontendDistPath = path.resolve(__dirname, '../../../frontend/dist');
  const checks = {
    service: 'lms-platform',
    checkedAt: new Date().toISOString(),
    database: { ok: false },
    environment: {
      nodeEnv: process.env.NODE_ENV || 'development',
      frontendUrlConfigured: present(process.env.FRONTEND_URL),
      apiUrlConfigured: present(process.env.API_URL),
      databaseUrlConfigured: present(process.env.DATABASE_URL),
      sessionSecretConfigured: present(process.env.SESSION_SECRET),
      bridgeSecretConfigured: present(process.env.BRIDGE_SECRET),
      hrmsConfigured: ['HRMS_DB_HOST', 'HRMS_DB_USER', 'HRMS_DB_PASS', 'HRMS_DB_NAME'].every(name => present(process.env[name])),
      driveServiceAccountConfigured: present(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
      driveOAuthConfigured: present(process.env.GOOGLE_CLIENT_ID) && present(process.env.GOOGLE_CLIENT_SECRET),
      smtpConfigured: present(process.env.SMTP_HOST) && present(process.env.SMTP_USER),
      serveFrontend: process.env.SERVE_FRONTEND !== 'false',
    },
    storage: {
      uploadsExists: false,
      uploadsWritable: false,
      frontendDistExists: false,
    },
    tables: {},
  };

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = { ok: true };
  } catch {
    checks.database = { ok: false, message: 'Database connectivity failed.' };
  }

  try {
    checks.storage.uploadsExists = fs.existsSync(uploadsPath);
    if (!checks.storage.uploadsExists) fs.mkdirSync(uploadsPath, { recursive: true });
    fs.accessSync(uploadsPath, fs.constants.W_OK);
    checks.storage.uploadsWritable = true;
  } catch {
    checks.storage.uploadsWritable = false;
    checks.storage.uploadsMessage = 'Upload storage is not writable.';
  }

  checks.storage.frontendDistExists = fs.existsSync(frontendDistPath);

  const tableModels = [
    'traineeMaster', 'userMaster', 'batchMaster', 'classroomMaster', 'moduleMaster',
    'contentMaster', 'assessmentMaster', 'questionBank', 'contentProgress',
    'assessmentResult', 'traineeQueryLog', 'trainingRiskLog', 'pendingActivityLog',
  ];

  for (const model of tableModels) checks.tables[model] = await safeCount(model);

  const failedTables = Object.values(checks.tables).filter(table => !table.ok).length;
  checks.ok = checks.database.ok && checks.storage.uploadsWritable && failedTables === 0;
  checks.durationMs = Date.now() - startedAt;

  return res.status(checks.ok ? 200 : 503).json({ ok: checks.ok, data: checks });
});

export default router;

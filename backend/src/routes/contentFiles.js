import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import rateLimit from 'express-rate-limit';
import { prisma } from '../utils/db.js';
import { requireSession } from '../middleware/auth.js';

const router = Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const contentRoot = path.resolve(__dirname, '..', '..', 'uploads', 'content');
const contentFileLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: { ok: false, message: 'Too many content file requests. Try again shortly.' },
  standardHeaders: true,
  legacyHeaders: false,
});

function safeFilename(value) {
  const decoded = decodeURIComponent(String(value || ''));
  if (!decoded || decoded !== path.basename(decoded) || decoded.includes('\0')) return '';
  if (!/^[A-Za-z0-9._-]{1,255}$/.test(decoded)) return '';
  return decoded;
}

async function traineeCanAccess(employeeId, filename) {
  const contents = await prisma.contentMaster.findMany({
    where: {
      active: true,
      directMediaUrl: { endsWith: `/${filename}` },
      module: { active: true },
    },
    select: {
      module: { select: { classroomId: true } },
    },
    take: 100,
  });

  const classroomIds = [...new Set(contents.map(row => row.module?.classroomId).filter(Boolean))];
  if (!classroomIds.length) return false;

  const trainee = await prisma.traineeMaster.findUnique({
    where: { employeeId },
    select: { classroomId: true },
  });
  if (trainee?.classroomId && classroomIds.includes(trainee.classroomId)) return true;

  const mapping = await prisma.traineeClassroomMap.findFirst({
    where: { employeeId, classroomId: { in: classroomIds }, active: true },
    select: { id: true },
  });
  return Boolean(mapping);
}

router.get('/files/:filename', contentFileLimiter, requireSession, async (req, res, next) => {
  try {
    const filename = safeFilename(req.params.filename);
    if (!filename) return res.status(400).json({ ok: false, message: 'Invalid content filename.' });

    const target = path.resolve(contentRoot, filename);
    if (!target.startsWith(`${contentRoot}${path.sep}`)) {
      return res.status(400).json({ ok: false, message: 'Invalid content path.' });
    }

    const stat = await fs.promises.stat(target).catch(() => null);
    if (!stat?.isFile()) return res.status(404).json({ ok: false, message: 'Content file not found.' });

    if (req.userType === 'trainee' && !await traineeCanAccess(req.userId, filename)) {
      return res.status(403).json({ ok: false, message: 'This file is not assigned to your classroom.' });
    }
    if (!['trainee', 'coordinator', 'admin'].includes(req.userType)) {
      return res.status(403).json({ ok: false, message: 'Learning-content access denied.' });
    }

    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `inline; filename="${filename.replaceAll('"', '')}"`);
    return res.sendFile(filename, { root: contentRoot, dotfiles: 'deny', acceptRanges: true });
  } catch (error) {
    return next(error);
  }
});

export default router;

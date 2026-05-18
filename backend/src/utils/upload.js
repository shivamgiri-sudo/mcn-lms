import multer from 'multer';
import path from 'path';
import { existsSync, mkdirSync } from 'fs';

const UPLOAD_DIR = process.env.UPLOAD_DIR || 'uploads';
const MAX_MB = parseInt(process.env.MAX_FILE_SIZE_MB || '200', 10);

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

const storage = multer.diskStorage({
  destination(_req, _file, cb) {
    const dir = path.join(UPLOAD_DIR, 'content');
    ensureDir(dir);
    cb(null, dir);
  },
  filename(_req, file, cb) {
    const ext = path.extname(file.originalname);
    const name = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
    cb(null, name);
  },
});

export const contentUpload = multer({
  storage,
  limits: { fileSize: MAX_MB * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    const allowed = [
      'video/mp4', 'video/webm', 'video/ogg',
      'application/pdf',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'image/jpeg', 'image/png', 'image/gif',
    ];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('File type not allowed'));
  },
});

export const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    const ok = file.mimetype === 'text/csv' || file.originalname.endsWith('.csv');
    cb(ok ? null : new Error('CSV files only'), ok);
  },
});

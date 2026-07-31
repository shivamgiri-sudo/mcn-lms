import multer from 'multer';
import path from 'path';
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync } from 'fs';

const UPLOAD_DIR = process.env.UPLOAD_DIR || 'uploads';
const MAX_MB = Number.parseInt(process.env.MAX_FILE_SIZE_MB || '200', 10);

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
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${randomUUID()}${ext}`);
  },
});

const MIME_BY_EXTENSION = new Map([
  ['.mp4', new Set(['video/mp4'])],
  ['.webm', new Set(['video/webm'])],
  ['.ogg', new Set(['video/ogg'])],
  ['.pdf', new Set(['application/pdf'])],
  ['.ppt', new Set(['application/vnd.ms-powerpoint'])],
  ['.pptx', new Set(['application/vnd.openxmlformats-officedocument.presentationml.presentation'])],
  ['.doc', new Set(['application/msword'])],
  ['.docx', new Set(['application/vnd.openxmlformats-officedocument.wordprocessingml.document'])],
  ['.xls', new Set(['application/vnd.ms-excel'])],
  ['.xlsx', new Set(['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])],
  ['.jpg', new Set(['image/jpeg'])],
  ['.jpeg', new Set(['image/jpeg'])],
  ['.png', new Set(['image/png'])],
  ['.gif', new Set(['image/gif'])],
]);

function hasMatchingType(file) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  const allowedMimes = MIME_BY_EXTENSION.get(ext);
  return Boolean(allowedMimes?.has(String(file.mimetype || '').toLowerCase()));
}

export const contentUpload = multer({
  storage,
  limits: { fileSize: MAX_MB * 1024 * 1024, files: 1 },
  fileFilter(_req, file, cb) {
    if (hasMatchingType(file)) return cb(null, true);
    const ext = path.extname(file.originalname || '').toLowerCase();
    return cb(new Error(`File type does not match the allowed format: ${file.mimetype} (${ext || 'no extension'})`));
  },
});

export const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter(_req, file, cb) {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const ok = ext === '.csv' && ['text/csv', 'application/csv', 'text/plain'].includes(String(file.mimetype || '').toLowerCase());
    cb(ok ? null : new Error('A valid CSV file is required.'), ok);
  },
});

// SCORM ZIP is saved to a temporary directory. Archive extraction must still
// enforce path, entry-count and uncompressed-size limits in the controller.
const scormStorage = multer.diskStorage({
  destination(_req, _file, cb) {
    const dir = path.join(UPLOAD_DIR, 'scorm-tmp');
    ensureDir(dir);
    cb(null, dir);
  },
  filename(_req, _file, cb) {
    cb(null, `${Date.now()}-${randomUUID()}.zip`);
  },
});

const SCORM_MAX_MB = Number.parseInt(process.env.SCORM_MAX_FILE_SIZE_MB || '500', 10);

export const scormUpload = multer({
  storage: scormStorage,
  limits: { fileSize: SCORM_MAX_MB * 1024 * 1024, files: 1 },
  fileFilter(_req, file, cb) {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const mime = String(file.mimetype || '').toLowerCase();
    const ok = ext === '.zip' && ['application/zip', 'application/x-zip-compressed'].includes(mime);
    cb(ok ? null : new Error('A valid ZIP file is required for a SCORM package.'), ok);
  },
});

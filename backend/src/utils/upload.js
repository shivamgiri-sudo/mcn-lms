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

// Voice & Accent Assessment recordings — short trainee-identifiable voice
// clips, never publicly served (see routes/voiceAccent.js). Deliberately a
// much smaller cap than contentUpload's 200MB — a few minutes of compressed
// audio never needs it, and a low cap limits abuse of the upload endpoint.
const voiceStorage = multer.diskStorage({
  destination(_req, _file, cb) {
    const dir = path.join(UPLOAD_DIR, 'voice');
    ensureDir(dir);
    cb(null, dir);
  },
  filename(_req, file, cb) {
    const ext = path.extname(file.originalname || '').toLowerCase();
    cb(null, `${Date.now()}-${randomUUID()}${ext}`);
  },
});

const VOICE_MIME_BY_EXTENSION = new Map([
  ['.webm', new Set(['audio/webm', 'video/webm'])],
  ['.mp3', new Set(['audio/mpeg', 'audio/mp3'])],
  ['.wav', new Set(['audio/wav', 'audio/x-wav', 'audio/wave'])],
  ['.m4a', new Set(['audio/mp4', 'audio/x-m4a', 'audio/m4a'])],
  ['.ogg', new Set(['audio/ogg'])],
]);

const VOICE_MAX_MB = Number.parseInt(process.env.VOICE_MAX_FILE_SIZE_MB || '15', 10);

export const voiceUpload = multer({
  storage: voiceStorage,
  limits: { fileSize: VOICE_MAX_MB * 1024 * 1024, files: 1 },
  fileFilter(_req, file, cb) {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const allowedMimes = VOICE_MIME_BY_EXTENSION.get(ext);
    const ok = Boolean(allowedMimes?.has(String(file.mimetype || '').toLowerCase()));
    cb(ok ? null : new Error(`Voice recording must be webm, mp3, wav, m4a or ogg: got ${file.mimetype} (${ext || 'no extension'})`), ok);
  },
});

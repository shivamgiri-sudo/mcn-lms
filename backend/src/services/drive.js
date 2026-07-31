import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

const TOKEN_FILE = path.resolve(process.env.DRIVE_TOKEN_FILE || 'drive-token.enc');
const LEGACY_TOKEN_FILE = path.resolve('drive-token.json');
const MAX_DRIVE_FILES = Math.max(1, Number.parseInt(process.env.DRIVE_MAX_FILES || '5000', 10));
const MAX_RECURSION_DEPTH = Math.max(1, Number.parseInt(process.env.DRIVE_MAX_RECURSION_DEPTH || '10', 10));

const MIME_TO_TYPE = {
  'video/mp4': 'video',
  'video/webm': 'video',
  'video/quicktime': 'video',
  'application/pdf': 'pdf',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'ppt',
  'application/vnd.google-apps.presentation': 'ppt',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'doc',
  'application/vnd.google-apps.document': 'doc',
  'application/vnd.google-apps.spreadsheet': 'doc',
};

function tokenKey() {
  const secret = String(process.env.GOOGLE_TOKEN_ENCRYPTION_KEY || process.env.SESSION_SECRET || '');
  if (secret.length < 32) return null;
  return createHash('sha256').update(secret, 'utf8').digest();
}

function encryptTokens(tokens) {
  const key = tokenKey();
  if (!key) throw new Error('GOOGLE_TOKEN_ENCRYPTION_KEY or SESSION_SECRET of at least 32 characters is required for OAuth token storage.');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(tokens), 'utf8'), cipher.final()]);
  return JSON.stringify({
    version: 1,
    algorithm: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  });
}

function decryptTokens(payload) {
  const key = tokenKey();
  if (!key) throw new Error('OAuth token encryption key is not configured.');
  const envelope = JSON.parse(payload);
  if (envelope.version !== 1 || envelope.algorithm !== 'aes-256-gcm') throw new Error('Unsupported OAuth token file format.');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]);
  return JSON.parse(plaintext.toString('utf8'));
}

export function loadSavedTokens() {
  if (fs.existsSync(TOKEN_FILE)) return decryptTokens(fs.readFileSync(TOKEN_FILE, 'utf8'));

  // One-time migration from the historical plaintext token file.
  if (fs.existsSync(LEGACY_TOKEN_FILE)) {
    const legacy = JSON.parse(fs.readFileSync(LEGACY_TOKEN_FILE, 'utf8'));
    saveTokens(legacy);
    fs.rmSync(LEGACY_TOKEN_FILE, { force: true });
    return legacy;
  }
  return null;
}

export function saveTokens(tokens) {
  const dir = path.dirname(TOKEN_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const temp = `${TOKEN_FILE}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, encryptTokens(tokens), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temp, TOKEN_FILE);
  try { fs.chmodSync(TOKEN_FILE, 0o600); } catch {}
}

export function deleteSavedTokens() {
  fs.rmSync(TOKEN_FILE, { force: true });
  fs.rmSync(LEGACY_TOKEN_FILE, { force: true });
}

function makeOAuth2Client() {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET || !process.env.GOOGLE_REDIRECT_URI) {
    throw new Error('Google OAuth client configuration is incomplete.');
  }
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI,
  );
}

export function getOAuthClient() {
  const client = makeOAuth2Client();
  const saved = loadSavedTokens();
  if (saved) {
    client.setCredentials(saved);
    client.on('tokens', tokens => {
      const merged = { ...saved, ...tokens };
      saveTokens(merged);
      client.setCredentials(merged);
    });
  }
  return client;
}

export async function getDriveService() {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/drive.readonly'] });
    return google.drive({ version: 'v3', auth });
  }

  const saved = loadSavedTokens();
  if (saved) return google.drive({ version: 'v3', auth: getOAuthClient() });
  if (process.env.GOOGLE_API_KEY) return google.drive({ version: 'v3', auth: process.env.GOOGLE_API_KEY });
  throw new Error('No Google Drive credentials are configured.');
}

export function hasDriveAccess() {
  try {
    return Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || loadSavedTokens() || process.env.GOOGLE_API_KEY);
  } catch {
    return false;
  }
}

function validDriveId(value) {
  const id = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(id)) throw new Error('Invalid Google Drive identifier.');
  return id;
}

export async function listDriveFolder(drive, folderId, recursive = false, depth = 0, accumulator = []) {
  const safeFolderId = validDriveId(folderId);
  if (depth > MAX_RECURSION_DEPTH) throw new Error('Google Drive folder nesting exceeds the configured limit.');
  let pageToken;

  do {
    const response = await drive.files.list({
      q: `'${safeFolderId}' in parents and trashed = false`,
      fields: 'nextPageToken, files(id, name, mimeType, size, thumbnailLink, webViewLink, parents)',
      pageSize: 200,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    for (const file of response.data.files || []) {
      if (file.mimeType === 'application/vnd.google-apps.folder') {
        if (recursive) await listDriveFolder(drive, file.id, true, depth + 1, accumulator);
      } else {
        accumulator.push({
          ...file,
          contentType: MIME_TO_TYPE[file.mimeType] || 'link',
          driveUrl: `https://drive.google.com/file/d/${file.id}/preview`,
          viewUrl: file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`,
        });
        if (accumulator.length >= MAX_DRIVE_FILES) throw new Error(`Google Drive listing exceeds the ${MAX_DRIVE_FILES}-file limit.`);
      }
    }
    pageToken = response.data.nextPageToken;
  } while (pageToken);

  return accumulator;
}

export async function listDriveFolderAny(folderId, recursive = false) {
  const errors = [];

  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    try {
      const drive = await getDriveService();
      return { files: await listDriveFolder(drive, folderId, recursive), method: 'service_account' };
    } catch (error) {
      errors.push(`Service account: ${error.message}`);
    }
  }

  try {
    const saved = loadSavedTokens();
    if (saved) {
      const drive = google.drive({ version: 'v3', auth: getOAuthClient() });
      return { files: await listDriveFolder(drive, folderId, recursive), method: 'oauth' };
    }
  } catch (error) {
    errors.push(`OAuth: ${error.message}`);
  }

  if (process.env.GOOGLE_API_KEY) {
    try {
      const drive = google.drive({ version: 'v3', auth: process.env.GOOGLE_API_KEY });
      return { files: await listDriveFolder(drive, folderId, recursive), method: 'api_key' };
    } catch (error) {
      errors.push(`API key: ${error.message}`);
    }
  }

  throw new Error(errors.length ? `Drive access failed: ${errors.at(-1)}` : 'No Google Drive credentials configured.');
}

export function buildDrivePreviewUrl(fileId) {
  return `https://drive.google.com/file/d/${validDriveId(fileId)}/preview`;
}

export function buildDriveViewUrl(fileId) {
  return `https://drive.google.com/file/d/${validDriveId(fileId)}/view`;
}

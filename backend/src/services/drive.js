import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';

const TOKEN_FILE = path.resolve('drive-token.json');

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

// ── Token persistence ─────────────────────────────────────────────────────────

export function loadSavedTokens() {
  try {
    if (fs.existsSync(TOKEN_FILE)) return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
  } catch {}
  return null;
}

export function saveTokens(tokens) {
  try { fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2)); } catch {}
}

export function deleteSavedTokens() {
  try { if (fs.existsSync(TOKEN_FILE)) fs.unlinkSync(TOKEN_FILE); } catch {}
}

// ── Drive client builders ─────────────────────────────────────────────────────

function makeOAuth2Client() {
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
    // Auto-save refreshed tokens
    client.on('tokens', (tokens) => {
      const merged = { ...saved, ...tokens };
      saveTokens(merged);
      client.setCredentials(merged);
    });
  }
  return client;
}

export async function getDriveService() {
  // 1. Service account — works for folders shared with it
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    const auth = new google.auth.GoogleAuth({
      credentials: creds,
      scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    });
    return google.drive({ version: 'v3', auth });
  }

  // 2. Persisted OAuth token — works for any folder the connected Google account can see
  const saved = loadSavedTokens();
  if (saved) {
    const client = getOAuthClient();
    return google.drive({ version: 'v3', auth: client });
  }

  // 3. API key — works for public "anyone with the link" folders
  if (process.env.GOOGLE_API_KEY) {
    return google.drive({ version: 'v3', auth: process.env.GOOGLE_API_KEY });
  }

  throw new Error('No Google Drive credentials. Connect via OAuth in the Drive Sync tab.');
}

export function hasDriveAccess() {
  return !!(
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
    loadSavedTokens() ||
    process.env.GOOGLE_API_KEY
  );
}

// ── Folder listing ────────────────────────────────────────────────────────────

export async function listDriveFolder(drive, folderId, recursive = false) {
  const files = [];
  let pageToken;

  do {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'nextPageToken, files(id, name, mimeType, size, thumbnailLink, webViewLink, parents)',
      pageSize: 200,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    const items = res.data.files || [];

    for (const f of items) {
      if (f.mimeType === 'application/vnd.google-apps.folder') {
        if (recursive) {
          const sub = await listDriveFolder(drive, f.id, true);
          files.push(...sub);
        }
      } else {
        files.push({
          ...f,
          contentType: MIME_TO_TYPE[f.mimeType] || 'link',
          driveUrl: `https://drive.google.com/file/d/${f.id}/preview`,
          viewUrl: f.webViewLink || `https://drive.google.com/file/d/${f.id}/view`,
        });
      }
    }
    pageToken = res.data.nextPageToken;
  } while (pageToken);

  return files;
}

// Try service account → OAuth token → API key, in order
export async function listDriveFolderAny(folderId, recursive = false) {
  const errors = [];

  // 1. Service account
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    try {
      const drive = await getDriveService();
      const files = await listDriveFolder(drive, folderId, recursive);
      return { files, method: 'service_account' };
    } catch (err) {
      errors.push(`Service account: ${err.message}`);
    }
  }

  // 2. Persisted OAuth (user account — broadest access)
  const saved = loadSavedTokens();
  if (saved) {
    try {
      const client = getOAuthClient();
      const drive = google.drive({ version: 'v3', auth: client });
      const files = await listDriveFolder(drive, folderId, recursive);
      return { files, method: 'oauth' };
    } catch (err) {
      errors.push(`OAuth: ${err.message}`);
    }
  }

  // 3. API key (public folders only)
  if (process.env.GOOGLE_API_KEY) {
    try {
      const drive = google.drive({ version: 'v3', auth: process.env.GOOGLE_API_KEY });
      const files = await listDriveFolder(drive, folderId, recursive);
      return { files, method: 'api_key' };
    } catch (err) {
      errors.push(`API key: ${err.message}`);
    }
  }

  throw new Error(
    errors.length
      ? `Drive access failed — ${errors[errors.length - 1]}. Connect your Google account via OAuth in the Drive Sync tab.`
      : 'No Google Drive credentials configured.'
  );
}

export function buildDrivePreviewUrl(fileId) {
  return `https://drive.google.com/file/d/${fileId}/preview`;
}

export function buildDriveViewUrl(fileId) {
  return `https://drive.google.com/file/d/${fileId}/view`;
}

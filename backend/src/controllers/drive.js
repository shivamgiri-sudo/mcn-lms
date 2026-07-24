import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { getOAuthClient, saveTokens, deleteSavedTokens, loadSavedTokens, listDriveFolderAny, hasDriveAccess, getDriveService } from '../services/drive.js';
import { prisma } from '../utils/db.js';
import { audit } from '../utils/audit.js';

function oauthStateSecret() {
  const secret = String(process.env.OAUTH_STATE_SECRET || process.env.SESSION_SECRET || '');
  if (secret.length < 32) throw new Error('OAUTH_STATE_SECRET or SESSION_SECRET must contain at least 32 characters.');
  return secret;
}

function signState(payload) {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = createHmac('sha256', oauthStateSecret()).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

function verifyState(value) {
  const [encoded, supplied] = String(value || '').split('.');
  if (!encoded || !supplied) throw new Error('Invalid OAuth state.');
  const expected = createHmac('sha256', oauthStateSecret()).update(encoded).digest('base64url');
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) throw new Error('Invalid OAuth state.');
  const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  if (!payload?.sub || !payload?.exp || Date.now() > Number(payload.exp)) throw new Error('OAuth state expired.');
  return payload;
}

function validDriveId(value) {
  const id = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(id)) throw new Error('Invalid Google Drive identifier.');
  return id;
}

function callbackPage(success) {
  const heading = success ? 'Google Drive connected' : 'Google Drive connection failed';
  const color = success ? '#059669' : '#b91c1c';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>${heading}</title></head><body style="font-family:system-ui,sans-serif;padding:40px;text-align:center"><h2 style="color:${color}">${heading}</h2><p>${success ? 'You can close this tab and return to the LMS.' : 'Close this tab and restart the connection from the LMS administration page.'}</p></body></html>`;
}

export async function getDriveAuthUrl(req, res) {
  try {
    const client = getOAuthClient();
    const state = signState({ sub: req.userId, exp: Date.now() + 10 * 60 * 1000, nonce: randomBytes(16).toString('hex') });
    const url = client.generateAuthUrl({
      access_type: 'offline',
      scope: ['https://www.googleapis.com/auth/drive.readonly'],
      prompt: 'consent',
      state,
      include_granted_scopes: true,
    });
    return res.json({ ok: true, url });
  } catch (error) {
    console.error('[DRIVE] OAuth URL generation failed:', error.message);
    return res.status(503).json({ ok: false, message: 'Google Drive OAuth is not configured securely.' });
  }
}

export async function handleOAuthCallback(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
  try {
    if (req.query?.error) return res.status(400).send(callbackPage(false));
    const state = verifyState(req.query?.state);
    const code = String(req.query?.code || '').trim();
    if (!code) return res.status(400).send(callbackPage(false));

    const client = getOAuthClient();
    const { tokens } = await client.getToken(code);
    if (!tokens?.access_token && !tokens?.refresh_token) throw new Error('Google did not return usable OAuth tokens.');
    const existing = loadSavedTokens() || {};
    saveTokens({ ...existing, ...tokens });
    await audit({ userIdentity: state.sub, userRole: 'Super Admin', action: 'CONNECT_GOOGLE_DRIVE', module: 'Integration', referenceId: 'google-drive-oauth' });
    return res.send(callbackPage(true));
  } catch (error) {
    console.error('[DRIVE] OAuth callback failed:', error.message);
    return res.status(400).send(callbackPage(false));
  }
}

export async function getStoredToken(_req, res) {
  try {
    const saved = loadSavedTokens();
    let serviceAccountEmail = null;
    if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
      const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
      serviceAccountEmail = credentials.client_email || null;
    }
    return res.json({
      ok: true,
      hasToken: hasDriveAccess(),
      method: process.env.GOOGLE_SERVICE_ACCOUNT_JSON ? 'service_account' : saved ? 'oauth' : process.env.GOOGLE_API_KEY ? 'api_key' : null,
      oauthConnected: Boolean(saved),
      serviceAccountEmail,
      encryptedTokenStorage: Boolean(saved),
    });
  } catch (error) {
    console.error('[DRIVE] Token status failed:', error.message);
    return res.status(503).json({ ok: false, message: 'Google Drive token storage is unavailable.' });
  }
}

export async function disconnectOAuth(req, res) {
  try {
    deleteSavedTokens();
    await audit({ userIdentity: req.userId, userRole: 'Super Admin', action: 'DISCONNECT_GOOGLE_DRIVE', module: 'Integration', referenceId: 'google-drive-oauth' });
    return res.json({ ok: true, message: 'OAuth disconnected.' });
  } catch (error) {
    console.error('[DRIVE] OAuth disconnect failed:', error.message);
    return res.status(500).json({ ok: false, message: 'OAuth disconnect failed.' });
  }
}

function parseFileOrder(name) {
  const match = String(name || '').match(/^(\d+(?:\.\d+)*)[_\s-]/);
  if (!match) return Infinity;
  const parts = match[1].split('.').map(Number);
  return parts[0] + (parts[1] || 0) / 100 + (parts[2] || 0) / 10000;
}

export async function listFolder(req, res) {
  try {
    const folderId = validDriveId(req.params.folderId);
    const { files: rawFiles, method } = await listDriveFolderAny(folderId, req.query?.recursive === 'true');
    const files = [...rawFiles]
      .sort((a, b) => parseFileOrder(a.name) - parseFileOrder(b.name))
      .map((file, index) => ({
        ...file,
        sortOrder: index + 1,
        displayTitle: String(file.name || '').replace(/^[\d.]+[_\s-]+/, '').replace(/\.[^/.]+$/, '').trim(),
      }));
    return res.json({ ok: true, data: files, method });
  } catch (error) {
    console.error('[DRIVE] Folder listing failed:', error.message);
    return res.status(400).json({ ok: false, message: 'Unable to list the requested Google Drive folder.' });
  }
}

export async function getFileInfo(req, res) {
  try {
    const fileId = validDriveId(req.params.fileId);
    const drive = await getDriveService();
    const file = await drive.files.get({ fileId, fields: 'id, name, mimeType, size, thumbnailLink, webViewLink', supportsAllDrives: true });
    return res.json({ ok: true, data: file.data });
  } catch (error) {
    console.error('[DRIVE] File lookup failed:', error.message);
    return res.status(400).json({ ok: false, message: 'Unable to load Google Drive file information.' });
  }
}

async function authorizedContent(req, fileId) {
  const content = await prisma.contentMaster.findFirst({
    where: { driveFileId: fileId, active: true },
    include: { module: { include: { classroom: true } } },
  });
  if (!content || !content.module?.active || !content.module?.classroom?.active) return null;
  const classroomId = content.module.classroomId;

  if (req.userType === 'trainee') {
    const trainee = await prisma.traineeMaster.findUnique({ where: { employeeId: req.userId } });
    if (!trainee || trainee.status !== 'Active') return null;
    if (trainee.classroomId === classroomId) return content;
    const mapping = await prisma.traineeClassroomMap.findFirst({ where: { employeeId: req.userId, classroomId, active: true }, select: { id: true } });
    return mapping ? content : null;
  }

  if (req.userType === 'admin') {
    if (!req.userBranch || content.module.classroom.branch === req.userBranch) return content;
    return null;
  }

  if (req.userType === 'coordinator') {
    const batch = await prisma.batchMaster.findFirst({
      where: { coordinatorLoginId: req.userId, classroomId, batchStatus: 'Active' },
      select: { batchNo: true },
    });
    return batch ? content : null;
  }

  return null;
}

function streamHeaders(res, mimeType, fileName, inline) {
  const encoded = encodeURIComponent(String(fileName || 'drive-file'));
  res.setHeader('Content-Type', mimeType);
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encoded}`);
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
}

export async function proxyDriveFile(req, res) {
  try {
    const fileId = validDriveId(req.params.fileId);
    const content = await authorizedContent(req, fileId);
    if (!content) return res.status(403).json({ ok: false, message: 'This file is not assigned to your LMS scope.' });

    const drive = await getDriveService();
    const meta = await drive.files.get({ fileId, fields: 'id, name, mimeType, size', supportsAllDrives: true });
    const mimeType = meta.data.mimeType || 'application/octet-stream';
    const fileName = meta.data.name || content.contentTitle || fileId;
    const exportMimeMap = {
      'application/vnd.google-apps.document': 'application/pdf',
      'application/vnd.google-apps.spreadsheet': 'application/pdf',
      'application/vnd.google-apps.presentation': 'application/pdf',
      'application/vnd.google-apps.drawing': 'image/png',
    };
    const exportMime = exportMimeMap[mimeType];

    let stream;
    let responseMime = mimeType;
    if (exportMime) {
      const exported = await drive.files.export({ fileId, mimeType: exportMime }, { responseType: 'stream' });
      stream = exported.data;
      responseMime = exportMime;
    } else {
      const downloaded = await drive.files.get({ fileId, alt: 'media', supportsAllDrives: true }, { responseType: 'stream' });
      stream = downloaded.data;
    }

    const inline = responseMime === 'application/pdf' || responseMime.startsWith('image/') || responseMime.startsWith('video/');
    streamHeaders(res, responseMime, exportMime === 'application/pdf' ? `${fileName}.pdf` : fileName, inline);
    if (!exportMime && meta.data.size) res.setHeader('Content-Length', meta.data.size);
    stream.on('error', error => {
      console.error('[DRIVE] Stream failed:', error.message);
      if (!res.headersSent) res.status(502).json({ ok: false, message: 'Drive file stream failed.' });
      else res.destroy(error);
    });
    return stream.pipe(res);
  } catch (error) {
    console.error('[DRIVE] Proxy failed:', error.message);
    if (res.headersSent) return res.end();
    return res.status(502).json({ ok: false, message: 'Could not load the assigned Google Drive file.' });
  }
}

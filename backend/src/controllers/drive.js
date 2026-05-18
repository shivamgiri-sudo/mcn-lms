import { google } from 'googleapis';
import { getOAuthClient, saveTokens, deleteSavedTokens, loadSavedTokens, listDriveFolderAny, hasDriveAccess, getDriveService } from '../services/drive.js';

export async function getDriveAuthUrl(req, res) {
  if (!process.env.GOOGLE_CLIENT_ID) {
    return res.json({ ok: false, message: 'GOOGLE_CLIENT_ID not set in .env. Add OAuth credentials to enable browser-based login.' });
  }
  const client = getOAuthClient();
  const url = client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/drive.readonly'],
    prompt: 'consent', // force refresh_token to be returned
  });
  res.json({ ok: true, url });
}

export async function handleOAuthCallback(req, res) {
  try {
    const { code, error } = req.query;
    if (error) return res.send(`<h2>OAuth error: ${error}. Close this tab and try again.</h2>`);
    const client = getOAuthClient();
    const { tokens } = await client.getToken(code);
    saveTokens(tokens);
    res.send(`
      <html><body style="font-family:sans-serif;padding:40px;text-align:center">
        <h2 style="color:#059669">✓ Google Drive Connected!</h2>
        <p>Your Google account is now linked. You can close this tab.</p>
        <p style="font-size:13px;color:#64748b">The LMS can now sync any folder your account can view — even view-only shared links.</p>
      </body></html>
    `);
  } catch (err) {
    res.status(500).send('<h2>OAuth callback failed: ' + err.message + '</h2>');
  }
}

export async function getStoredToken(req, res) {
  const saved = loadSavedTokens();
  let serviceAccountEmail = null;
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    try {
      const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
      serviceAccountEmail = creds.client_email || null;
    } catch {}
  }
  res.json({
    ok: true,
    hasToken: hasDriveAccess(),
    method: process.env.GOOGLE_SERVICE_ACCOUNT_JSON ? 'service_account' : saved ? 'oauth' : process.env.GOOGLE_API_KEY ? 'api_key' : null,
    oauthConnected: !!saved,
    serviceAccountEmail,
  });
}

export async function disconnectOAuth(req, res) {
  deleteSavedTokens();
  res.json({ ok: true, message: 'OAuth disconnected.' });
}

function parseFileOrder(name) {
  const m = name.match(/^(\d+(?:\.\d+)*)[_\s-]/);
  if (!m) return Infinity;
  const parts = m[1].split('.').map(Number);
  return parts[0] + (parts[1] || 0) / 100 + (parts[2] || 0) / 10000;
}

export async function listFolder(req, res) {
  try {
    const { folderId } = req.params;
    const { recursive } = req.query;
    const { files: rawFiles, method } = await listDriveFolderAny(folderId, recursive === 'true');
    const files = [...rawFiles]
      .sort((a, b) => parseFileOrder(a.name) - parseFileOrder(b.name))
      .map((f, i) => ({
        ...f,
        sortOrder: i + 1,
        displayTitle: f.name.replace(/^[\d.]+[_\s-]+/, '').replace(/\.[^/.]+$/, '').trim(),
      }));
    res.json({ ok: true, data: files, method });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
}

export async function getFileInfo(req, res) {
  try {
    const { fileId } = req.params;
    const { files } = await listDriveFolderAny(fileId);
    const client = getOAuthClient();
    const drive = google.drive({ version: 'v3', auth: client });
    const file = await drive.files.get({
      fileId,
      fields: 'id, name, mimeType, size, thumbnailLink, webViewLink',
      supportsAllDrives: true,
    });
    res.json({ ok: true, data: file.data });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
}

// Proxy Drive file content through the backend so learners don't need Google accounts
export async function proxyDriveFile(req, res) {
  try {
    const { fileId } = req.params;
    const drive = await getDriveService();

    // Get file metadata first for MIME type and name
    const meta = await drive.files.get({
      fileId,
      fields: 'id, name, mimeType, size',
      supportsAllDrives: true,
    });

    const mimeType = meta.data.mimeType || 'application/octet-stream';
    const fileName = meta.data.name || fileId;

    // Google Workspace formats (Docs, Sheets, Slides) must be exported
    const exportMimeMap = {
      'application/vnd.google-apps.document': 'application/pdf',
      'application/vnd.google-apps.spreadsheet': 'application/pdf',
      'application/vnd.google-apps.presentation': 'application/pdf',
      'application/vnd.google-apps.drawing': 'image/png',
    };

    const exportMime = exportMimeMap[mimeType];

    if (exportMime) {
      const exported = await drive.files.export(
        { fileId, mimeType: exportMime, supportsAllDrives: true },
        { responseType: 'stream' }
      );
      res.setHeader('Content-Type', exportMime);
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(fileName)}.pdf"`);
      res.setHeader('Cache-Control', 'private, max-age=3600');
      exported.data.pipe(res);
    } else {
      const fileStream = await drive.files.get(
        { fileId, alt: 'media', supportsAllDrives: true },
        { responseType: 'stream' }
      );
      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(fileName)}"`);
      res.setHeader('Cache-Control', 'private, max-age=3600');
      if (meta.data.size) res.setHeader('Content-Length', meta.data.size);
      fileStream.data.pipe(res);
    }
  } catch (err) {
    console.error('Drive proxy error:', err.message);
    res.status(500).json({ ok: false, message: 'Could not load file: ' + err.message });
  }
}

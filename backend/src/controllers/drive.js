import { google } from 'googleapis';
import { getOAuthClient, saveTokens, deleteSavedTokens, loadSavedTokens, listDriveFolderAny, hasDriveAccess } from '../services/drive.js';

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

export async function listFolder(req, res) {
  try {
    const { folderId } = req.params;
    const { recursive } = req.query;
    const { files, method } = await listDriveFolderAny(folderId, recursive === 'true');
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

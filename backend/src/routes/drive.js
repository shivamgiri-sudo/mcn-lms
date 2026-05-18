import { Router } from 'express';
import { requireSession, requireRole } from '../middleware/auth.js';
import { listFolder, getFileInfo, getDriveAuthUrl, handleOAuthCallback, getStoredToken, disconnectOAuth, proxyDriveFile } from '../controllers/drive.js';

const auth = [requireSession, requireRole('admin')];
const router = Router();

router.get('/auth-url', ...auth, getDriveAuthUrl);
router.get('/oauth2callback', handleOAuthCallback);
router.get('/token-status', ...auth, getStoredToken);
router.post('/disconnect', ...auth, disconnectOAuth);
router.get('/folder/:folderId', ...auth, listFolder);
router.get('/file/:fileId', ...auth, getFileInfo);

// Proxy Drive content for learners — accepts trainee or admin session
router.get('/proxy/:fileId', requireSession, proxyDriveFile);

export default router;

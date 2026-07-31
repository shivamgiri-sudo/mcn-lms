import { Router } from 'express';
import { requireSession, requireRole, requireSuperAdmin } from '../middleware/auth.js';
import { listFolder, getFileInfo, getDriveAuthUrl, handleOAuthCallback, getStoredToken, disconnectOAuth, proxyDriveFile } from '../controllers/drive.js';

const router = Router();
const superAdminAuth = [requireSession, requireRole('admin'), requireSuperAdmin];
const contentViewerAuth = [requireSession, requireRole('trainee', 'admin', 'coordinator')];

router.get('/auth-url', ...superAdminAuth, getDriveAuthUrl);
router.get('/oauth2callback', handleOAuthCallback);
router.get('/token-status', ...superAdminAuth, getStoredToken);
router.post('/disconnect', ...superAdminAuth, disconnectOAuth);
router.get('/folder/:folderId', ...superAdminAuth, listFolder);
router.get('/file/:fileId', ...superAdminAuth, getFileInfo);
router.get('/proxy/:fileId', ...contentViewerAuth, proxyDriveFile);

export default router;

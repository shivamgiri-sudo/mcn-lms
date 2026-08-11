import { Router } from 'express';
import { requireSession, requireRole, requireSuperAdmin } from '../middleware/auth.js';
import { listFolder, getFileInfo, getDriveAuthUrl, handleOAuthCallback, getStoredToken, disconnectOAuth, proxyDriveFile } from '../controllers/drive.js';

const router = Router();
const superAdminAuth = [requireSession, requireRole('admin'), requireSuperAdmin];
// Browsing Drive is part of everyday content work, so any admin may do it.
// Changing the connection itself stays with super administrators.
const adminAuth = [requireSession, requireRole('admin')];
const contentViewerAuth = [requireSession, requireRole('trainee', 'admin', 'coordinator')];

router.get('/auth-url', ...superAdminAuth, getDriveAuthUrl);
router.get('/oauth2callback', handleOAuthCallback);
router.get('/token-status', ...adminAuth, getStoredToken);
router.post('/disconnect', ...superAdminAuth, disconnectOAuth);
router.get('/folder/:folderId', ...adminAuth, listFolder);
router.get('/file/:fileId', ...adminAuth, getFileInfo);
router.get('/proxy/:fileId', ...contentViewerAuth, proxyDriveFile);

export default router;

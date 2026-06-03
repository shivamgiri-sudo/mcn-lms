import { Router } from 'express';
import { coordinatorLogin } from '../controllers/coordinatorAuth.js';
import { coordinatorLogout, adminLogin, adminLogout, traineeLogin, traineeLogout, traineeChangePassword, getMyProfile } from '../controllers/auth.js';
import { requireSession } from '../middleware/auth.js';

const router = Router();

router.post('/coordinator/login', coordinatorLogin);
router.post('/coordinator/logout', requireSession, coordinatorLogout);
router.post('/admin/login', adminLogin);
router.post('/admin/logout', requireSession, adminLogout);
router.post('/trainee/login', traineeLogin);
router.post('/trainee/logout', requireSession, traineeLogout);
router.post('/trainee/change-password', requireSession, traineeChangePassword);
router.get('/me', requireSession, getMyProfile);

export default router;

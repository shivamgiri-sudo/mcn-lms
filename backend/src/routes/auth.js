import { Router } from 'express';
import { coordinatorLogin, coordinatorLogout, adminLogin, traineeLogin, traineeChangePassword, getMyProfile } from '../controllers/auth.js';
import { requireSession } from '../middleware/auth.js';

const router = Router();

router.post('/coordinator/login', coordinatorLogin);
router.post('/coordinator/logout', requireSession, coordinatorLogout);
router.post('/admin/login', adminLogin);
router.post('/trainee/login', traineeLogin);
router.post('/trainee/change-password', requireSession, traineeChangePassword);
router.get('/me', requireSession, getMyProfile);

export default router;

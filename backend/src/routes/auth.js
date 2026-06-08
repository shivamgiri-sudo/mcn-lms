import { Router } from 'express';
import { coordinatorLogin, coordinatorLogout, adminLogin, adminLogout, traineeLogout, traineeChangePassword, traineeForgotPassword, getMyProfile } from '../controllers/auth.js';
import { traineeLoginStable } from '../controllers/authStability.js';
import { requireSession } from '../middleware/auth.js';

const router = Router();

router.post('/coordinator/login', coordinatorLogin);
router.post('/coordinator/logout', requireSession, coordinatorLogout);
router.post('/admin/login', adminLogin);
router.post('/admin/logout', requireSession, adminLogout);
router.post('/trainee/login', traineeLoginStable);
router.post('/trainee/logout', requireSession, traineeLogout);
router.post('/trainee/change-password', requireSession, traineeChangePassword);
router.post('/trainee/forgot-password', traineeForgotPassword);
router.get('/me', requireSession, getMyProfile);

export default router;

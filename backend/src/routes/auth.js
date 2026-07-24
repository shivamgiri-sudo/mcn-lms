import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { coordinatorLogin, coordinatorLogout, adminLogin, adminLogout, traineeLogout, traineeChangePassword, getMyProfile } from '../controllers/auth.js';
import { traineeLoginStable } from '../controllers/authStability.js';
import { requestTraineeRecovery, requestAdminRecovery, requestCoordinatorRecovery } from '../controllers/secureRecovery.js';
import { requireSession } from '../middleware/auth.js';
import { validate, loginSchema, adminLoginSchema, traineeLoginSchema, forgotPasswordSchema } from '../utils/validate.js';

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { ok: false, message: 'Too many login attempts. Try again after 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const recoveryLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { ok: false, message: 'Too many recovery requests. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/coordinator/login', loginLimiter, validate(loginSchema), coordinatorLogin);
router.post('/coordinator/logout', requireSession, coordinatorLogout);
router.post('/admin/login', loginLimiter, validate(adminLoginSchema), adminLogin);
router.post('/admin/logout', requireSession, adminLogout);
router.post('/trainee/login', loginLimiter, validate(traineeLoginSchema), traineeLoginStable);
router.post('/trainee/logout', requireSession, traineeLogout);
router.post('/trainee/change-password', requireSession, traineeChangePassword);

// These endpoints now record recovery requests without changing credentials.
// Predictable temporary passwords and API-returned passwords are deliberately disabled.
router.post('/trainee/forgot-password', recoveryLimiter, validate(forgotPasswordSchema), requestTraineeRecovery);
router.post('/admin/forgot-password', recoveryLimiter, requestAdminRecovery);
router.post('/coordinator/forgot-password', recoveryLimiter, requestCoordinatorRecovery);

router.get('/me', requireSession, getMyProfile);

export default router;

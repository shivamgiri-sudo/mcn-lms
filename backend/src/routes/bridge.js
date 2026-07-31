import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { bridgeAuth } from '../controllers/bridgeController.js';

const router = Router();
const bridgeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { ok: false, message: 'Too many HRMS SSO attempts. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/', bridgeLimiter, bridgeAuth);
export default router;

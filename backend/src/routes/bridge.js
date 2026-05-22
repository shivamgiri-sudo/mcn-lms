import { Router } from 'express';
import { bridgeAuth } from '../controllers/bridgeController.js';

const router = Router();
router.post('/', bridgeAuth);
export default router;

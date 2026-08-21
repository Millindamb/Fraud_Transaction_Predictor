import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { login, loginSchema, me } from '../controllers/authController.js';
import { validate } from '../middleware/validate.js';
import { protect } from '../middleware/auth.js';

const router = Router();

// Tighter limit on the one endpoint worth brute-forcing
const loginLimiter = rateLimit({ windowMs: 15 * 60_000, max: 10, standardHeaders: true });

router.post('/login', loginLimiter, validate(loginSchema), login);
router.get('/me', protect, me);

export default router;

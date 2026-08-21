import { Router } from 'express';
import { labels, list, resolve, resolveSchema } from '../controllers/alertController.js';
import { protect, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const router = Router();
router.use(protect);

router.get('/', list);
router.get('/labels', requireRole('engineer', 'supervisor'), labels);
router.patch('/:id', validate(resolveSchema), resolve);

export default router;

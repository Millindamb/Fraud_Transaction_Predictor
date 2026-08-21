import { Router } from 'express';
import { list, update, updateSchema } from '../controllers/ruleController.js';
import { protect, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const router = Router();
router.use(protect);

router.get('/', list);
router.patch('/:id', requireRole('engineer', 'supervisor'), validate(updateSchema), update);

export default router;

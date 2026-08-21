import { Router } from 'express';
import { getOne, list, score, scoreSchema, stats } from '../controllers/transactionController.js';
import { protect } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const router = Router();
router.use(protect);

router.get('/stats', stats);          // must precede /:id
router.post('/score', validate(scoreSchema), score);
router.get('/', list);
router.get('/:id', getOne);

export default router;

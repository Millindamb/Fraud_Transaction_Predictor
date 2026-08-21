import { z } from 'zod';
import Rule from '../models/Rule.js';
import ApiError from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { invalidateRuleCache } from '../services/ruleEngine.js';

export const updateSchema = z
  .object({
    threshold: z.number().nonnegative().optional(),
    weight: z.number().min(0).max(100).optional(),
    enabled: z.boolean().optional(),
    description: z.string().max(300).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update.' });

export const list = asyncHandler(async (_req, res) => {
  const items = await Rule.find().sort({ code: 1 }).lean();
  res.json({ items });
});

export const update = asyncHandler(async (req, res) => {
  const rule = await Rule.findByIdAndUpdate(
    req.params.id,
    { ...req.body, updatedBy: req.user._id },
    { new: true, runValidators: true }
  );
  if (!rule) throw ApiError.notFound('That rule does not exist.');

  invalidateRuleCache(); // takes effect on the next authorisation
  res.json(rule);
});

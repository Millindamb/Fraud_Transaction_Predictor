import { z } from 'zod';
import Alert from '../models/Alert.js';
import ApiError from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const resolveSchema = z.object({
  outcome: z.enum(['confirmed', 'dismissed']),
  note: z.string().max(500).optional(),
});

export const list = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = req.query.status;

  const items = await Alert.find(filter)
    .sort({ createdAt: -1 })
    .limit(Math.min(200, Number(req.query.limit) || 50))
    .lean();

  res.json({ items, total: items.length });
});

/**
 * PATCH /api/alerts/:id
 * The analyst's verdict here becomes the ground-truth label the model retrains
 * on in Part 3 — this is the feedback loop, not just a status change.
 */
export const resolve = asyncHandler(async (req, res) => {
  const alert = await Alert.findById(req.params.id);
  if (!alert) throw ApiError.notFound('That alert is no longer in the queue.');
  if (alert.status !== 'open') throw ApiError.badRequest('That alert was already reviewed.');

  alert.status = req.body.outcome;
  alert.outcome = req.body.outcome === 'confirmed' ? 'fraud' : 'legitimate';
  alert.note = req.body.note;
  alert.reviewedBy = req.user._id;
  alert.reviewedAt = new Date();
  await alert.save();

  res.json(alert);
});

/** GET /api/alerts/labels — training set export for the model retrain job */
export const labels = asyncHandler(async (_req, res) => {
  const items = await Alert.find({ status: { $ne: 'open' } })
    .populate('transaction')
    .lean();

  res.json({
    count: items.length,
    labels: items.map((a) => ({
      transactionId: a.transactionId,
      label: a.outcome === 'fraud' ? 1 : 0,
      reviewedAt: a.reviewedAt,
    })),
  });
});

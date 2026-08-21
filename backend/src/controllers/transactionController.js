import { z } from 'zod';
import Transaction from '../models/Transaction.js';
import Alert from '../models/Alert.js';
import ApiError from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { scoreTransaction } from '../services/riskEngine.js';
import { emitAlert, emitScored } from '../realtime/socket.js';
import { cityCoords } from '../services/featureBuilder.js';

export const scoreSchema = z.object({
  amount: z.number().positive('Amount must be greater than zero.'),
  hour: z.number().int().min(0).max(23).optional(),
  timestamp: z.string().datetime().optional(),
  merchantCategory: z.string().optional(),
  merchantName: z.string().optional(),
  city: z.string().optional(),
  homeCity: z.string().optional(),
  entryMode: z.enum(['CHIP', 'SWIPE', 'CONTACTLESS', 'MANUAL']).optional(),
  cardId: z.string().optional(),
  velocityLast24h: z.number().int().min(0).max(50).optional(),
  cardholderAge: z.number().int().min(18).max(120).optional(),
  blacklistHit: z.boolean().optional(),
  biometric: z.enum(['approved', 'declined', 'not_sent']).optional(),
  deviceKnown: z.boolean().optional(),
  persist: z.boolean().optional(),
});

const nextTransactionId = async () => {
  const count = await Transaction.estimatedDocumentCount();
  return `TX${String(1000 + count + 1)}`;
};

/** POST /api/transactions/score — runs the pipeline; only persists when asked. */
export const score = asyncHandler(async (req, res) => {
  const input = req.body;
  const result = await scoreTransaction(input);

  const when = input.timestamp
    ? new Date(input.timestamp)
    : (() => {
        const d = new Date();
        if (input.hour != null) d.setHours(input.hour, Math.floor(Math.random() * 60), 0, 0);
        return d;
      })();

  const coords = cityCoords(input.city) || [];

  const doc = {
    transactionId: input.transactionId || (await nextTransactionId()),
    timestamp: when,
    amount: input.amount,
    currency: 'INR',
    card: { cardId: input.cardId, masked: input.cardId ? `**** ${input.cardId.slice(-4)}` : undefined },
    cardholder: { homeCity: input.homeCity },
    merchant: { name: input.merchantName, category: input.merchantCategory },
    location: { city: input.city, country: 'IN', lat: coords[0], lng: coords[1] },
    device: { entryMode: input.entryMode },
    ruleScore: result.ruleScore,
    mlScore: result.mlScore,
    finalScore: result.finalScore,
    fusion: result.fusion,
    band: result.band,
    decision: result.decision,
    flags: result.flags,
    model: result.model,
    explanation: result.explanation,
    adapter: result.adapter,
    latencyMs: result.latencyMs,
    preVerificationScore: result.preVerificationScore,
    verification: result.verification,
  };

  if (!input.persist) return res.json(doc);

  const saved = await Transaction.create(doc);
  emitScored(saved.toObject());

  if (['ALERT', 'BLOCK'].includes(saved.decision)) {
    const alert = await Alert.create({
      transactionId: saved.transactionId,
      transaction: saved._id,
      amount: saved.amount,
      finalScore: saved.finalScore,
      band: saved.band,
      merchant: saved.merchant,
      location: saved.location,
      flags: saved.flags,
    });
    emitAlert(alert.toObject());
  }

  res.status(201).json(saved);
});

/** GET /api/transactions */
export const list = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Number(req.query.limit) || 25);
  const filter = {};

  if (req.query.band) filter.band = req.query.band;
  if (req.query.q) {
    const rx = new RegExp(String(req.query.q).trim(), 'i');
    filter.$or = [{ transactionId: rx }, { 'merchant.name': rx }, { 'card.masked': rx }];
  }
  if (req.query.from || req.query.to) {
    filter.timestamp = {};
    if (req.query.from) filter.timestamp.$gte = new Date(req.query.from);
    if (req.query.to) filter.timestamp.$lte = new Date(req.query.to);
  }

  const [items, total] = await Promise.all([
    Transaction.find(filter)
      .sort({ timestamp: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Transaction.countDocuments(filter),
  ]);

  res.json({ items, page, pages: Math.max(1, Math.ceil(total / limit)), total });
});

/** GET /api/transactions/stats */
export const stats = asyncHandler(async (req, res) => {
  const hours = req.query.range === '7d' ? 168 : 24;
  const since = new Date(Date.now() - hours * 3600_000);

  const [totals] = await Transaction.aggregate([
    { $match: { timestamp: { $gte: since } } },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        alerts: { $sum: { $cond: [{ $in: ['$decision', ['ALERT', 'BLOCK']] }, 1, 0] } },
        blockedValue: { $sum: { $cond: [{ $eq: ['$decision', 'BLOCK'] }, '$amount', 0] } },
        avgScore: { $avg: '$finalScore' },
      },
    },
  ]);

  const series = await Transaction.aggregate([
    { $match: { timestamp: { $gte: since } } },
    {
      $group: {
        _id: { $hour: '$timestamp' },
        avgScore: { $avg: '$finalScore' },
        alerts: { $sum: { $cond: [{ $in: ['$decision', ['ALERT', 'BLOCK']] }, 1, 0] } },
      },
    },
    { $sort: { _id: 1 } },
    {
      $project: {
        _id: 0,
        hour: { $toString: '$_id' },
        avgScore: { $round: ['$avgScore', 0] },
        alerts: 1,
      },
    },
  ]);

  res.json({
    total: totals?.total || 0,
    alerts: totals?.alerts || 0,
    blockedValue: totals?.blockedValue || 0,
    avgScore: Math.round(totals?.avgScore || 0),
    series: series.map((s) => ({ ...s, hour: s.hour.padStart(2, '0') })),
  });
});

/**
 * GET /api/transactions/heatmap
 *
 * Mean risk score per hour per merchant category. Aggregated in Mongo rather
 * than in the browser: a 24 x 6 grid computed from a 100-row page would leave
 * most cells empty, and an empty cell reads as "no risk" when it actually means
 * "no data" — the two must not look alike.
 */
export const heatmap = asyncHandler(async (req, res) => {
  const days = Number(req.query.days) || 14;
  const since = new Date(Date.now() - days * 86400_000);

  const cells = await Transaction.aggregate([
    { $match: { timestamp: { $gte: since } } },
    {
      $group: {
        _id: { hour: { $hour: '$timestamp' }, category: '$merchant.category' },
        avgScore: { $avg: '$finalScore' },
        maxScore: { $max: '$finalScore' },
        count: { $sum: 1 },
        flagged: { $sum: { $cond: [{ $in: ['$decision', ['ALERT', 'BLOCK']] }, 1, 0] } },
      },
    },
    {
      $project: {
        _id: 0,
        hour: '$_id.hour',
        category: '$_id.category',
        avgScore: { $round: ['$avgScore', 0] },
        maxScore: 1,
        count: 1,
        flagged: 1,
      },
    },
  ]);

  // Hour totals, so the panel can state the pattern rather than leaving the
  // reader to infer it from colour alone
  const byHour = await Transaction.aggregate([
    { $match: { timestamp: { $gte: since } } },
    {
      $group: {
        _id: { $hour: '$timestamp' },
        avgScore: { $avg: '$finalScore' },
        count: { $sum: 1 },
        flagged: { $sum: { $cond: [{ $in: ['$decision', ['ALERT', 'BLOCK']] }, 1, 0] } },
      },
    },
    { $sort: { _id: 1 } },
    {
      $project: {
        _id: 0,
        hour: '$_id',
        avgScore: { $round: ['$avgScore', 0] },
        count: 1,
        flagged: 1,
      },
    },
  ]);

  const categories = [...new Set(cells.map((c) => c.category).filter(Boolean))].sort();

  res.json({ cells, byHour, categories, days });
});

/** GET /api/transactions/:id — accepts the business ID, not the Mongo _id */
export const getOne = asyncHandler(async (req, res) => {
  const tx = await Transaction.findOne({ transactionId: req.params.id }).lean();
  if (!tx) throw ApiError.notFound('No transaction with that reference.');
  res.json(tx);
});
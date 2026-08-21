import { Router } from 'express';
import mongoose from 'mongoose';
import authRoutes from './authRoutes.js';
import transactionRoutes from './transactionRoutes.js';
import alertRoutes from './alertRoutes.js';
import ruleRoutes from './ruleRoutes.js';
import { mlHealth } from '../services/mlClient.js';

const router = Router();

router.get('/health', async (_req, res) => {
  res.json({
    status: 'ok',
    uptimeSeconds: Math.round(process.uptime()),
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    scoring: await mlHealth(),
  });
});

router.use('/auth', authRoutes);
router.use('/transactions', transactionRoutes);
router.use('/alerts', alertRoutes);
router.use('/rules', ruleRoutes);

export default router;

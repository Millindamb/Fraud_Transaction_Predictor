import axios from 'axios';
import env from '../config/env.js';

const http = axios.create({ baseURL: env.ML_SERVICE_URL, timeout: env.ML_TIMEOUT_MS });

/**
 * Statistical stand-in used until the Python service arrives in Part 3.
 * Deliberately NOT a copy of the rule engine — it weighs continuous signals
 * (z-scores, implied travel speed, velocity) rather than crossing fixed
 * thresholds, so the two engines can still disagree. That disagreement is the
 * whole reason for having both.
 */
function fallbackScore(f) {
  const logistic = (z) => 1 / (1 + Math.exp(-z));

  const terms = [
    { feature: 'Amount', z: Math.min((f.amountZScore ?? 1.2) / 3, 1.6), w: 0.42 },
    { feature: 'Location distance', z: Math.min(f.distanceKm / 900, 1.5), w: 0.28 },
    {
      feature: 'Transaction hour',
      z: f.hour >= 1 && f.hour <= 5 ? 1.4 : f.hour >= 22 || f.hour < 7 ? 0.7 : -0.4,
      w: 0.21,
    },
    { feature: 'Merchant category', z: f.knownCategory ? -0.5 : 1.1, w: 0.16 },
    { feature: 'Transaction frequency', z: Math.min(f.txCount24h / 8, 1.3), w: 0.1 },
    { feature: 'Card tenure', z: f.cardTenureDays > 180 ? -0.6 : 0.3, w: 0.08 },
    { feature: 'Entry mode', z: f.entryMode === 'MANUAL' ? 1.0 : -0.3, w: 0.09 },
  ];

  const logit = terms.reduce((s, t) => s + t.z * t.w * 3.2, -1.1);
  const probability = logistic(logit);

  return {
    mlScore: Math.round(probability * 100),
    model: {
      name: 'FallbackLogistic',
      version: '0.1-heuristic',
      confidence: Number(probability.toFixed(3)),
      source: 'fallback',
    },
    explanation: {
      baseValue: 0.04,
      contributions: terms
        .map((t) => ({ feature: t.feature, value: Number((t.z * t.w).toFixed(3)) }))
        .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
        .slice(0, 6),
    },
  };
}

export async function predict(features) {
  if (!env.ML_ENABLED) return fallbackScore(features);

  try {
    const { data } = await http.post('/predict', { features });
    return {
      mlScore: Math.max(0, Math.min(100, Math.round(data.score))),
      model: {
        name: data.model?.name || 'unknown',
        version: data.model?.version,
        confidence: data.model?.confidence,
        source: 'service',
      },
      explanation: data.explanation || { baseValue: 0, contributions: [] },
    };
  } catch (err) {
    // A model timeout must never take down authorisation scoring
    console.warn(`ML service unavailable (${err.message}) — using fallback scorer`);
    const out = fallbackScore(features);
    out.model.source = 'fallback-degraded';
    return out;
  }
}

export async function mlHealth() {
  if (!env.ML_ENABLED) return { enabled: false, reachable: false, mode: 'fallback' };
  try {
    const { data } = await http.get('/health');
    return { enabled: true, reachable: true, mode: 'service', ...data };
  } catch {
    return { enabled: true, reachable: false, mode: 'fallback-degraded' };
  }
}

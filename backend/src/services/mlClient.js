import axios from 'axios';
import env from '../config/env.js';

const http = axios.create({ baseURL: env.ML_SERVICE_URL, timeout: env.ML_TIMEOUT_MS });

// The trained model was fitted on five category labels; the console uses upper
// case internally. Anything unrecognised falls back to the most common category.
const CATEGORY_MAP = {
  ELECTRONICS: 'Electronics',
  TRAVEL: 'Travel',
  GROCERY: 'Grocery',
  FOOD: 'Food',
  RESTAURANT: 'Food',
  CLOTHING: 'Clothing',
  FUEL: 'Grocery',
  JEWELLERY: 'Electronics',
};

/**
 * Maps the POS feature set onto the schema the model was trained on.
 *
 * One scale adjustment is needed and worth stating plainly: the training data's
 * amounts sit in a 5–3000 band while the console works in rupees. Amounts are
 * therefore linearly rescaled so a typical transaction lands where the model
 * expects one. This matters less than it sounds — amount carries 0.029 feature
 * importance, near the bottom — and severity on amount is handled by the rule
 * engine, which works in real rupees.
 */
const TYPICAL_POS_INR = 5000;      // a typical console transaction
const TYPICAL_TRAINED = 175;       // mean amount in the training data
const COMPRESSION = 0.22;          // power < 1 compresses the long tail

/**
 * Maps a rupee amount into the band the model was trained on.
 *
 * A linear scale does not work: multiplying by a constant pushed anything above
 * ~₹4 lakh past the training maximum, where it clipped — so ₹4.5 lakh and
 * ₹820 crore arrived at the model as the same number. A power compression keeps
 * large amounts distinguishable across the realistic range and only saturates at
 * genuinely absurd values.
 *
 * This is a real seam between the two datasets and worth stating plainly rather
 * than hiding. It matters less than it looks: amount carries 0.029 feature
 * importance in the trained model, near the bottom. Severity on amount is the
 * rule engine's job, and it works in actual rupees.
 */
export function mapAmount(inr) {
  const ratio = Math.max(Number(inr) || 0, 1) / TYPICAL_POS_INR;
  const mapped = TYPICAL_TRAINED * Math.pow(ratio, COMPRESSION);
  return Math.min(Math.max(mapped, 1), 3000);
}

/**
 * Maps the POS feature set onto the schema the model was trained on.
 *
 * Every field the model expects is derived from something a real terminal
 * produces: entry mode stands in for device trust, a foreign city sets the
 * foreign flag, and card history supplies velocity.
 */
export function toModelRecord(f) {
  return {
    amount: mapAmount(f.amount),
    transaction_hour: Math.max(0, Math.min(23, Number(f.hour) || 0)),
    merchant_category: CATEGORY_MAP[String(f.merchantCategory || '').toUpperCase()] || 'Grocery',
    foreign_transaction: f.foreignTransaction ? 1 : 0,
    location_mismatch: f.locationMismatch ? 1 : 0,
    device_trust_score: Math.round(f.deviceTrustScore ?? 50),
    velocity_last_24h: Math.max(0, Math.round(f.txCount24h ?? 0)),
    cardholder_age: Math.max(18, Math.min(120, Math.round(f.cardholderAge ?? 40))),
  };
}

/**
 * Statistical stand-in used when the trained model is unreachable. Deliberately
 * not a copy of the rule engine — it weighs continuous signals rather than
 * crossing fixed thresholds, so the two engines can still disagree.
 */
function fallbackScore(f) {
  const logistic = (z) => 1 / (1 + Math.exp(-z));
  const terms = [
    { feature: 'Amount', z: Math.min((f.amountZScore ?? 1.2) / 3, 1.6), w: 0.42 },
    { feature: 'Location distance', z: f.locationMismatch ? 1.2 : -0.4, w: 0.28 },
    {
      feature: 'Transaction hour',
      z: f.hour >= 1 && f.hour <= 5 ? 1.4 : f.hour >= 22 || f.hour < 7 ? 0.7 : -0.4,
      w: 0.21,
    },
    { feature: 'Merchant category', z: f.knownCategory ? -0.5 : 1.1, w: 0.16 },
    { feature: 'Transaction frequency', z: Math.min(f.txCount24h / 8, 1.3), w: 0.1 },
    { feature: 'Device trust', z: (60 - (f.deviceTrustScore ?? 50)) / 40, w: 0.18 },
  ];
  const probability = logistic(terms.reduce((s, t) => s + t.z * t.w * 3.2, -1.1));

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
        .sort((a, b) => Math.abs(b.value) - Math.abs(a.value)),
    },
  };
}

export async function predict(features) {
  if (!env.ML_ENABLED) return fallbackScore(features);

  try {
    const record = toModelRecord(features);
    const { data } = await http.post('/csv/predict', { record });

    return {
      mlScore: Math.max(0, Math.min(100, Math.round(data.score))),
      model: {
        name: data.model?.name || 'unknown',
        version: data.model?.version,
        confidence: data.model?.confidence,
        source: 'service',
      },
      explanation: data.explanation || { baseValue: 0, contributions: [] },
      modelInput: record,
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
    return { enabled: true, reachable: true, mode: 'service', model: data.modelName };
  } catch {
    return { enabled: true, reachable: false, mode: 'fallback-degraded' };
  }
}
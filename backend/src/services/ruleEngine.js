import Rule from '../models/Rule.js';

let cache = { rules: [], at: 0 };
const TTL_MS = 30_000;

async function activeRules() {
  if (Date.now() - cache.at < TTL_MS && cache.rules.length) return cache.rules;
  const rules = await Rule.find({ enabled: true }).lean();
  cache = { rules, at: Date.now() };
  return rules;
}

export const invalidateRuleCache = () => {
  cache = { rules: [], at: 0 };
};

const inr = (n) => `₹${Number(n).toLocaleString('en-IN')}`;

/**
 * Severity multiplier for threshold rules.
 *
 * A binary rule is the wrong shape for money: ₹50,001 and ₹8,00,00,000 are not
 * the same event, but a flat +25 scored them identically. This maps how far past
 * the threshold a value sits onto a multiplier, so the weight grows with the
 * severity of the breach and saturates rather than running away.
 */
function severity(value, threshold) {
  if (threshold <= 0) return 1;
  const ratio = value / threshold;
  if (ratio < 1) return 0;
  if (ratio < 2) return 1.0;
  if (ratio < 5) return 1.5;
  if (ratio < 20) return 2.2;
  if (ratio < 100) return 3.0;
  return 3.6;
}

/** Each evaluator returns { detail, multiplier } when it fires, else null. */
const EVALUATORS = {
  AMOUNT_ANOMALY: (f, rule) => {
    if (f.amount < rule.threshold) return null;
    const mult = severity(f.amount, rule.threshold);
    const times = (f.amount / rule.threshold).toFixed(1);
    const detail = f.amountRatio
      ? `${f.amountRatio.toFixed(1)}× the cardholder 90-day median (${times}× the ${inr(rule.threshold)} threshold)`
      : `${inr(f.amount)} — ${times}× the ${inr(rule.threshold)} threshold`;
    return { detail, multiplier: mult };
  },

  TIME_ANOMALY: (f, rule) => {
    const quietStart = 23;
    if (f.hour >= rule.threshold && f.hour < quietStart) return null;
    // The dead of night is a stronger signal than the shoulder hours
    const deep = f.hour >= 1 && f.hour <= 4;
    return {
      detail: `${String(f.hour).padStart(2, '0')}:00 — outside the ${rule.threshold}:00–${quietStart}:00 activity window`,
      multiplier: deep ? 1.5 : 1.0,
    };
  },

  LOCATION_ANOMALY: (f, rule) => {
    if (!f.locationMismatch) return null;
    const mult = f.distanceKm ? severity(f.distanceKm, rule.threshold) || 1 : 1;
    const speed = f.impliedKmph > 900 ? ` — ${Math.round(f.impliedKmph)} km/h implied, physically impossible` : '';
    const detail = f.distanceKm
      ? `${f.distanceKm.toLocaleString('en-IN')} km from ${f.homeCity || 'the last known point'}${speed}`
      : `Transaction city differs from ${f.homeCity || 'the registered city'}`;
    return { detail, multiplier: Math.max(mult, 1) };
  },

  PATTERN_ANOMALY: (f) => {
    if (f.historyCount === 0 || f.knownCategory) return null;
    return {
      detail: `First ${f.merchantCategory || 'unknown'} purchase on this card`,
      multiplier: 1,
    };
  },

  VELOCITY: (f, rule) => {
    if (f.txCount24h < rule.threshold) return null;
    return {
      detail: `${f.txCount24h} authorisations in the last 24 hours`,
      multiplier: severity(f.txCount24h, rule.threshold),
    };
  },

  DEVICE_ANOMALY: (f) => {
    if (f.entryMode !== 'MANUAL') return null;
    return {
      detail: 'Card details keyed in manually rather than read from the chip',
      multiplier: 1,
    };
  },
};

export async function evaluateRules(features) {
  const rules = await activeRules();
  const flags = [];

  for (const rule of rules) {
    const evaluate = EVALUATORS[rule.code];
    if (!evaluate) continue;
    const hit = evaluate(features, rule);
    if (!hit) continue;

    // Single-rule cap: no one rule may reach the block band on its own, so a
    // decision always rests on more than one signal
    const weight = Math.min(Math.round(rule.weight * hit.multiplier), 60);
    flags.push({ code: rule.code, detail: hit.detail, weight });
  }

  const raw = flags.reduce((sum, f) => sum + f.weight, 0);
  return { flags, ruleScore: Math.min(100, raw) };
}
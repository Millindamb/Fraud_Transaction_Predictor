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

/** Each evaluator returns a human-readable detail string when it fires, else null. */
const EVALUATORS = {
  AMOUNT_ANOMALY: (f, rule) => {
    if (f.amount < rule.threshold) return null;
    return f.amountRatio
      ? `${f.amountRatio.toFixed(1)}× the cardholder 90-day median`
      : `Amount above the ₹${rule.threshold.toLocaleString('en-IN')} threshold`;
  },

  TIME_ANOMALY: (f, rule) => {
    // threshold = earliest normal hour; window runs threshold..23
    const quietStart = 23;
    if (f.hour >= rule.threshold && f.hour < quietStart) return null;
    return `${String(f.hour).padStart(2, '0')}:00 — outside the ${rule.threshold}:00–${quietStart}:00 activity window`;
  },

  LOCATION_ANOMALY: (f, rule) => {
    if (f.distanceKm < rule.threshold) return null;
    const speed = f.impliedKmph ? ` (${Math.round(f.impliedKmph)} km/h implied)` : '';
    return `${f.distanceKm.toLocaleString('en-IN')} km from the last known point${speed}`;
  },

  PATTERN_ANOMALY: (f) => {
    if (f.historyCount === 0 || f.knownCategory) return null;
    return `First ${f.merchantCategory || 'unknown'} purchase on this card`;
  },

  VELOCITY: (f, rule) => {
    if (f.txCount24h < rule.threshold) return null;
    return `${f.txCount24h} authorisations in the last 24 hours`;
  },

  DEVICE_ANOMALY: (f) => {
    if (f.entryMode !== 'MANUAL') return null;
    return 'Card details keyed in manually rather than read from the chip';
  },
};

export async function evaluateRules(features) {
  const rules = await activeRules();
  const flags = [];

  for (const rule of rules) {
    const evaluate = EVALUATORS[rule.code];
    if (!evaluate) continue;
    const detail = evaluate(features, rule);
    if (detail) flags.push({ code: rule.code, detail, weight: rule.weight });
  }

  const raw = flags.reduce((sum, f) => sum + f.weight, 0);
  return { flags, ruleScore: Math.min(100, raw) };
}

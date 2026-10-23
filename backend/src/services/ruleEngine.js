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

const HIGH_RISK_CATEGORIES = [
  'JEWELLERY', 'ELECTRONICS', 'TRAVEL', 'GIFT_CARDS', 'CRYPTO', 'GAMBLING', 'MONEY_TRANSFER', 'PREPAID_LOAD',
];
const CASH_EQUIVALENT_CATEGORIES = ['MONEY_TRANSFER', 'CRYPTO', 'PREPAID_LOAD', 'GAMBLING', 'GIFT_CARDS', 'QUASI_CASH'];

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
export const EVALUATORS = {
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

  // ───────────────────────── Round 2 rules ─────────────────────────

  // Any card-present or online spend in a city outside India
  FOREIGN_TRANSACTION: (f) => {
    if (!f.foreignTransaction) return null;
    return {
      detail: `Transaction originated in ${f.city || 'a foreign city'} — outside the domestic network`,
      multiplier: f.amount >= 50000 ? 1.5 : 1.0,
    };
  },

  // Two authorisations further apart than a flight could cover in the time between them.
  // `threshold` is the speed in km/h that counts as impossible.
  IMPOSSIBLE_TRAVEL: (f, rule) => {
    if (!f.impliedKmph || f.hoursSinceLast <= 0 || f.distanceKm < 100) return null;
    if (f.impliedKmph < rule.threshold) return null;
    return {
      detail: `${f.distanceKm.toLocaleString('en-IN')} km in ${f.hoursSinceLast.toFixed(1)} h — ${Math.round(
        f.impliedKmph
      )} km/h implied`,
      multiplier: Math.max(severity(f.impliedKmph, rule.threshold), 1),
    };
  },

  // Amount compared with the cardholder's own history rather than a global figure.
  // `threshold` is the multiple of the 90-day median. Needs enough history to mean something.
  AMOUNT_VS_HISTORY: (f, rule) => {
    if (f.historyCount < 5 || !f.amountRatio || f.amount < 2000) return null;
    if (f.amountRatio < rule.threshold) return null;
    return {
      detail: `${f.amountRatio.toFixed(1)}× this cardholder's usual spend (median ${inr(
        Math.round(f.medianAmount)
      )})`,
      multiplier: Math.max(severity(f.amountRatio, rule.threshold), 1),
    };
  },

  // Categories that are easy to resell: only risky once the value is meaningful.
  // `threshold` is the minimum amount in rupees.
  HIGH_RISK_CATEGORY: (f, rule) => {
    const risky = ['JEWELLERY', 'ELECTRONICS', 'TRAVEL', 'GIFT_CARDS', 'CRYPTO'];
    const cat = String(f.merchantCategory || '').toUpperCase();
    if (!risky.includes(cat) || f.amount < rule.threshold) return null;
    return {
      detail: `${inr(f.amount)} at a ${cat.toLowerCase().replace('_', ' ')} merchant — a resale-friendly category`,
      multiplier: 1,
    };
  },

  // Compound rule: keyed-in card number AND a large amount. Cloned card numbers are
  // used exactly like this. `threshold` is the minimum amount in rupees.
  MANUAL_HIGH_VALUE: (f, rule) => {
    if (f.entryMode !== 'MANUAL' || f.amount < rule.threshold) return null;
    return {
      detail: `${inr(f.amount)} keyed in manually — no chip or contactless proof of card presence`,
      multiplier: f.amount >= rule.threshold * 5 ? 1.5 : 1,
    };
  },

  // Compound rule: large amount during the dead of night (00:00–05:59).
  // `threshold` is the minimum amount in rupees.
  NIGHT_HIGH_VALUE: (f, rule) => {
    if (f.hour > 5 || f.amount < rule.threshold) return null;
    return {
      detail: `${inr(f.amount)} authorised at ${String(f.hour).padStart(2, '0')}:00`,
      multiplier: 1,
    };
  },

  // Amounts parked just under the review limit are a classic way of probing it.
  // `threshold` is the limit in rupees; fires between 90% and 100% of it.
  THRESHOLD_PROBING: (f, rule) => {
    if (rule.threshold <= 0) return null;
    const ratio = f.amount / rule.threshold;
    if (ratio < 0.9 || ratio >= 1) return null;
    return {
      detail: `${inr(f.amount)} is ${(ratio * 100).toFixed(0)}% of the ${inr(rule.threshold)} review limit`,
      multiplier: 1,
    };
  },

  // Many small purchases can add up to the same loss as one big one.
  // `threshold` is the rolling 24-hour spend in rupees.
  CUMULATIVE_SPEND_24H: (f, rule) => {
    if (!f.spend24h || f.spend24h < rule.threshold) return null;
    return {
      detail: `${inr(Math.round(f.spend24h))} spent on this card in the last 24 hours`,
      multiplier: severity(f.spend24h, rule.threshold),
    };
  },

  // ───────────────── Round 2 — behavioural / sequence rules ─────────────────

  // Card testing: a run of tiny authorisations used to check a stolen card is live.
  // `threshold` is the number of small (≤ ₹100) authorisations within an hour.
  CARD_TESTING: (f, rule) => {
    if (f.amount > 100) return null;
    const count = (f.smallTx1h || 0) + 1;
    if (count < rule.threshold) return null;
    return {
      detail: `${count} micro-payments (≤ ${inr(100)}) on this card within an hour — typical card validation`,
      multiplier: Math.max(severity(count, rule.threshold), 1),
    };
  },

  // The payoff after card testing: tiny probes earlier in the day, now a large charge.
  // `threshold` is the large-amount floor in rupees.
  TEST_THEN_DRAIN: (f, rule) => {
    if ((f.smallTx24h || 0) < 2 || f.amount < rule.threshold) return null;
    return {
      detail: `${inr(f.amount)} charge following ${f.smallTx24h} micro-payments in the last 24 hours`,
      multiplier: 1,
    };
  },

  // A card that has been quiet for a long time suddenly spends heavily.
  // `threshold` is the number of idle days; the amount floor is ₹10,000.
  DORMANT_CARD_REACTIVATION: (f, rule) => {
    if (f.hoursSinceLast == null || f.amount < 10000) return null;
    const idleDays = f.hoursSinceLast / 24;
    if (idleDays < rule.threshold) return null;
    return {
      detail: `${inr(f.amount)} on a card idle for ${Math.round(idleDays)} days`,
      multiplier: idleDays >= 60 ? 1.5 : 1,
    };
  },

  // The card appears in several different cities inside a day.
  // `threshold` is the number of distinct cities in 24 hours.
  MULTI_CITY_24H: (f, rule) => {
    if ((f.distinctCities24h || 0) < rule.threshold) return null;
    return {
      detail: `Card used in ${f.distinctCities24h} different cities within 24 hours`,
      multiplier: f.distinctCities24h >= rule.threshold + 2 ? 1.5 : 1,
    };
  },

  // Fraudsters sample many merchant types quickly. `threshold` is distinct categories in 24h.
  CATEGORY_HOPPING: (f, rule) => {
    if ((f.distinctCategories24h || 0) < rule.threshold) return null;
    return {
      detail: `${f.distinctCategories24h} different merchant categories in 24 hours`,
      multiplier: 1,
    };
  },

  // The same exact amount charged repeatedly. `threshold` is the repeat count including this one.
  DUPLICATE_AMOUNT: (f, rule) => {
    const count = (f.duplicateAmount24h || 0) + 1;
    if (f.amount < 1000 || count < rule.threshold) return null;
    return {
      detail: `${inr(f.amount)} charged ${count} times within 24 hours`,
      multiplier: count >= rule.threshold + 2 ? 1.5 : 1,
    };
  },

  // Compound rule: foreign location AND keyed-in card details (cross-border card-not-present pattern).
  FOREIGN_MANUAL: (f) => {
    if (!f.foreignTransaction || f.entryMode !== 'MANUAL') return null;
    return {
      detail: `Keyed-in card details in ${f.city || 'a foreign city'} — no chip proof for a cross-border payment`,
      multiplier: 1,
    };
  },

  // Magstripe swipes are clonable; chip is the norm. `threshold` is the amount floor in rupees.
  SWIPE_FALLBACK_HIGH_VALUE: (f, rule) => {
    if (f.entryMode !== 'SWIPE' || f.amount < rule.threshold) return null;
    return {
      detail: `${inr(f.amount)} on a magnetic-stripe swipe instead of chip`,
      multiplier: 1,
    };
  },

  // Statistical outlier against the card's own spread. `threshold` is the z-score.
  AMOUNT_ZSCORE: (f, rule) => {
    if (f.historyCount < 10 || f.amountZScore == null || f.amount < 2000) return null;
    if (f.amountZScore < rule.threshold) return null;
    return {
      detail: `${f.amountZScore.toFixed(1)} standard deviations above this card's average spend`,
      multiplier: f.amountZScore >= rule.threshold * 2 ? 1.5 : 1,
    };
  },

  // Large spend on a card with almost no history. `threshold` is the amount floor in rupees.
  NEW_CARD_HIGH_VALUE: (f, rule) => {
    if (f.historyCount > 2 || f.amount < rule.threshold) return null;
    return {
      detail: `${inr(f.amount)} on a card with only ${f.historyCount} prior transaction(s) on record`,
      multiplier: 1,
    };
  },

  // Round-thousand amounts are over-represented in manually planned fraud.
  // `threshold` is the amount floor in rupees.
  ROUND_AMOUNT: (f, rule) => {
    if (f.amount < rule.threshold || f.amount % 1000 !== 0) return null;
    return {
      detail: `${inr(f.amount)} is an exact round-thousand amount`,
      multiplier: 1,
    };
  },

  // ───────── Round 2 — entry-mode and category sequence rules ─────────

  // Chip card recently used with chip, now a bigger swipe. Fallback alone is not flagged.
  // `threshold` is the multiple of the card's 90-day median.
  CHIP_FALLBACK_SEQUENCE: (f, rule) => {
    if (f.entryMode !== 'SWIPE' || !f.chipWithin7d || f.amount < 2000) return null;
    if (!f.medianAmount || f.amount < f.medianAmount * rule.threshold) return null;
    return {
      detail: `Magstripe swipe for ${inr(f.amount)} on a card that used chip within the last 7 days`,
      multiplier: 1,
    };
  },

  // Repeated contactless taps just under the ₹5,000 no-PIN limit.
  // `threshold` is the number of such taps within an hour (including this one).
  CONTACTLESS_NEAR_LIMIT_BURST: (f, rule) => {
    if (f.entryMode !== 'CONTACTLESS' || f.amount < 3000 || f.amount > 5000) return null;
    const count = (f.nearLimitContactless1h || 0) + 1;
    if (count < rule.threshold) return null;
    return {
      detail: `${count} contactless taps between ₹3,000 and ₹5,000 within an hour — probing the PIN-free limit`,
      multiplier: count >= rule.threshold + 2 ? 1.5 : 1,
    };
  },

  // Spend in a risky category far above what this card normally spends in that same category.
  // `threshold` is the multiple of the card's own median for the category.
  HIGH_RISK_MCC_SPIKE: (f, rule) => {
    const cat = String(f.merchantCategory || '').toUpperCase();
    if (!HIGH_RISK_CATEGORIES.includes(cat) || (f.categoryHistoryCount || 0) < 3) return null;
    if (!f.categoryMedian || f.amount < f.categoryMedian * rule.threshold) return null;
    return {
      detail: `${inr(f.amount)} at a ${cat.toLowerCase().replace('_', ' ')} merchant — ${(
        f.amount / f.categoryMedian
      ).toFixed(1)}× this card's usual spend in that category`,
      multiplier: 1,
    };
  },

  // First-ever use of a cash-equivalent category, for a meaningful amount.
  // `threshold` is the amount floor in rupees.
  CASH_EQUIVALENT_FIRST_USE: (f, rule) => {
    const cat = String(f.merchantCategory || '').toUpperCase();
    if (!CASH_EQUIVALENT_CATEGORIES.includes(cat)) return null;
    if (f.historyCount === 0 || f.knownCategory || f.amount < rule.threshold) return null;
    return {
      detail: `First ${cat.toLowerCase().replace('_', ' ')} transaction on this card, for ${inr(f.amount)}`,
      multiplier: 1,
    };
  },

  // A newly active card tapping repeatedly. `threshold` is contactless taps in 24h (including this one).
  NEW_CARD_CONTACTLESS_CLUSTER: (f, rule) => {
    if (f.entryMode !== 'CONTACTLESS' || f.historyCount === 0 || f.cardTenureDays >= 7) return null;
    const count = (f.contactless24h || 0) + 1;
    if (count < rule.threshold) return null;
    return {
      detail: `${count} contactless taps in 24 hours on a card first seen ${f.cardTenureDays} day(s) ago`,
      multiplier: 1,
    };
  },

  // Late-night contactless in a category this card has never used. `threshold` is the amount floor in rupees.
  LATE_NIGHT_NEW_CATEGORY_CONTACTLESS: (f, rule) => {
    if (f.entryMode !== 'CONTACTLESS' || f.hour > 5 || f.amount < rule.threshold) return null;
    if (f.historyCount === 0 || f.knownCategory) return null;
    return {
      detail: `${inr(f.amount)} contactless at ${String(f.hour).padStart(2, '0')}:00 in a category new to this card`,
      multiplier: 1,
    };
  },

  // A card with an established chip history suddenly keyed in manually.
  // `threshold` is the amount floor in rupees; needs 5+ prior chip transactions.
  MANUAL_AFTER_CHIP_HISTORY: (f, rule) => {
    if (f.entryMode !== 'MANUAL' || (f.chipCount90d || 0) < 5 || f.amount < rule.threshold) return null;
    return {
      detail: `Keyed-in ${inr(f.amount)} on a card with ${f.chipCount90d} prior chip transactions`,
      multiplier: 1,
    };
  },

  // Several purchases in the same risky category in a day. `threshold` is the transaction count;
  // cumulative value must also reach ₹15,000.
  HIGH_RISK_MCC_CONCENTRATION: (f, rule) => {
    const cat = String(f.merchantCategory || '').toUpperCase();
    if (!HIGH_RISK_CATEGORIES.includes(cat)) return null;
    const count = (f.sameCat24hCount || 0) + 1;
    if (count < rule.threshold || (f.sameCat24hSpend || 0) < 15000) return null;
    return {
      detail: `${count} ${cat.toLowerCase().replace('_', ' ')} purchases in 24 hours totalling ${inr(
        Math.round(f.sameCat24hSpend)
      )}`,
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
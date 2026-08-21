import Transaction from '../models/Transaction.js';

// Lookup is normalised, so "pune", "Pune" and " PUNE " all resolve. The original
// case-sensitive map silently returned null for lowercase input, which made
// haversine return 0 and the location rule never fire.
const CITY_COORDS = {
  pune: [18.5204, 73.8567],
  mumbai: [19.076, 72.8777],
  delhi: [28.6139, 77.209],
  'new delhi': [28.6139, 77.209],
  bengaluru: [12.9716, 77.5946],
  bangalore: [12.9716, 77.5946],
  chennai: [13.0827, 80.2707],
  kolkata: [22.5726, 88.3639],
  hyderabad: [17.385, 78.4867],
  jaipur: [26.9124, 75.7873],
  ahmedabad: [23.0225, 72.5714],
  nagpur: [21.1458, 79.0882],
  surat: [21.1702, 72.8311],
  lucknow: [26.8467, 80.9462],
  kochi: [9.9312, 76.2673],
  goa: [15.2993, 74.124],
  // Non-Indian cities, so the foreign-transaction signal has something to bite on
  dubai: [25.2048, 55.2708],
  singapore: [1.3521, 103.8198],
  london: [51.5074, -0.1278],
  'new york': [40.7128, -74.006],
  bangkok: [13.7563, 100.5018],
};

const FOREIGN_CITIES = new Set(['dubai', 'singapore', 'london', 'new york', 'bangkok']);

const norm = (s) => String(s || '').trim().toLowerCase();

export const cityCoords = (city) => CITY_COORDS[norm(city)] || null;
export const isForeignCity = (city) => FOREIGN_CITIES.has(norm(city));

export function haversineKm(a, b) {
  if (!a || !b) return 0;
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

// Entry mode is the only device signal a POS terminal gives us, so it stands in
// for the trained model's device_trust_score. Chip data cannot be cloned the way
// a keyed-in card number can.
const ENTRY_MODE_TRUST = { CHIP: 88, CONTACTLESS: 76, SWIPE: 45, MANUAL: 15 };

export async function buildFeatures(raw) {
  const cardId = raw.cardId || raw.card?.cardId;
  const when = raw.timestamp ? new Date(raw.timestamp) : new Date();
  const hour = raw.hour ?? when.getHours();

  const since24h = new Date(when.getTime() - 24 * 60 * 60 * 1000);
  const since90d = new Date(when.getTime() - 90 * 24 * 60 * 60 * 1000);

  let history = [];
  if (cardId) {
    history = await Transaction.find({ 'card.cardId': cardId, timestamp: { $gte: since90d } })
      .sort({ timestamp: -1 })
      .limit(200)
      .lean();
  }

  const amounts = history.map((t) => t.amount).sort((a, b) => a - b);
  const median = amounts.length ? amounts[Math.floor(amounts.length / 2)] : 0;
  const mean = amounts.length ? amounts.reduce((s, n) => s + n, 0) / amounts.length : 0;
  const sd = amounts.length
    ? Math.sqrt(amounts.reduce((s, n) => s + (n - mean) ** 2, 0) / amounts.length)
    : 0;

  const last = history[0];
  const txCity = raw.city || raw.location?.city;
  const homeCity = raw.homeCity || raw.cardholder?.homeCity;
  const refCity = last?.location?.city || homeCity;

  const txCoords = cityCoords(txCity);
  const refCoords = cityCoords(refCity);
  let distanceKm = haversineKm(refCoords, txCoords);

  // If a city name is not in the gazetteer we cannot measure distance, but a
  // different name is still a different place. Fall back to a conservative
  // mismatch rather than silently reporting zero distance — the old behaviour
  // that let Pune -> Delhi pass clean.
  const namesDiffer = norm(txCity) && norm(refCity) && norm(txCity) !== norm(refCity);
  const coordsUnknown = !txCoords || !refCoords;
  if (namesDiffer && coordsUnknown) distanceKm = 500;

  const hoursSinceLast = last ? (when - new Date(last.timestamp)) / 3.6e6 : null;

  const categories = new Set(history.map((t) => t.merchant?.category).filter(Boolean));
  const category = raw.merchantCategory || raw.merchant?.category;
  const entryMode = (raw.entryMode || raw.device?.entryMode || 'CHIP').toUpperCase();

  // An explicit value wins over history, so the simulator can exercise the
  // velocity signal without a seeded card behind it
  const derivedVelocity = history.filter((t) => new Date(t.timestamp) >= since24h).length;
  const txCount24h = raw.velocityLast24h != null ? Number(raw.velocityLast24h) : derivedVelocity;

  return {
    amount: Number(raw.amount) || 0,
    hour,
    dayOfWeek: when.getDay(),
    medianAmount: median,
    meanAmount: mean,
    sdAmount: sd,
    amountRatio: median ? (Number(raw.amount) || 0) / median : null,
    amountZScore: sd ? ((Number(raw.amount) || 0) - mean) / sd : null,
    distanceKm,
    locationMismatch: distanceKm >= 300 || namesDiffer ? 1 : 0,
    foreignTransaction: isForeignCity(txCity) ? 1 : 0,
    hoursSinceLast,
    impliedKmph: hoursSinceLast ? distanceKm / Math.max(hoursSinceLast, 0.05) : null,
    txCount24h,
    knownCategory: categories.size === 0 ? true : categories.has(category),
    categoryCount: categories.size,
    cardTenureDays: history.length
      ? Math.round((when - new Date(history[history.length - 1].timestamp)) / 8.64e7)
      : 0,
    deviceTrustScore: ENTRY_MODE_TRUST[entryMode] ?? 50,
    cardholderAge: Number(raw.cardholderAge) || 40,
    entryMode,
    merchantCategory: category,
    city: txCity,
    homeCity,
    historyCount: history.length,
  };
}
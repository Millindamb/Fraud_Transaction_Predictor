import Transaction from '../models/Transaction.js';

const CITY_COORDS = {
  Pune: [18.5204, 73.8567],
  Mumbai: [19.076, 72.8777],
  Delhi: [28.6139, 77.209],
  Bengaluru: [12.9716, 77.5946],
  Chennai: [13.0827, 80.2707],
  Kolkata: [22.5726, 88.3639],
  Hyderabad: [17.385, 78.4867],
  Jaipur: [26.9124, 75.7873],
};

export const cityCoords = (city) => CITY_COORDS[city] || null;

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

/**
 * Assembles the historical aggregates both engines need.
 * In production these belong in a precomputed feature store — at POS latency
 * you cannot afford a collection scan per authorisation. Documented here so the
 * swap is obvious later.
 */
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
  const distanceKm = last
    ? haversineKm(cityCoords(last.location?.city), cityCoords(txCity))
    : haversineKm(cityCoords(raw.homeCity || raw.cardholder?.homeCity), cityCoords(txCity));
  const hoursSinceLast = last ? (when - new Date(last.timestamp)) / 3.6e6 : null;

  const categories = new Set(history.map((t) => t.merchant?.category).filter(Boolean));
  const category = raw.merchantCategory || raw.merchant?.category;

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
    hoursSinceLast,
    // Implied travel speed is the strongest single geo signal — 1200 km in 20 min is impossible
    impliedKmph: hoursSinceLast ? distanceKm / Math.max(hoursSinceLast, 0.05) : null,
    txCount24h: history.filter((t) => new Date(t.timestamp) >= since24h).length,
    knownCategory: categories.has(category),
    categoryCount: categories.size,
    cardTenureDays: history.length
      ? Math.round((when - new Date(history[history.length - 1].timestamp)) / 8.64e7)
      : 0,
    entryMode: raw.entryMode || raw.device?.entryMode || 'CHIP',
    merchantCategory: category,
    city: txCity,
    historyCount: history.length,
  };
}

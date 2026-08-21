/**
 * Shapes the backend must return. Useful for wiring the UI before the API exists —
 * point the api/* modules at these while Part 2 is being built.
 */
export const sampleTransaction = {
  transactionId: 'TX1025',
  timestamp: '2026-08-21T03:14:00.000Z',
  amount: 82000,
  currency: 'INR',
  card: { masked: '**** **** **** 4471', network: 'VISA' },
  cardholder: { id: 'CH-8891', name: 'R. Sharma', homeCity: 'Pune' },
  merchant: { id: 'M-5521', name: 'Vertex Electronics', category: 'ELECTRONICS' },
  location: { city: 'Delhi', country: 'IN', lat: 28.6139, lng: 77.209 },
  device: { terminalId: 'POS-DL-0042', entryMode: 'MANUAL' },
  ruleScore: 90,
  mlScore: 88,
  finalScore: 89,
  fusion: { strategy: 'weighted', weights: { rule: 0.4, ml: 0.6 } },
  decision: 'BLOCK',
  flags: [
    { code: 'AMOUNT_ANOMALY', detail: '11.4× the cardholder 90-day median', weight: 25 },
    { code: 'TIME_ANOMALY', detail: '03:14 — outside 07:00–23:00 activity window', weight: 20 },
    { code: 'LOCATION_ANOMALY', detail: '1,160 km from last authorisation 4 h ago', weight: 30 },
    { code: 'PATTERN_ANOMALY', detail: 'First ELECTRONICS purchase on this card', weight: 15 },
  ],
  model: { name: 'GradientBoosting v3.2', confidence: 0.88 },
  explanation: {
    baseValue: 0.04,
    contributions: [
      { feature: 'Amount', value: 0.42 },
      { feature: 'Location distance', value: 0.28 },
      { feature: 'Transaction hour', value: 0.21 },
      { feature: 'Merchant category', value: 0.16 },
      { feature: 'Transaction frequency', value: 0.1 },
      { feature: 'Card tenure', value: -0.07 },
    ],
  },
};

export const sampleStats = {
  total: 48210,
  alerts: 312,
  blockedValue: 4820000,
  series: Array.from({ length: 24 }, (_, h) => ({
    hour: String(h).padStart(2, '0'),
    avgScore: 18 + Math.round(22 * Math.abs(Math.sin(h / 3))),
    alerts: Math.round(4 + 9 * Math.abs(Math.cos(h / 4))),
  })),
};

export const BANDS = [
  { key: 'LOW', label: 'Low risk', min: 0, max: 30, action: 'Approve', color: '#16794F' },
  { key: 'MEDIUM', label: 'Medium risk', min: 31, max: 60, action: 'Monitor', color: '#B26B00' },
  { key: 'HIGH', label: 'High risk', min: 61, max: 80, action: 'Alert', color: '#D2601A' },
  { key: 'CRITICAL', label: 'Critical risk', min: 81, max: 100, action: 'Block', color: '#B4231B' },
];

export function bandFor(score) {
  const s = Math.max(0, Math.min(100, Number(score) || 0));
  return BANDS.find((b) => s >= b.min && s <= b.max) ?? BANDS[0];
}

export const RULE_CATALOG = {
  AMOUNT_ANOMALY: { label: 'High-value transaction', hint: 'Amount above cardholder threshold' },
  TIME_ANOMALY: { label: 'Unusual transaction hour', hint: 'Outside typical activity window' },
  LOCATION_ANOMALY: { label: 'Location mismatch', hint: 'Geo-distance from last known point' },
  PATTERN_ANOMALY: { label: 'Unusual purchase category', hint: 'Merchant category rarely used' },
  VELOCITY: { label: 'Transaction velocity', hint: 'Too many attempts in a short window' },
  DEVICE_ANOMALY: { label: 'Unrecognised terminal', hint: 'Device fingerprint not seen before' },
};

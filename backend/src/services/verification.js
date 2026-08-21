/**
 * Verification layer — the checks that run after a score, not before it.
 *
 * A risk score answers "does this look unusual?". It cannot answer "is this
 * actually the cardholder?". Those are different questions, and conflating them
 * is why naive systems decline a customer's first large purchase.
 *
 * So the score stands, and evidence about identity adjusts the decision on top
 * of it. A ₹1,20,000 laptop on a card that normally spends ₹3,000 is genuinely
 * anomalous and should score high — but if the cardholder approved it with a
 * fingerprint on their own phone, on their own network, seconds later, the
 * anomaly is explained.
 *
 * Order matters. A blacklist hit is not evidence that can be argued with; it
 * runs first and nothing overrides it.
 */

const ADJUSTMENTS = {
  BLACKLIST_HIT: {
    label: 'Card or device on the blocklist',
    detail: 'Reported compromised. No amount of verification clears a known-bad credential.',
    kind: 'override',
  },
  BIOMETRIC_APPROVED: {
    label: 'Approved by fingerprint on the registered phone',
    detail: 'The cardholder was asked and confirmed within seconds. Identity is established.',
    delta: -45,
    kind: 'clears',
  },
  BIOMETRIC_DECLINED: {
    label: 'Cardholder declined the push notification',
    detail: 'Asked directly, and said this was not them.',
    kind: 'override',
  },
  DEVICE_KNOWN: {
    label: 'Same phone, same network as usual',
    detail: 'Device fingerprint and IP both match the cardholder’s history.',
    delta: -10,
    kind: 'supports',
  },
  DEVICE_UNKNOWN: {
    label: 'Unrecognised device and network',
    detail: 'Neither the device fingerprint nor the IP has been seen on this card before.',
    delta: 15,
    kind: 'raises',
  },
};

/**
 * @param {number} score      fused risk score, 0–100
 * @param {object} checks     { blacklistHit, biometric: 'approved'|'declined'|'not_sent', deviceKnown }
 */
export function applyVerification(score, checks = {}) {
  const applied = [];
  let adjusted = score;

  if (checks.blacklistHit) {
    applied.push({ code: 'BLACKLIST_HIT', ...ADJUSTMENTS.BLACKLIST_HIT });
    return { score: 100, applied, overridden: true };
  }

  if (checks.biometric === 'declined') {
    applied.push({ code: 'BIOMETRIC_DECLINED', ...ADJUSTMENTS.BIOMETRIC_DECLINED });
    return { score: 100, applied, overridden: true };
  }

  if (checks.deviceKnown === true) {
    applied.push({ code: 'DEVICE_KNOWN', ...ADJUSTMENTS.DEVICE_KNOWN });
    adjusted += ADJUSTMENTS.DEVICE_KNOWN.delta;
  } else if (checks.deviceKnown === false) {
    applied.push({ code: 'DEVICE_UNKNOWN', ...ADJUSTMENTS.DEVICE_UNKNOWN });
    adjusted += ADJUSTMENTS.DEVICE_UNKNOWN.delta;
  }

  if (checks.biometric === 'approved') {
    applied.push({ code: 'BIOMETRIC_APPROVED', ...ADJUSTMENTS.BIOMETRIC_APPROVED });
    adjusted += ADJUSTMENTS.BIOMETRIC_APPROVED.delta;
  }

  return {
    score: Math.max(0, Math.min(100, Math.round(adjusted))),
    applied,
    overridden: false,
  };
}

/** True when any verification check was actually run. */
export const hasChecks = (c = {}) =>
  Boolean(c.blacklistHit) || Boolean(c.deviceKnown !== undefined) ||
  (c.biometric && c.biometric !== 'not_sent');
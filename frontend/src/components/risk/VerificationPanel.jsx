import { Fingerprint, ShieldOff, Smartphone, TrendingDown, TrendingUp } from 'lucide-react';
import { bandFor } from '../../lib/risk';

const ICONS = {
  BLACKLIST_HIT: ShieldOff,
  BIOMETRIC_APPROVED: Fingerprint,
  BIOMETRIC_DECLINED: Fingerprint,
  DEVICE_KNOWN: Smartphone,
  DEVICE_UNKNOWN: Smartphone,
};

/**
 * What happened after the score.
 *
 * Shows the risk score the pipeline produced and the score the customer
 * experienced, with the evidence that moved it between them. Hiding the original
 * would be dishonest — the transaction *was* anomalous, and an auditor reviewing
 * this decision needs to see that it was noticed and then explained.
 */
export default function VerificationPanel({ before, after, applied = [], overridden }) {
  if (!applied.length) return null;

  const beforeBand = bandFor(before);
  const afterBand = bandFor(after);
  const moved = after !== before;
  const eased = after < before;

  return (
    <section className="card overflow-hidden">
      <header className="flex items-baseline justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <h2 className="font-display text-sm font-semibold tracking-tight">
            Verification
          </h2>
          <p className="mt-0.5 text-xs text-slate1">
            Checks that run after scoring, to answer whether it was really the cardholder
          </p>
        </div>
      </header>

      <div className="flex items-center gap-4 border-b border-line px-4 py-3.5">
        <div>
          <p className="eyebrow">Risk score</p>
          <p className="num text-2xl font-semibold leading-none" style={{ color: beforeBand.color }}>
            {Math.round(before)}
          </p>
        </div>

        {moved && (
          <>
            {eased ? (
              <TrendingDown size={16} className="text-rules" />
            ) : (
              <TrendingUp size={16} className="text-band-critical" />
            )}
            <div>
              <p className="eyebrow">After verification</p>
              <p
                className="num text-2xl font-semibold leading-none"
                style={{ color: afterBand.color }}
              >
                {Math.round(after)}
              </p>
            </div>
          </>
        )}

        <span
          className="ml-auto font-display text-sm font-semibold"
          style={{ color: afterBand.color }}
        >
          {afterBand.action}
        </span>
      </div>

      <ul className="px-4 py-1">
        {applied.map((a) => {
          const Icon = ICONS[a.code] || Fingerprint;
          const isOverride = a.kind === 'override';
          const tone = isOverride
            ? '#B4231B'
            : a.kind === 'clears' || a.kind === 'supports'
              ? '#16794F'
              : '#D2601A';

          return (
            <li key={a.code} className="ledger-row flex items-start gap-3 py-2.5">
              <Icon size={15} className="mt-0.5 shrink-0" style={{ color: tone }} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{a.label}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-slate1">{a.detail}</p>
              </div>
              <span className="num shrink-0 text-xs font-medium" style={{ color: tone }}>
                {isOverride ? 'override' : a.delta > 0 ? `+${a.delta}` : a.delta}
              </span>
            </li>
          );
        })}
      </ul>

      {overridden && (
        <p className="border-t border-line px-4 py-2.5 text-xs leading-relaxed text-slate1">
          An override ignores the risk score entirely. A blocklisted credential or a cardholder
          saying "this was not me" are not evidence to be weighed against other signals.
        </p>
      )}
    </section>
  );
}

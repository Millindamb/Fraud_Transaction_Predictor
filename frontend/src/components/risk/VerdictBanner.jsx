import { bandFor } from '../../lib/risk';
import { RULE_CATALOG } from '../../lib/risk';

/**
 * The moment of decision, in the vernacular of the thing being simulated.
 *
 * A payment terminal does not report a weighted score — it prints one word.
 * This borrows that: the verdict is the largest element on the page, the score
 * sits beside it as evidence, and a single line names what drove it. Everything
 * else in the result column stays quiet so this reads first from across a room.
 */

const TERMINAL_WORD = {
  APPROVE: 'Approved',
  MONITOR: 'Approved, flagged',
  ALERT: 'Held for review',
  BLOCK: 'Declined',
};

export default function VerdictBanner({ result }) {
  if (!result) return null;

  const band = bandFor(result.finalScore);
  const flags = result.flags || [];
  const topFlag = [...flags].sort((a, b) => (b.weight || 0) - (a.weight || 0))[0];
  const topFeature = result.explanation?.contributions?.find((c) => c.value > 0);

  // One sentence naming the strongest signal from each engine, or saying plainly
  // that neither found anything.
  const reason = (() => {
    const parts = [];
    if (topFlag) parts.push(RULE_CATALOG[topFlag.code]?.label || topFlag.code);
    if (topFeature) parts.push(topFeature.feature.toLowerCase());
    if (!parts.length) return 'Nothing unusual in the rules or the model.';
    return parts.length === 2
      ? `Driven by ${parts[0].toLowerCase()} in the rules, ${parts[1]} in the model.`
      : `Driven by ${parts[0].toLowerCase()}.`;
  })();

  return (
    <section
      className="tick-in overflow-hidden rounded-card border"
      style={{ borderColor: `${band.color}44`, backgroundColor: `${band.color}0A` }}
      aria-live="polite"
    >
      <div className="flex flex-wrap items-center gap-x-8 gap-y-4 px-5 py-5">
        <div className="min-w-0 flex-1">
          <p className="eyebrow" style={{ color: band.color }}>
            Authorisation
          </p>
          <p
            className="mt-1 font-display text-[34px] font-extrabold leading-none tracking-tight"
            style={{ color: band.color }}
          >
            {TERMINAL_WORD[band.action.toUpperCase()] || band.action}
          </p>
          <p className="mt-2 text-sm text-slate1">{reason}</p>
        </div>

        <div className="flex items-end gap-6">
          <Metric label="Rules" value={result.ruleScore} color="#16794F" />
          <Metric label="Model" value={result.mlScore} color="#5B4BD6" />
          <div className="text-right">
            <p className="eyebrow">Risk score</p>
            <p
              className="num text-5xl font-semibold leading-none tracking-tight"
              style={{ color: band.color }}
            >
              {Math.round(result.finalScore)}
            </p>
          </div>
        </div>
      </div>

      {/* A single hairline carrying the score's position on the 0–100 scale */}
      <div className="h-1 w-full" style={{ backgroundColor: `${band.color}22` }}>
        <div
          className="h-full transition-[width] duration-500 ease-out"
          style={{
            width: `${Math.max(2, Math.min(100, result.finalScore))}%`,
            backgroundColor: band.color,
          }}
        />
      </div>
    </section>
  );
}

function Metric({ label, value, color }) {
  return (
    <div>
      <p className="eyebrow">{label}</p>
      <p className="num text-2xl font-semibold leading-none" style={{ color }}>
        {Math.round(value)}
      </p>
    </div>
  );
}
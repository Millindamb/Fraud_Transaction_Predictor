import { compactInr } from '../../lib/format';

/**
 * What the numbers mean for the people behind them.
 *
 * Deliberately names both sides. A fraud system that only reports what it caught
 * is telling half the story — every false positive is a real customer standing
 * at a checkout while their card is refused for no reason. Showing both is what
 * makes the precision/recall trade honest rather than a statistic.
 */
export default function ImpactStrip({ stats, falsePositiveRate = 0.19 }) {
  if (!stats) return null;

  const reviewLoad = stats.alerts || 0;
  const likelyWrong = Math.round(reviewLoad * falsePositiveRate);

  return (
    <section className="card mb-4 overflow-hidden">
      <div className="grid gap-px bg-line sm:grid-cols-3">
        <Panel
          value={compactInr(stats.blockedValue)}
          label="Stayed in someone's account"
          detail="Money that would have left before anyone noticed"
          tone="#16794F"
        />
        <Panel
          value={reviewLoad.toLocaleString('en-IN')}
          label="Waiting on a person"
          detail="Each one is a decision a human still has to make"
          tone="#B26B00"
        />
        <Panel
          value={`~${likelyWrong}`}
          label="Probably stopped for nothing"
          detail="Real customers, refused at a checkout, owed an apology"
          tone="#B4231B"
        />
      </div>
    </section>
  );
}

function Panel({ value, label, detail, tone }) {
  return (
    <div className="bg-surface px-5 py-4">
      <p className="num text-3xl font-semibold leading-none tracking-tight" style={{ color: tone }}>
        {value}
      </p>
      <p className="mt-2 font-display text-[13px] font-semibold">{label}</p>
      <p className="mt-1 text-xs leading-relaxed text-slate1">{detail}</p>
    </div>
  );
}
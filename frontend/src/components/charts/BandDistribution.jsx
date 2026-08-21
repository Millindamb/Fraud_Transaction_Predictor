import { BANDS } from '../../lib/risk';

/**
 * How today's traffic split across the four decision bands, as one stacked bar.
 *
 * A stacked bar rather than a donut because the bands are ordered — approve
 * through block is a scale, and a ring would throw that ordering away.
 */
export default function BandDistribution({ transactions = [] }) {
  const counts = BANDS.map((b) => ({
    ...b,
    count: transactions.filter((t) => t.band === b.key).length,
  }));
  const total = transactions.length || 1;

  return (
    <div>
      <div className="flex h-9 w-full overflow-hidden rounded-md">
        {counts.map((b) => {
          const pct = (b.count / total) * 100;
          if (pct === 0) return null;
          return (
            <div
              key={b.key}
              className="flex items-center justify-center transition-[width] duration-500"
              style={{ width: `${pct}%`, backgroundColor: b.color }}
              title={`${b.label}: ${b.count}`}
            >
              {pct > 7 && (
                <span className="num text-[11px] font-semibold text-white">
                  {Math.round(pct)}%
                </span>
              )}
            </div>
          );
        })}
      </div>

      <ul className="mt-4 space-y-2">
        {counts.map((b) => (
          <li key={b.key} className="flex items-baseline justify-between gap-3 text-xs">
            <span className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: b.color }} />
              <span className="text-ink">{b.action}</span>
              <span className="text-slate1">
                {b.min}–{b.max}
              </span>
            </span>
            <span className="num text-slate1">
              {b.count.toLocaleString('en-IN')}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
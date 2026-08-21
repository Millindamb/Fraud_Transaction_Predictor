/**
 * Feature contributions from the model, signed. Bars run both directions from a
 * zero axis so features that argued *for* approval stay visible.
 */
export default function ShapTape({ contributions = [] }) {
  if (!contributions.length)
    return <p className="px-1 py-3 text-sm text-slate1">No explanation returned for this score.</p>;

  const max = Math.max(...contributions.map((c) => Math.abs(c.value)), 0.01);

  return (
    <ul className="space-y-2">
      {contributions.map((c) => {
        const w = (Math.abs(c.value) / max) * 50;
        const positive = c.value >= 0;
        return (
          <li key={c.feature} className="grid grid-cols-[9.5rem_1fr_3.5rem] items-center gap-3">
            <span className="truncate text-xs text-slate1" title={c.feature}>
              {c.feature}
            </span>
            <div className="relative h-4 rounded-sm bg-paper">
              <span className="absolute inset-y-0 left-1/2 w-px bg-line" />
              <span
                className="absolute inset-y-0 rounded-sm"
                style={{
                  width: `${w}%`,
                  left: positive ? '50%' : `${50 - w}%`,
                  backgroundColor: positive ? '#5B4BD6' : '#16794F',
                  opacity: 0.85,
                }}
              />
            </div>
            <span
              className="num text-right text-xs"
              style={{ color: positive ? '#5B4BD6' : '#16794F' }}
            >
              {positive ? '+' : '−'}
              {Math.abs(c.value).toFixed(2)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

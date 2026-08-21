/**
 * Feature contributions from the model, signed.
 *
 * Label and value share a row; the bar sits beneath at full width. A three-column
 * grid reads more compactly but collapses when the container narrows — this
 * survives any column width, which matters because the panel sits in a different
 * width on every screen it appears in.
 *
 * Bars run both directions from a centre axis so features arguing *for* approval
 * stay visible. A model that only showed what pushed a score up would be telling
 * half the story.
 */
export default function ShapTape({ contributions = [] }) {
  if (!contributions.length)
    return <p className="px-1 py-3 text-sm text-slate1">No explanation returned for this score.</p>;

  const max = Math.max(...contributions.map((c) => Math.abs(c.value)), 0.01);

  return (
    <ul className="space-y-3">
      {contributions.map((c) => {
        const width = (Math.abs(c.value) / max) * 50;
        const positive = c.value >= 0;
        const color = positive ? '#5B4BD6' : '#16794F';

        return (
          <li key={c.feature}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-xs text-ink" title={c.feature}>
                {c.feature}
              </span>
              <span className="num shrink-0 text-xs font-medium tabular-nums" style={{ color }}>
                {positive ? '+' : '−'}
                {Math.abs(c.value).toFixed(2)}
              </span>
            </div>

            <div className="relative mt-1.5 h-2 rounded-sm bg-paper">
              <span className="absolute inset-y-0 left-1/2 w-px bg-line" />
              <span
                className="absolute inset-y-0 rounded-sm transition-[width,left] duration-300"
                style={{
                  width: `${width}%`,
                  left: positive ? '50%' : `${50 - width}%`,
                  backgroundColor: color,
                  opacity: 0.85,
                }}
              />
            </div>
          </li>
        );
      })}

      <li className="flex items-center justify-between border-t border-line pt-2.5 text-[10px] uppercase tracking-wide text-slate1">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-rules" />
          Lowers risk
        </span>
        <span className="flex items-center gap-1.5">
          Raises risk
          <span className="h-2 w-2 rounded-sm bg-ml" />
        </span>
      </li>
    </ul>
  );
}
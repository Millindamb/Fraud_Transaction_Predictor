import { bandFor } from '../../lib/risk';

export default function StatusPill({ score, size = 'md' }) {
  const band = bandFor(score);
  const pad = size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs';
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-display font-semibold uppercase tracking-wide ${pad}`}
      style={{ color: band.color, backgroundColor: `${band.color}14` }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: band.color }} />
      {band.key}
    </span>
  );
}

import { Check } from 'lucide-react';
import { bandFor } from '../../lib/risk';

/**
 * One card's day, as a set of signals that can be switched on and off.
 *
 * Sequential-only playback would show the escalation but not the argument. Being
 * able to remove a single signal — take away the 3am, leave everything else —
 * demonstrates the thing the model actually learned: no one factor carries the
 * decision, and the same transaction reads completely differently depending on
 * what surrounds it.
 *
 * The first step is the baseline purchase and is always present; the rest are
 * the signals layered onto it.
 */
export default function EscalationTrail({ steps, selected, score, onToggle, disabled }) {
  const band = score != null ? bandFor(score) : null;

  return (
    <div>
      <ol className="relative -mx-1">
        {steps.map((step, i) => {
          const isBaseline = i === 0;
          const isOn = isBaseline || selected.has(i);
          const isLast = i === steps.length - 1;

          return (
            <li key={step.label} className="relative">
              {!isLast && (
                <span
                  className="absolute left-[19px] top-8 h-[calc(100%-1.5rem)] w-px"
                  style={{ backgroundColor: isOn ? '#0E1726' : '#D8DFE7', opacity: isOn ? 0.2 : 0.6 }}
                />
              )}

              <button
                onClick={() => !isBaseline && onToggle(i)}
                disabled={disabled || isBaseline}
                aria-pressed={isOn}
                className={`focusable flex w-full gap-3 rounded-lg px-1 py-2 text-left transition ${
                  isBaseline ? 'cursor-default' : 'hover:bg-paper'
                } disabled:cursor-default`}
              >
                <span
                  className={`relative z-10 mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-[11px] font-semibold transition ${
                    isOn
                      ? 'border-ink bg-ink text-white'
                      : 'border-line bg-surface text-slate1'
                  }`}
                >
                  {isOn ? <Check size={12} strokeWidth={3} /> : i + 1}
                </span>

                <span className={`min-w-0 flex-1 ${isOn ? '' : 'opacity-50'}`}>
                  <span className="num block text-[11px] leading-none text-slate1">
                    {step.time}
                  </span>
                  <span className="mt-1 block text-[13px] font-medium leading-snug">
                    {step.label}
                    {isBaseline && (
                      <span className="ml-1.5 text-[10px] font-normal uppercase tracking-wide text-slate1">
                        always on
                      </span>
                    )}
                  </span>
                  <span className="mt-1 block text-[11px] leading-relaxed text-slate1">
                    {step.note}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      {score != null && (
        <div
          className="mt-3 flex items-center justify-between rounded-lg px-3 py-2.5"
          style={{ backgroundColor: `${band.color}12` }}
        >
          <span className="text-xs text-slate1">
            {selected.size === 0
              ? 'Baseline only'
              : `${selected.size} signal${selected.size > 1 ? 's' : ''} added`}
          </span>
          <span className="flex items-baseline gap-1.5">
            <span className="num text-xl font-semibold leading-none" style={{ color: band.color }}>
              {Math.round(score)}
            </span>
            <span
              className="font-display text-[11px] font-semibold uppercase tracking-wide"
              style={{ color: band.color }}
            >
              {band.action}
            </span>
          </span>
        </div>
      )}
    </div>
  );
}
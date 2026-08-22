import { Loader2, X } from 'lucide-react';

// add anywhere in the file:
export function Modal({ title, icon, onClose, children, className = '' }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className={`card w-full max-w-md overflow-hidden ${className}`}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
            <div className="flex items-center gap-3">
              {icon && (
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-paper text-ink">
                  {icon}
                </span>
              )}
              <h2 className="font-display text-base font-semibold tracking-tight">{title}</h2>
            </div>
            <button
              onClick={onClose}
              className="focusable rounded-md p-1 text-slate1 hover:bg-paper hover:text-ink"
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </header>
        )}
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function Card({ title, subtitle, right, children, className = '', bodyClass = 'p-4' }) {
  return (
    <section className={`card ${className}`}>
      {(title || right) && (
        <header className="flex items-baseline justify-between gap-3 border-b border-line px-4 py-3">
          <div>
            {title && <h2 className="font-display text-sm font-semibold tracking-tight">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-slate1">{subtitle}</p>}
          </div>
          {right}
        </header>
      )}
      <div className={bodyClass}>{children}</div>
    </section>
  );
}

export function Button({ variant = 'primary', className = '', busy, children, ...props }) {
  const styles = {
    primary: 'bg-ink text-white hover:bg-[#1b2740] disabled:bg-slate1',
    ghost: 'bg-transparent text-ink border border-line hover:bg-paper',
    danger: 'bg-band-critical text-white hover:brightness-110',
  }[variant];
  return (
    <button
      {...props}
      disabled={busy || props.disabled}
      className={`focusable inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2 font-display text-[13px] font-semibold tracking-tight transition disabled:cursor-not-allowed ${styles} ${className}`}
    >
      {busy && <Loader2 size={14} className="animate-spin" />}
      {children}
    </button>
  );
}

export function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="eyebrow block">{label}</span>
      <div className="mt-1.5">{children}</div>
      {hint && <span className="mt-1 block text-xs text-slate1">{hint}</span>}
    </label>
  );
}

export function Input(props) {
  return (
    <input
      {...props}
      className={`focusable w-full rounded-md border border-line bg-white px-3 py-2 text-sm placeholder:text-slate1/70 ${props.className || ''}`}
    />
  );
}

export function Select({ children, ...props }) {
  return (
    <select
      {...props}
      className={`focusable w-full rounded-md border border-line bg-white px-3 py-2 text-sm ${props.className || ''}`}
    >
      {children}
    </select>
  );
}

export function EmptyState({ title, body, action }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
      <p className="font-display text-sm font-semibold">{title}</p>
      <p className="max-w-sm text-sm text-slate1">{body}</p>
      {action}
    </div>
  );
}

export function Skeleton({ rows = 5 }) {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-9 animate-pulse rounded bg-paper" />
      ))}
    </div>
  );
}

export function ErrorNote({ error, onRetry }) {
  return (
    <div className="px-4 py-6 text-sm">
      <p className="font-display font-semibold text-band-critical">Nothing loaded</p>
      <p className="mt-1 text-slate1">{error?.message || 'The risk service did not respond.'}</p>
      {onRetry && (
        <Button variant="ghost" className="mt-3" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

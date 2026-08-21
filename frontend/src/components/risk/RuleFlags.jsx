import { Check, Minus } from 'lucide-react';
import { RULE_CATALOG } from '../../lib/risk';

export default function RuleFlags({ flags = [], showPassed = false, allRuleIds = [] }) {
  const fired = new Set(flags.map((f) => f.code ?? f));
  const ids = showPassed ? allRuleIds : flags.map((f) => f.code ?? f);

  if (!ids.length)
    return <p className="px-1 py-3 text-sm text-slate1">No rules fired on this transaction.</p>;

  return (
    <ul>
      {ids.map((code) => {
        const meta = RULE_CATALOG[code] || { label: code, hint: 'Custom rule' };
        const hit = fired.has(code);
        const detail = flags.find((f) => (f.code ?? f) === code);
        return (
          <li key={code} className="ledger-row flex items-start gap-3 py-2.5">
            <span
              className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm ${
                hit ? 'bg-rules text-white' : 'bg-paper text-slate1'
              }`}
            >
              {hit ? <Check size={11} strokeWidth={3} /> : <Minus size={11} />}
            </span>
            <div className="min-w-0 flex-1">
              <p className={`text-sm ${hit ? 'font-medium' : 'text-slate1'}`}>{meta.label}</p>
              <p className="text-xs text-slate1">{detail?.detail || meta.hint}</p>
            </div>
            {hit && detail?.weight != null && (
              <span className="num text-xs text-rules">+{detail.weight}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

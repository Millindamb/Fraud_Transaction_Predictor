import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listRules, updateRule } from '../api/rules';
import PageHeader from '../components/layout/PageHeader';
import { Card, ErrorNote, Input, Skeleton } from '../components/ui/Primitives';
import { RULE_CATALOG } from '../lib/risk';

export default function RuleConfig() {
  const qc = useQueryClient();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['rules'],
    queryFn: listRules,
  });

  const save = useMutation({
    mutationFn: ({ id, patch }) => updateRule(id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rules'] }),
  });

  return (
    <>
      <PageHeader
        eyebrow="Configuration"
        title="Rule engine"
        description="Thresholds and weights applied before the model sees a transaction. Changes take effect on the next authorisation."
      />

      {isLoading ? (
        <Skeleton rows={6} />
      ) : isError ? (
        <Card><ErrorNote error={error} onRetry={refetch} /></Card>
      ) : (
        <Card bodyClass="p-0">
          <ul>
            {(data?.items || []).map((rule) => (
              <li key={rule._id} className="ledger-row grid gap-3 p-4 sm:grid-cols-[1fr_7rem_7rem_5rem] sm:items-end">
                <div>
                  <p className="font-display text-sm font-semibold">
                    {RULE_CATALOG[rule.code]?.label || rule.name}
                  </p>
                  <p className="mt-0.5 text-xs text-slate1">
                    {rule.description || RULE_CATALOG[rule.code]?.hint}
                  </p>
                </div>

                <label className="block">
                  <span className="eyebrow block">Threshold</span>
                  <Input
                    type="number"
                    className="num mt-1"
                    defaultValue={rule.threshold}
                    onBlur={(e) =>
                      save.mutate({ id: rule._id, patch: { threshold: Number(e.target.value) } })
                    }
                  />
                </label>

                <label className="block">
                  <span className="eyebrow block">Weight</span>
                  <Input
                    type="number"
                    className="num mt-1"
                    defaultValue={rule.weight}
                    onBlur={(e) =>
                      save.mutate({ id: rule._id, patch: { weight: Number(e.target.value) } })
                    }
                  />
                </label>

                <label className="flex items-center gap-2 pb-2">
                  <input
                    type="checkbox"
                    className="focusable h-4 w-4 accent-[#5B4BD6]"
                    defaultChecked={rule.enabled}
                    onChange={(e) =>
                      save.mutate({ id: rule._id, patch: { enabled: e.target.checked } })
                    }
                  />
                  <span className="text-xs text-slate1">Active</span>
                </label>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

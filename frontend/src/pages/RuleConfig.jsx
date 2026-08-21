import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Check, FlaskConical, Lock, RotateCcw } from 'lucide-react';
import { listRules, updateRule } from '../api/rules';
import { useAuth } from '../context/AuthContext';
import PageHeader from '../components/layout/PageHeader';
import { Button, Card, ErrorNote, Input, Skeleton } from '../components/ui/Primitives';
import { RULE_CATALOG } from '../lib/risk';

// Shipped values, so a session of experimentation can always be undone
const DEFAULTS = {
  AMOUNT_ANOMALY: { threshold: 50000, weight: 25 },
  TIME_ANOMALY: { threshold: 7, weight: 20 },
  LOCATION_ANOMALY: { threshold: 300, weight: 30 },
  PATTERN_ANOMALY: { threshold: 1, weight: 15 },
  VELOCITY: { threshold: 8, weight: 20 },
  DEVICE_ANOMALY: { threshold: 1, weight: 15 },
};

const CAN_EDIT = ['engineer', 'supervisor'];

export default function RuleConfig() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { user } = useAuth();
  const canEdit = CAN_EDIT.includes(user?.role);

  const [saved, setSaved] = useState({});   // ruleId -> timestamp
  const [error, setError] = useState(null);

  const { data, isLoading, isError, error: loadError, refetch } = useQuery({
    queryKey: ['rules'],
    queryFn: listRules,
  });

  const save = useMutation({
    mutationFn: ({ id, patch }) => updateRule(id, patch),
    onSuccess: (_res, { id }) => {
      setError(null);
      setSaved((s) => ({ ...s, [id]: Date.now() }));
      setTimeout(() => setSaved((s) => ({ ...s, [id]: null })), 2200);
      qc.invalidateQueries({ queryKey: ['rules'] });
    },
    onError: (err) => {
      // Without this the input keeps showing a value the server rejected
      setError(
        err.status === 403
          ? 'Editing rules needs the engineer or supervisor role. Sign in as engineer@bank.in to make changes.'
          : err.message || 'That change could not be saved.'
      );
      qc.invalidateQueries({ queryKey: ['rules'] });
    },
  });

  const rules = data?.items || [];
  const totalWeight = rules.filter((r) => r.enabled).reduce((s, r) => s + r.weight, 0);

  const resetAll = () => {
    rules.forEach((rule) => {
      const d = DEFAULTS[rule.code];
      if (!d) return;
      if (rule.threshold !== d.threshold || rule.weight !== d.weight || !rule.enabled) {
        save.mutate({ id: rule._id, patch: { ...d, enabled: true } });
      }
    });
  };

  return (
    <>
      <PageHeader
        eyebrow="Configuration"
        title="Rule engine"
        description="Thresholds and weights applied before the model sees a transaction. Changes take effect on the next authorisation."
        actions={
          canEdit && (
            <div className="flex gap-2">
              <Button variant="ghost" onClick={resetAll} busy={save.isPending}>
                <RotateCcw size={13} /> Reset defaults
              </Button>
              <Button onClick={() => navigate('/simulator')}>
                <FlaskConical size={13} /> Test in simulator
              </Button>
            </div>
          )
        }
      />

      {!canEdit && (
        <div className="card mb-4 flex items-start gap-2.5 p-3.5">
          <Lock size={15} className="mt-0.5 shrink-0 text-slate1" />
          <p className="text-sm text-slate1">
            You are signed in as <span className="font-medium text-ink">{user?.role}</span>, which
            can view rules but not change them. Rule weights alter every future decision, so edits
            are limited to engineers and supervisors. Sign in as{' '}
            <span className="num text-ink">engineer@bank.in</span> to edit.
          </p>
        </div>
      )}

      {error && (
        <div className="card mb-4 border-band-critical/30 p-3.5">
          <p className="text-sm text-band-critical">{error}</p>
        </div>
      )}

      {isLoading ? (
        <Skeleton rows={6} />
      ) : isError ? (
        <Card><ErrorNote error={loadError} onRetry={refetch} /></Card>
      ) : (
        <>
          <Card bodyClass="p-0">
            <ul>
              {rules.map((rule) => {
                const meta = RULE_CATALOG[rule.code];
                const d = DEFAULTS[rule.code];
                const changed = d && (rule.threshold !== d.threshold || rule.weight !== d.weight);

                return (
                  <li
                    key={rule._id}
                    className={`ledger-row grid gap-3 p-4 sm:grid-cols-[1fr_7rem_7rem_6rem] sm:items-end ${
                      rule.enabled ? '' : 'opacity-55'
                    }`}
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-display text-sm font-semibold">
                          {meta?.label || rule.name}
                        </p>
                        {changed && (
                          <span className="rounded-full bg-paper px-1.5 py-0.5 text-[10px] text-slate1">
                            edited
                          </span>
                        )}
                        {saved[rule._id] && (
                          <span className="inline-flex items-center gap-1 text-[11px] text-rules">
                            <Check size={11} strokeWidth={3} /> saved
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-slate1">
                        {rule.description || meta?.hint}
                      </p>
                    </div>

                    <label className="block">
                      <span className="eyebrow block">Threshold</span>
                      <Input
                        type="number"
                        className="num mt-1"
                        disabled={!canEdit}
                        defaultValue={rule.threshold}
                        key={`t-${rule._id}-${rule.threshold}`}
                        onBlur={(e) => {
                          const v = Number(e.target.value);
                          if (v !== rule.threshold && !Number.isNaN(v))
                            save.mutate({ id: rule._id, patch: { threshold: v } });
                        }}
                      />
                    </label>

                    <label className="block">
                      <span className="eyebrow block">Weight</span>
                      <Input
                        type="number"
                        min="0"
                        max="100"
                        className="num mt-1"
                        disabled={!canEdit}
                        defaultValue={rule.weight}
                        key={`w-${rule._id}-${rule.weight}`}
                        onBlur={(e) => {
                          const v = Number(e.target.value);
                          if (v !== rule.weight && !Number.isNaN(v))
                            save.mutate({ id: rule._id, patch: { weight: v } });
                        }}
                      />
                    </label>

                    <label className="flex items-center gap-2 pb-2">
                      <input
                        type="checkbox"
                        className="focusable h-4 w-4 accent-[#5B4BD6]"
                        disabled={!canEdit}
                        checked={rule.enabled}
                        onChange={(e) =>
                          save.mutate({ id: rule._id, patch: { enabled: e.target.checked } })
                        }
                      />
                      <span className="text-xs text-slate1">Active</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </Card>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Card title="Weight budget" subtitle="Combined weight if every active rule fires">
              <p className="num text-3xl font-semibold">{totalWeight}</p>
              <p className="mt-2 text-xs leading-relaxed text-slate1">
                {totalWeight < 81
                  ? 'Below 81, so no combination of rules can reach the block band on its own. The model decides the outcome for every transaction.'
                  : totalWeight > 160
                    ? 'Well above 100. Rules will saturate on ordinary traffic and the score loses resolution — most transactions will look identical.'
                    : 'A sensible range. Several rules must fire together to reach the block band, and a single rule cannot.'}
              </p>
            </Card>

            <Card title="How a weight becomes a score">
              <ul className="space-y-1.5 text-xs leading-relaxed text-slate1">
                <li>
                  A rule contributes its weight multiplied by <span className="text-ink">severity</span> —
                  how far past the threshold the value sits, from 1.0× up to 3.6×.
                </li>
                <li>
                  Any single rule is capped at <span className="num text-ink">60</span>, so one
                  signal alone can never block a transaction.
                </li>
                <li>
                  A rule score of 85 or more floors the final result in the block band, whatever the
                  model says.
                </li>
              </ul>
            </Card>
          </div>
        </>
      )}
    </>
  );
}
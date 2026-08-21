import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { listAlerts, resolveAlert } from '../api/alerts';
import PageHeader from '../components/layout/PageHeader';
import { Button, Card, EmptyState, ErrorNote, Select, Skeleton } from '../components/ui/Primitives';
import StatusPill from '../components/ui/StatusPill';
import { ago, inr } from '../lib/format';
import { RULE_CATALOG } from '../lib/risk';

export default function Alerts() {
  const [status, setStatus] = useState('open');
  const qc = useQueryClient();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['alerts', status],
    queryFn: () => listAlerts({ status }),
  });

  const resolve = useMutation({
    mutationFn: ({ id, outcome }) => resolveAlert(id, { outcome }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alerts'] }),
  });

  const alerts = data?.items || [];

  return (
    <>
      <PageHeader
        eyebrow="Queue"
        title="Alerts"
        description="Transactions that scored high enough to need a human decision. Confirming an outcome feeds the model's next retrain."
        actions={
          <Select className="w-40" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="open">Open</option>
            <option value="confirmed">Confirmed fraud</option>
            <option value="dismissed">False positive</option>
            <option value="">All</option>
          </Select>
        }
      />

      {isLoading ? (
        <Skeleton rows={6} />
      ) : isError ? (
        <Card><ErrorNote error={error} onRetry={refetch} /></Card>
      ) : alerts.length === 0 ? (
        <Card>
          <EmptyState
            title="The queue is clear"
            body="Nothing is waiting on review. New alerts land here as soon as a transaction crosses the alert threshold."
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {alerts.map((a) => (
            <article key={a._id} className="card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <StatusPill score={a.finalScore} size="sm" />
                    <Link
                      to={`/transactions/${a.transactionId}`}
                      className="focusable num text-sm font-medium underline-offset-2 hover:underline"
                    >
                      {a.transactionId}
                    </Link>
                    <span className="text-xs text-slate1">{ago(a.createdAt)}</span>
                  </div>
                  <p className="num mt-1.5 text-lg font-semibold">{inr(a.amount)}</p>
                  <p className="mt-0.5 text-xs text-slate1">
                    {a.merchant?.name} · {a.location?.city}
                  </p>
                  <ul className="mt-2 flex flex-wrap gap-1.5">
                    {(a.flags || []).map((f) => (
                      <li
                        key={f.code ?? f}
                        className="rounded-full bg-paper px-2 py-0.5 text-[11px] text-slate1"
                      >
                        {RULE_CATALOG[f.code ?? f]?.label || (f.code ?? f)}
                      </li>
                    ))}
                  </ul>
                </div>

                {a.status === 'open' ? (
                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      busy={resolve.isPending}
                      onClick={() => resolve.mutate({ id: a._id, outcome: 'dismissed' })}
                    >
                      Mark legitimate
                    </Button>
                    <Button
                      variant="danger"
                      busy={resolve.isPending}
                      onClick={() => resolve.mutate({ id: a._id, outcome: 'confirmed' })}
                    >
                      Confirm fraud
                    </Button>
                  </div>
                ) : (
                  <span className="eyebrow">
                    {a.status === 'confirmed' ? 'Confirmed fraud' : 'False positive'}
                  </span>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}

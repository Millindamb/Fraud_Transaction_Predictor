import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';
import { listTransactions } from '../api/transactions';
import PageHeader from '../components/layout/PageHeader';
import { Card, EmptyState, ErrorNote, Input, Select, Skeleton, Button } from '../components/ui/Primitives';
import StatusPill from '../components/ui/StatusPill';
import { BANDS, bandFor } from '../lib/risk';
import { inr, stamp } from '../lib/format';

export default function Transactions() {
  const [filters, setFilters] = useState({ q: '', band: '', page: 1 });
  const set = (patch) => setFilters((f) => ({ ...f, page: 1, ...patch }));

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['transactions', filters],
    queryFn: () => listTransactions({ ...filters, limit: 25 }),
    placeholderData: keepPreviousData,
  });

  const rows = data?.items || [];

  return (
    <>
      <PageHeader
        eyebrow="Ledger"
        title="Transactions"
        description="Every scored authorisation, newest first. Open a row to see why it scored the way it did."
      />

      <Card bodyClass="p-0">
        <div className="flex flex-wrap gap-3 border-b border-line p-3">
          <div className="relative min-w-[16rem] flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate1" />
            <Input
              className="pl-8"
              placeholder="Search by transaction ID, card, or merchant"
              value={filters.q}
              onChange={(e) => set({ q: e.target.value })}
            />
          </div>
          <Select
            className="w-44"
            value={filters.band}
            onChange={(e) => set({ band: e.target.value })}
          >
            <option value="">All risk bands</option>
            {BANDS.map((b) => (
              <option key={b.key} value={b.key}>
                {b.label}
              </option>
            ))}
          </Select>
        </div>

        {isLoading ? (
          <Skeleton rows={8} />
        ) : isError ? (
          <ErrorNote error={error} onRetry={refetch} />
        ) : rows.length === 0 ? (
          <EmptyState
            title="No transactions match those filters"
            body="Widen the risk band or clear the search to see more of the ledger."
            action={
              <Button variant="ghost" onClick={() => setFilters({ q: '', band: '', page: 1 })}>
                Clear filters
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left">
                  {['Transaction', 'Time', 'Amount', 'Merchant', 'Location', 'Rules', 'Model', 'Score', 'Decision'].map(
                    (h) => (
                      <th key={h} className="eyebrow px-4 py-2.5 font-semibold">
                        {h}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((tx) => (
                  <tr key={tx.transactionId} className="ledger-row hover:bg-paper">
                    <td className="px-4 py-2.5">
                      <Link
                        to={`/transactions/${tx.transactionId}`}
                        className="focusable num font-medium underline-offset-2 hover:underline"
                      >
                        {tx.transactionId}
                      </Link>
                    </td>
                    <td className="num px-4 py-2.5 text-xs text-slate1">{stamp(tx.timestamp)}</td>
                    <td className="num px-4 py-2.5">{inr(tx.amount)}</td>
                    <td className="px-4 py-2.5">{tx.merchant?.category || '—'}</td>
                    <td className="px-4 py-2.5 text-slate1">{tx.location?.city || '—'}</td>
                    <td className="num px-4 py-2.5 text-rules">{Math.round(tx.ruleScore)}</td>
                    <td className="num px-4 py-2.5 text-ml">{Math.round(tx.mlScore)}</td>
                    <td
                      className="num px-4 py-2.5 font-semibold"
                      style={{ color: bandFor(tx.finalScore).color }}
                    >
                      {Math.round(tx.finalScore)}
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusPill score={tx.finalScore} size="sm" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {data?.pages > 1 && (
          <div className="flex items-center justify-between border-t border-line px-4 py-3">
            <span className="num text-xs text-slate1">
              Page {data.page} of {data.pages}
            </span>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                disabled={filters.page <= 1}
                onClick={() => setFilters((f) => ({ ...f, page: f.page - 1 }))}
              >
                Previous
              </Button>
              <Button
                variant="ghost"
                disabled={filters.page >= data.pages}
                onClick={() => setFilters((f) => ({ ...f, page: f.page + 1 }))}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </Card>
    </>
  );
}

import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Pause, Play } from 'lucide-react';
import { useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { getStats, listTransactions } from '../api/transactions';
import { useLiveFeed } from '../hooks/useLiveFeed';
import PageHeader from '../components/layout/PageHeader';
import { Card, ErrorNote, Skeleton, Button, EmptyState } from '../components/ui/Primitives';
import StatusPill from '../components/ui/StatusPill';
import ImpactStrip from '../components/risk/ImpactStrip';
import EngineDivergence from '../components/charts/EngineDivergence';
import BandDistribution from '../components/charts/BandDistribution';
import { bandFor } from '../lib/risk';
import { clock, compactInr, inr } from '../lib/format';

export default function Dashboard() {
  const [paused, setPaused] = useState(false);
  const { events, connected } = useLiveFeed({ limit: 20, paused });
  const stats = useQuery({
    queryKey: ['stats', '24h'],
    queryFn: () => getStats('24h'),
    refetchInterval: 60_000,
  });

  // A sample of the ledger, for the charts that need per-transaction points
  const sample = useQuery({
    queryKey: ['transactions', 'sample'],
    queryFn: () => listTransactions({ page: 1, limit: 100 }),
    refetchInterval: 60_000,
  });
  const rows = sample.data?.items || [];

  return (
    <>
      <PageHeader
        eyebrow="Last 24 hours"
        title="Risk overview"
        description="Every authorisation that passed through the scoring pipeline today, and what it cost the people on either side of it."
      />

      <ImpactStrip stats={stats.data} />

      {stats.isLoading ? (
        <Skeleton rows={2} />
      ) : stats.isError ? (
        <Card><ErrorNote error={stats.error} onRetry={stats.refetch} /></Card>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat
            label="Transactions scored"
            value={stats.data.total?.toLocaleString('en-IN')}
            note="Every authorisation through the pipeline"
          />
          <Stat
            label="Alerts raised"
            value={stats.data.alerts?.toLocaleString('en-IN')}
            tone="#D2601A"
            note="Waiting on a human decision"
          />
          <Stat
            label="Value blocked"
            value={compactInr(stats.data.blockedValue)}
            tone="#B4231B"
            note="Declined before it settled"
          />
          <Stat
            label="Alert rate"
            value={`${((stats.data.alerts / Math.max(stats.data.total, 1)) * 100).toFixed(2)}%`}
            note="The share of traffic needing review"
          />
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.35fr_1fr]">
        <Card
          title="Where the two engines disagree"
          subtitle="Each point is a transaction, placed by what each engine thought of it"
        >
          <EngineDivergence transactions={rows} />
        </Card>

        <Card title="Decision split" subtitle="How today's traffic resolved">
          <BandDistribution transactions={rows} />
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.35fr_1fr]">
        <Card title="Score distribution over time" subtitle="Hourly mean risk score and alert count">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={stats.data?.series || []}>
                <defs>
                  <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#5B4BD6" stopOpacity={0.28} />
                    <stop offset="100%" stopColor="#5B4BD6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#D8DFE7" vertical={false} />
                <XAxis dataKey="hour" tick={{ fontSize: 11, fill: '#5A6B7C' }} tickLine={false} axisLine={false} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#5A6B7C' }} tickLine={false} axisLine={false} width={28} />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #D8DFE7' }}
                  labelStyle={{ fontFamily: 'IBM Plex Mono' }}
                />
                <Area type="monotone" dataKey="avgScore" stroke="#5B4BD6" strokeWidth={2} fill="url(#fill)" name="Avg score" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card
          title="Live authorisations"
          subtitle={connected ? 'Streaming from the scoring service' : 'Waiting for the stream'}
          bodyClass="p-0"
          right={
            <Button variant="ghost" onClick={() => setPaused((p) => !p)}>
              {paused ? <Play size={13} /> : <Pause size={13} />}
              {paused ? 'Resume' : 'Pause'}
            </Button>
          }
        >
          {events.length === 0 ? (
            <EmptyState
              title="No transactions yet"
              body="Scored authorisations will appear here the moment they clear the pipeline."
            />
          ) : (
            <ul className="max-h-[19rem] overflow-y-auto">
              {events.map((tx) => (
                <li key={tx.transactionId} className="ledger-row tick-in">
                  <Link
                    to={`/transactions/${tx.transactionId}`}
                    className="focusable flex items-center gap-3 px-4 py-2.5 hover:bg-paper"
                  >
                    <span className="num w-16 text-xs text-slate1">{clock(tx.timestamp)}</span>
                    <span className="num flex-1 truncate text-sm">{inr(tx.amount)}</span>
                    <span
                      className="num text-sm font-semibold"
                      style={{ color: bandFor(tx.finalScore).color }}
                    >
                      {Math.round(tx.finalScore)}
                    </span>
                    <StatusPill score={tx.finalScore} size="sm" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

function Stat({ label, value, tone, note }) {
  return (
    <div className="card p-4">
      <p className="eyebrow">{label}</p>
      <p
        className="num mt-2 text-3xl font-semibold leading-none tracking-tight"
        style={tone ? { color: tone } : undefined}
      >
        {value ?? '—'}
      </p>
      {note && <p className="mt-2 text-[11px] leading-relaxed text-slate1">{note}</p>}
    </div>
  );
}
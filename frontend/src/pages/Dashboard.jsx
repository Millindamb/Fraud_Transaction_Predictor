import { useQuery } from '@tanstack/react-query';
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
import PageHeader from '../components/layout/PageHeader';
import { Card, ErrorNote, Skeleton } from '../components/ui/Primitives';
import ImpactStrip from '../components/risk/ImpactStrip';
import EngineDivergence from '../components/charts/EngineDivergence';
import BandDistribution from '../components/charts/BandDistribution';
import { RULE_CATALOG, bandFor } from '../lib/risk';
import { compactInr } from '../lib/format';

export default function Dashboard() {
  const stats = useQuery({
    queryKey: ['stats', '24h'],
    queryFn: () => getStats('24h'),
    refetchInterval: 60_000,
  });

  // A sample of the ledger, for the panels that need per-transaction detail
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
        <Card>
          <ErrorNote error={stats.error} onRetry={stats.refetch} />
        </Card>
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
        <Card title="Score distribution over time" subtitle="Hourly mean risk score">
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
                <XAxis
                  dataKey="hour"
                  tick={{ fontSize: 11, fill: '#5A6B7C' }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  domain={[0, 100]}
                  tick={{ fontSize: 11, fill: '#5A6B7C' }}
                  tickLine={false}
                  axisLine={false}
                  width={28}
                />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #D8DFE7' }}
                  labelStyle={{ fontFamily: 'IBM Plex Mono' }}
                />
                <Area
                  type="monotone"
                  dataKey="avgScore"
                  stroke="#5B4BD6"
                  strokeWidth={2}
                  fill="url(#fill)"
                  name="Avg score"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card
          title="What is driving alerts"
          subtitle="How often each rule fires, and how much it moves the score"
        >
          {sample.isLoading ? (
            <Skeleton rows={5} />
          ) : (
            <RuleFrequency transactions={rows} />
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

/**
 * Which rules are actually carrying the alert queue.
 *
 * A rule that fires on most traffic contributes weight without contributing
 * information, and it is the usual cause of alert fatigue — analysts stop
 * reading a queue where everything looks the same. Showing fire rate alongside
 * the average score when it fires makes that visible: a rule high on the left
 * and low on the right is a rule worth re-tuning.
 */
function RuleFrequency({ transactions = [] }) {
  const total = transactions.length;

  if (!total)
    return (
      <div className="px-2 py-12 text-center">
        <p className="font-display text-sm font-semibold">No transactions to analyse</p>
        <p className="mx-auto mt-1 max-w-xs text-sm text-slate1">
          Seed the ledger or run the simulator, and rule activity will appear here.
        </p>
      </div>
    );

  const codes = Object.keys(RULE_CATALOG);
  const summary = codes
    .map((code) => {
      const hits = transactions.filter((t) => (t.flags || []).some((f) => (f.code ?? f) === code));
      const avgScore = hits.length
        ? hits.reduce((s, t) => s + t.finalScore, 0) / hits.length
        : 0;
      return {
        code,
        label: RULE_CATALOG[code].label,
        count: hits.length,
        rate: hits.length / total,
        avgScore,
      };
    })
    .filter((r) => r.count > 0)
    .sort((a, b) => b.rate - a.rate);

  if (!summary.length)
    return (
      <p className="px-1 py-8 text-center text-sm text-slate1">
        No rules fired across the last {total} transactions.
      </p>
    );

  const noisiest = summary[0];

  return (
    <div>
      <ul className="space-y-3">
        {summary.map((r) => (
          <li key={r.code}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-xs text-ink" title={r.label}>
                {r.label}
              </span>
              <span className="num shrink-0 text-xs text-slate1">
                {Math.round(r.rate * 100)}%
                <span className="mx-1.5 text-line">·</span>
                <span style={{ color: bandFor(r.avgScore).color }}>
                  avg {Math.round(r.avgScore)}
                </span>
              </span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-sm bg-paper">
              <div
                className="h-full rounded-sm transition-[width] duration-500"
                style={{
                  width: `${Math.max(2, r.rate * 100)}%`,
                  backgroundColor: bandFor(r.avgScore).color,
                  opacity: 0.85,
                }}
              />
            </div>
          </li>
        ))}
      </ul>

      <p className="mt-4 border-t border-line pt-3 text-[11px] leading-relaxed text-slate1">
        Bar length is how often the rule fires; colour is the average risk score when it does.
        {noisiest.rate > 0.5 && (
          <>
            {' '}
            <span className="text-ink">{noisiest.label}</span> fires on{' '}
            <span className="num">{Math.round(noisiest.rate * 100)}%</span> of traffic — a rule that
            common adds weight without adding information, and is where alert fatigue starts.
          </>
        )}
      </p>
    </div>
  );
}

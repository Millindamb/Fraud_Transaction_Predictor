import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { getTransaction } from '../api/transactions';
import PageHeader from '../components/layout/PageHeader';
import { Card, ErrorNote, Skeleton } from '../components/ui/Primitives';
import StatusPill from '../components/ui/StatusPill';
import RiskStrip from '../components/risk/RiskStrip';
import ScoreFusion from '../components/risk/ScoreFusion';
import RuleFlags from '../components/risk/RuleFlags';
import ShapTape from '../components/risk/ShapTape';
import { bandFor, RULE_CATALOG } from '../lib/risk';
import { inr, stamp } from '../lib/format';

export default function TransactionDetail() {
  const { id } = useParams();
  const { data: tx, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['transaction', id],
    queryFn: () => getTransaction(id),
  });

  if (isLoading) return <Skeleton rows={10} />;
  if (isError) return <Card><ErrorNote error={error} onRetry={refetch} /></Card>;

  const band = bandFor(tx.finalScore);

  return (
    <>
      <Link
        to="/transactions"
        className="focusable mb-3 inline-flex items-center gap-1.5 text-xs text-slate1 hover:text-ink"
      >
        <ArrowLeft size={13} /> Back to ledger
      </Link>

      <PageHeader
        eyebrow={stamp(tx.timestamp)}
        title={tx.transactionId}
        description={`${inr(tx.amount)} at ${tx.merchant?.name || 'unknown merchant'} · ${tx.location?.city || 'unknown location'}`}
        actions={
          <div className="text-right">
            <StatusPill score={tx.finalScore} />
            <p className="mt-1 font-display text-sm font-semibold" style={{ color: band.color }}>
              {band.action}
            </p>
          </div>
        }
      />

      <Card title="Authorisation strip" subtitle="Where each engine landed, and where the fused score sits">
        <RiskStrip ruleScore={tx.ruleScore} mlScore={tx.mlScore} finalScore={tx.finalScore} />
        <div className="mt-5 border-t border-line pt-5">
          <ScoreFusion
            ruleScore={tx.ruleScore}
            mlScore={tx.mlScore}
            finalScore={tx.finalScore}
            weights={tx.fusion?.weights || { rule: 0.4, ml: 0.6 }}
            strategy={tx.fusion?.strategy}
          />
        </div>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Rules that fired" subtitle={`${tx.flags?.length || 0} of ${Object.keys(RULE_CATALOG).length} checks triggered`}>
          <RuleFlags flags={tx.flags} showPassed allRuleIds={Object.keys(RULE_CATALOG)} />
        </Card>

        <Card
          title="Model explanation"
          subtitle={`${tx.model?.name || 'Ensemble'} · confidence ${Math.round((tx.model?.confidence ?? 0) * 100)}%`}
        >
          <ShapTape contributions={tx.explanation?.contributions} />
          {tx.explanation?.baseValue != null && (
            <p className="num mt-4 border-t border-line pt-3 text-xs text-slate1">
              Base rate {tx.explanation.baseValue.toFixed(2)} · contributions sum to{' '}
              {tx.mlScore != null ? (tx.mlScore / 100).toFixed(2) : '—'}
            </p>
          )}
        </Card>
      </div>

      <Card className="mt-4" title="Transaction record" subtitle="Fields the pipeline received">
        <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          <Detail label="Card" value={tx.card?.masked} />
          <Detail label="Cardholder" value={tx.cardholder?.name} />
          <Detail label="Merchant" value={tx.merchant?.name} />
          <Detail label="Merchant category" value={tx.merchant?.category} />
          <Detail label="Terminal" value={tx.device?.terminalId} />
          <Detail label="Entry mode" value={tx.device?.entryMode} />
          <Detail label="City" value={tx.location?.city} />
          <Detail label="Country" value={tx.location?.country} />
          <Detail
            label="Coordinates"
            value={
              tx.location?.lat != null ? `${tx.location.lat.toFixed(4)}, ${tx.location.lng.toFixed(4)}` : '—'
            }
          />
        </dl>
      </Card>
    </>
  );
}

function Detail({ label, value }) {
  return (
    <div>
      <dt className="eyebrow">{label}</dt>
      <dd className="num mt-0.5 text-sm">{value || '—'}</dd>
    </div>
  );
}

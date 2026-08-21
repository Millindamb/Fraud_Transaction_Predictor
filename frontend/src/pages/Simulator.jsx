import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { scoreTransaction } from '../api/transactions';
import PageHeader from '../components/layout/PageHeader';
import { Button, Card, ErrorNote, Field, Input, Select } from '../components/ui/Primitives';
import RiskStrip from '../components/risk/RiskStrip';
import ScoreFusion from '../components/risk/ScoreFusion';
import RuleFlags from '../components/risk/RuleFlags';
import ShapTape from '../components/risk/ShapTape';
import StatusPill from '../components/ui/StatusPill';
import { bandFor } from '../lib/risk';

const PRESET = {
  amount: 82000,
  hour: 3,
  merchantCategory: 'ELECTRONICS',
  city: 'Delhi',
  homeCity: 'Pune',
  entryMode: 'CHIP',
  cardId: 'CARD-4471',
};

export default function Simulator() {
  const [form, setForm] = useState(PRESET);
  const score = useMutation({ mutationFn: scoreTransaction });
  const set = (k) => (e) =>
    setForm((f) => ({ ...f, [k]: e.target.type === 'number' ? Number(e.target.value) : e.target.value }));

  const result = score.data;

  return (
    <>
      <PageHeader
        eyebrow="Testing"
        title="Score a transaction"
        description="Send a synthetic authorisation through the live pipeline to see how the rules and model react. Nothing is written to the ledger."
      />

      <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">
        <Card title="Transaction input">
          <div className="space-y-3.5">
            <Field label="Amount (₹)">
              <Input type="number" value={form.amount} onChange={set('amount')} />
            </Field>
            <Field label="Hour of day" hint="24-hour clock, local to the terminal">
              <Input type="number" min="0" max="23" value={form.hour} onChange={set('hour')} />
            </Field>
            <Field label="Merchant category">
              <Select value={form.merchantCategory} onChange={set('merchantCategory')}>
                {['ELECTRONICS', 'GROCERY', 'FUEL', 'JEWELLERY', 'TRAVEL', 'RESTAURANT'].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            </Field>
            <Field label="Transaction city">
              <Input value={form.city} onChange={set('city')} />
            </Field>
            <Field label="Cardholder home city">
              <Input value={form.homeCity} onChange={set('homeCity')} />
            </Field>
            <Field label="Entry mode">
              <Select value={form.entryMode} onChange={set('entryMode')}>
                {['CHIP', 'SWIPE', 'CONTACTLESS', 'MANUAL'].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            </Field>

            <div className="flex gap-2 pt-1">
              <Button className="flex-1" busy={score.isPending} onClick={() => score.mutate(form)}>
                Run scoring
              </Button>
              <Button variant="ghost" onClick={() => { setForm(PRESET); score.reset(); }}>
                Reset
              </Button>
            </div>
          </div>
        </Card>

        <div className="space-y-4">
          {score.isError && <Card><ErrorNote error={score.error} /></Card>}

          {!result ? (
            <Card>
              <div className="px-2 py-16 text-center">
                <p className="font-display text-sm font-semibold">No result yet</p>
                <p className="mt-1 text-sm text-slate1">
                  Adjust the fields and run scoring to see the strip, the rules that fired, and the
                  model's reasoning.
                </p>
              </div>
            </Card>
          ) : (
            <>
              <Card
                title="Result"
                right={
                  <div className="flex items-center gap-2">
                    <StatusPill score={result.finalScore} />
                    <span
                      className="font-display text-sm font-semibold"
                      style={{ color: bandFor(result.finalScore).color }}
                    >
                      {bandFor(result.finalScore).action}
                    </span>
                  </div>
                }
              >
                <RiskStrip
                  ruleScore={result.ruleScore}
                  mlScore={result.mlScore}
                  finalScore={result.finalScore}
                />
                <div className="mt-5 border-t border-line pt-5">
                  <ScoreFusion
                    ruleScore={result.ruleScore}
                    mlScore={result.mlScore}
                    finalScore={result.finalScore}
                    weights={result.fusion?.weights || { rule: 0.4, ml: 0.6 }}
                    strategy={result.fusion?.strategy}
                  />
                </div>
              </Card>

              <div className="grid gap-4 md:grid-cols-2">
                <Card title="Rules that fired">
                  <RuleFlags flags={result.flags} />
                </Card>
                <Card title="Model explanation">
                  <ShapTape contributions={result.explanation?.contributions} />
                </Card>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { scoreTransaction } from '../api/transactions';
import PageHeader from '../components/layout/PageHeader';
import { Button, Card, ErrorNote, Field, Input, Select } from '../components/ui/Primitives';
import RiskStrip from '../components/risk/RiskStrip';
import ScoreFusion from '../components/risk/ScoreFusion';
import RuleFlags from '../components/risk/RuleFlags';
import ShapTape from '../components/risk/ShapTape';
import VerdictBanner from '../components/risk/VerdictBanner';
import EscalationTrail from '../components/risk/EscalationTrail';
import VerificationPanel from '../components/risk/VerificationPanel';

const PRESET = {
  amount: 82000,
  hour: 3,
  merchantCategory: 'ELECTRONICS',
  city: 'Delhi',
  homeCity: 'Pune',
  entryMode: 'CHIP',
  velocityLast24h: 2,
  cardholderAge: 41,
  cardId: 'CARD-4471',
};

// One card's day, told in order. Each step carries every signal before it, so
// the sequence is cumulative rather than six unrelated tests. The times are the
// story: a routine morning purchase and a 3am keyed-in charge abroad are the
// same card, and the risk between them is what the system exists to notice.
const LADDER = [
  {
    time: '09:14',
    label: 'Groceries near home',
    note: '₹4,500, chip read, Pune. The kind of purchase this card makes every week.',
    // cardId is cleared deliberately. With a card set, the location rule measures
    // distance from that card's last stored transaction rather than the home city,
    // so results would depend on whatever was persisted earlier.
    patch: { amount: 4500, hour: 14, merchantCategory: 'GROCERY', city: 'Pune', homeCity: 'Pune', entryMode: 'CHIP', velocityLast24h: 1, cardId: '' },
  },
  {
    time: '14:02',
    label: 'Same card, different city',
    note: 'Now in Delhi. People travel — on its own this means very little.',
    patch: { city: 'Delhi' },
  },
  {
    time: '14:05',
    label: 'Card number keyed in by hand',
    note: 'The chip was not read. A cloned card cannot fake a chip; a written-down number needs no card at all.',
    patch: { entryMode: 'MANUAL' },
  },
  {
    time: '03:11',
    label: 'And again, at three in the morning',
    note: 'This is the hour fraud lives in. Legitimate traffic averages 11am; fraud averages 3:48am.',
    patch: { hour: 3 },
  },
  {
    time: '03:12',
    label: 'Now the terminal is abroad',
    note: 'Dubai, one minute later. No one crosses that distance in a minute.',
    patch: { city: 'Dubai' },
  },
  {
    time: '03:20',
    label: 'Ninth attempt today',
    note: 'Someone is working through a card, not shopping with it.',
    patch: { velocityLast24h: 9 },
  },
];

// A second story, and the more interesting one. The first shows a system
// catching fraud; this shows it *not* catching a customer. A ₹1,20,000 laptop on
// a card that normally spends ₹3,000 is genuinely anomalous and should score
// high — the question is what happens next.
const VERIFY_STORY = [
  {
    time: '20:41',
    label: 'A ₹1,20,000 laptop',
    note: 'This card usually spends ₹1,000–5,000. Forty times the normal basket, in a category never used.',
    patch: { amount: 120000, hour: 20, merchantCategory: 'ELECTRONICS', city: 'Pune', homeCity: 'Pune', entryMode: 'CHIP', velocityLast24h: 1, cardId: '', biometric: 'not_sent', deviceKnown: undefined, blacklistHit: false },
  },
  {
    time: '20:41',
    label: 'Same phone, same home network',
    note: 'Device fingerprint and IP both match every previous purchase on this card.',
    patch: { deviceKnown: true },
  },
  {
    time: '20:41',
    label: 'Approved by fingerprint, in nine seconds',
    note: 'A push notification asked the cardholder directly. They confirmed with a biometric on their registered phone.',
    patch: { biometric: 'approved' },
  },
  {
    time: '—',
    label: 'But the card is on the blocklist',
    note: 'Reported compromised this morning. Nothing overrides this — not a fingerprint, not a familiar device.',
    patch: { blacklistHit: true },
  },
];

// A second, separate pair. Both are otherwise clean transactions, differing only
// in how many times the card was used today. The model barely reacts — it learned
// from data where velocity separates the classes weakly. The rule engine fires
// anyway, because a bank has policy reasons to look at a card used twelve times
// in a day whether or not the model finds it predictive.
const VELOCITY_PAIR = [
  { label: 'Normal use', patch: { amount: 4500, hour: 14, merchantCategory: 'GROCERY', city: 'Pune', homeCity: 'Pune', entryMode: 'CHIP', velocityLast24h: 2, cardId: '' } },
  { label: 'Velocity burst', patch: { amount: 4500, hour: 14, merchantCategory: 'GROCERY', city: 'Pune', homeCity: 'Pune', entryMode: 'CHIP', velocityLast24h: 12, cardId: '' } },
];

export default function Simulator() {
  const [form, setForm] = useState(PRESET);
  const [persist, setPersist] = useState(false);
  // Which signals from the walkthrough are switched on. Step 0 is the baseline
  // purchase and is always applied, so it is never in this set.
  const [selected, setSelected] = useState(new Set());
  const [verifySelected, setVerifySelected] = useState(new Set());
  // Which walkthrough produced the result on screen. Without this both
  // stories show the same footer score, implying each ran when only one did.
  const [activeStory, setActiveStory] = useState(null);
  const score = useMutation({ mutationFn: scoreTransaction });

  // Baseline plus whichever signals are switched on, applied in story order so a
  // later step always overrides an earlier one on the same field.
  const composeFrom = (set) =>
    LADDER.reduce(
      (acc, step, i) => (i === 0 || set.has(i) ? { ...acc, ...step.patch } : acc),
      { ...PRESET }
    );

  const applySelection = (set) => {
    setSelected(set);
    setActiveStory('ladder');
    const next = composeFrom(set);
    setForm(next);
    score.mutate({ ...next, persist });
  };

  const toggleSignal = (i) => {
    const next = new Set(selected);
    next.has(i) ? next.delete(i) : next.add(i);
    setVerifySelected(new Set());
    applySelection(next);
  };

  const applyVerifySelection = (set) => {
    setVerifySelected(set);
    setSelected(new Set());
    setActiveStory('verify');
    const next = VERIFY_STORY.reduce(
      (acc, step, i) => (i === 0 || set.has(i) ? { ...acc, ...step.patch } : acc),
      { ...PRESET }
    );
    setForm(next);
    score.mutate({ ...next, persist });
  };

  const toggleVerify = (i) => {
    const next = new Set(verifySelected);
    next.has(i) ? next.delete(i) : next.add(i);
    applyVerifySelection(next);
  };
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

      <div className="grid gap-4 lg:grid-cols-[17rem_minmax(0,1fr)] xl:grid-cols-[17rem_minmax(0,1fr)_17rem]">
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
            <Field label="Entry mode" hint="Determines the device trust score the model sees">
              <Select value={form.entryMode} onChange={set('entryMode')}>
                {['CHIP', 'SWIPE', 'CONTACTLESS', 'MANUAL'].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            </Field>
            <Field label="Transactions in last 24h" hint="The model's third-strongest signal">
              <Input
                type="number"
                min="0"
                max="50"
                value={form.velocityLast24h}
                onChange={set('velocityLast24h')}
              />
            </Field>
            <Field label="Cardholder age">
              <Input
                type="number"
                min="18"
                max="120"
                value={form.cardholderAge}
                onChange={set('cardholderAge')}
              />
            </Field>


            <label className="flex items-start gap-2 border-t border-line pt-3">
              <input
                type="checkbox"
                className="focusable mt-0.5 h-4 w-4 accent-[#5B4BD6]"
                checked={persist}
                onChange={(e) => setPersist(e.target.checked)}
              />
              <span className="text-xs text-slate1">
                Write to the ledger
                <span className="mt-0.5 block">
                  Off by default so testing does not distort the ledger or the alert queue. Turn it
                  on to follow this transaction through the full pipeline.
                </span>
              </span>
            </label>

            <div className="flex gap-2 pt-1">
              <Button className="flex-1" busy={score.isPending} onClick={() => { setActiveStory(null); score.mutate({ ...form, persist }); }}>
                Run scoring
              </Button>
              <Button variant="ghost" onClick={() => { setForm(PRESET); score.reset(); setSelected(new Set()); setVerifySelected(new Set()); setActiveStory(null); }}>
                Reset
              </Button>
            </div>
          </div>
        </Card>

        <div className="space-y-4">
          {score.isError && <Card><ErrorNote error={score.error} /></Card>}

          {!result ? (
            <Card>
              <div className="px-6 py-20 text-center">
                <p className="font-display text-base font-semibold">Nothing scored yet</p>
                <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-slate1">
                  Run the demo ladder to watch a routine purchase turn into fraud one signal at a
                  time, or set the fields yourself and run scoring.
                </p>
              </div>
            </Card>
          ) : (
            <>
              {result.transactionId && result._id && (
                <div className="card flex flex-wrap items-center justify-between gap-3 p-3.5">
                  <p className="text-sm">
                    Written to the ledger as{' '}
                    <span className="num font-medium">{result.transactionId}</span>
                    {['ALERT', 'BLOCK'].includes(result.decision) && ' — an alert was raised'}
                  </p>
                  <div className="flex gap-2">
                    <Link
                      to={`/transactions/${result.transactionId}`}
                      className="focusable rounded-md border border-line px-2.5 py-1.5 text-xs hover:bg-paper"
                    >
                      Open in ledger
                    </Link>
                    {['ALERT', 'BLOCK'].includes(result.decision) && (
                      <Link
                        to="/alerts"
                        className="focusable rounded-md border border-line px-2.5 py-1.5 text-xs hover:bg-paper"
                      >
                        View alert queue
                      </Link>
                    )}
                  </div>
                </div>
              )}

              <VerdictBanner result={result} />

              {result.verification?.applied?.length > 0 && (
                <VerificationPanel
                  before={result.preVerificationScore ?? result.finalScore}
                  after={result.finalScore}
                  applied={result.verification.applied}
                  overridden={result.verification.overridden}
                />
              )}

              <Card
                title="How the score was reached"
                subtitle="Where each engine landed, and where the fused score sits"
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
                    blended={result.fusion?.blended}
                    floors={result.fusion?.floors}
                  />
                </div>
              </Card>

              <div className="grid gap-4 lg:grid-cols-2">
                <Card title="Rules that fired">
                  <RuleFlags flags={result.flags} />
                </Card>
                <Card title="Model explanation">
                  <ShapTape contributions={result.explanation?.contributions} />
                  {result.model?.name && (
                    <p className="mt-3 border-t border-line pt-2.5 text-[11px] text-slate1">
                      {result.model.name}
                      {result.model.source === 'fallback' || result.model.source === 'fallback-degraded'
                        ? ' — fallback scorer, the trained model was unreachable'
                        : ' — trained model'}
                    </p>
                  )}
                </Card>
              </div>
            </>
          )}
        </div>
        {/* Right rail: the scripted walkthroughs. Kept out of the input card so
            the form stays a form and the narrative reads as its own thing. */}
        <aside className="space-y-4 xl:sticky xl:top-6 xl:max-h-[calc(100vh-3rem)] xl:self-start xl:overflow-y-auto xl:pr-1 xl:[scrollbar-width:thin]">
          <Card bodyClass="p-4">
            <p className="eyebrow">One card, one day</p>
            <p className="mt-1 text-xs leading-relaxed text-slate1">
              Six moments on the same card. Switch any of them on or off and watch where the risk
              turns.
            </p>

            <div className="mt-2.5 flex gap-1.5">
              <button
                onClick={() => applySelection(new Set(LADDER.map((_, i) => i).slice(1)))}
                disabled={score.isPending}
                className="focusable flex-1 rounded-md border border-line px-2 py-1.5 text-[11px] hover:bg-paper disabled:opacity-50"
              >
                Select all
              </button>
              <button
                onClick={() => applySelection(new Set())}
                disabled={score.isPending}
                className="focusable flex-1 rounded-md border border-line px-2 py-1.5 text-[11px] hover:bg-paper disabled:opacity-50"
              >
                Clear all
              </button>
            </div>

            <div className="mt-3">
              <EscalationTrail
                steps={LADDER}
                selected={selected}
                score={activeStory === 'ladder' ? result?.finalScore : null}
                onToggle={toggleSignal}
                disabled={score.isPending}
              />
            </div>
          </Card>

          <Card bodyClass="p-4">
            <p className="eyebrow">When the customer is real</p>
            <p className="mt-1 text-xs leading-relaxed text-slate1">
              An unusual purchase that is not fraud. Watch what clears it, and what refuses to be
              cleared.
            </p>
            <div className="mt-3">
              <EscalationTrail
                steps={VERIFY_STORY}
                selected={verifySelected}
                score={activeStory === 'verify' ? result?.finalScore : null}
                onToggle={toggleVerify}
                disabled={score.isPending}
              />
            </div>
          </Card>

          <Card bodyClass="p-4">
            <p className="eyebrow">Where the engines disagree</p>
            <p className="mt-1 text-xs text-slate1">
              Same transaction, different card usage today. Watch the rule score move while the
              model stays put.
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {VELOCITY_PAIR.map((step) => (
                <button
                  key={step.label}
                  onClick={() => {
                    const next = { ...PRESET, ...step.patch };
                    setForm(next);
                    setActiveStep(null);
                    score.mutate({ ...next, persist });
                  }}
                  className="focusable rounded-md border border-line px-2 py-1 text-[11px] hover:bg-paper"
                >
                  {step.label}
                </button>
              ))}
            </div>
          </Card>
        </aside>

      </div>
    </>
  );
}
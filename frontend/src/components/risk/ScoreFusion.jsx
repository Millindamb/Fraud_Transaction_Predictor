import { bandFor } from '../../lib/risk';

/** Shows how the two engines were weighted into one number — no black box. */
export default function ScoreFusion({ ruleScore, mlScore, finalScore, weights = { rule: 0.4, ml: 0.6 }, strategy = 'weighted' }) {
  const band = bandFor(finalScore);
  return (
    <div className="grid grid-cols-[1fr_auto_1fr_auto_1.2fr] items-center gap-3 text-center">
      <Leg label="Rule score" value={ruleScore} weight={weights.rule} color="#16794F" />
      <span className="font-display text-lg text-slate1">+</span>
      <Leg label="Model score" value={mlScore} weight={weights.ml} color="#5B4BD6" />
      <span className="font-display text-lg text-slate1">=</span>
      <div>
        <p className="eyebrow">Final risk score</p>
        <p className="num mt-1 text-3xl font-semibold" style={{ color: band.color }}>
          {Math.round(finalScore)}
        </p>
        <p className="text-[11px] text-slate1">
          {strategy === 'max' ? 'highest of the two' : 'weighted blend'}
        </p>
      </div>
    </div>
  );
}

function Leg({ label, value, weight, color }) {
  return (
    <div>
      <p className="eyebrow">{label}</p>
      <p className="num mt-1 text-2xl font-semibold" style={{ color }}>
        {Math.round(value)}
      </p>
      <p className="num text-[11px] text-slate1">× {weight.toFixed(2)}</p>
    </div>
  );
}

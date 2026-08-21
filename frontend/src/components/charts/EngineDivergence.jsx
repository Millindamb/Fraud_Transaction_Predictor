import {
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts';
import { bandFor } from '../../lib/risk';
import { inr } from '../../lib/format';

/**
 * Every scored transaction plotted by what each engine thought of it.
 *
 * The diagonal is agreement. What matters is the distance from it: a point high
 * on the model axis but low on the rules axis is a pattern the model learned
 * that nobody wrote a rule for. A point high on the rules axis but low on the
 * model axis is a policy the bank enforces regardless of what the data says.
 *
 * If every point sat on the diagonal, one of the two engines would be redundant.
 * This chart is the evidence that they are not.
 */
export default function EngineDivergence({ transactions = [] }) {
  const points = transactions.map((t) => ({
    rule: t.ruleScore,
    model: t.mlScore,
    final: t.finalScore,
    amount: t.amount,
    id: t.transactionId,
    fill: bandFor(t.finalScore).color,
  }));

  const disagreements = points.filter((p) => Math.abs(p.rule - p.model) > 40).length;
  const share = points.length ? Math.round((disagreements / points.length) * 100) : 0;

  return (
    <div>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 8, right: 12, bottom: 22, left: 4 }}>
            <CartesianGrid stroke="#D8DFE7" strokeDasharray="2 4" />
            <XAxis
              type="number"
              dataKey="rule"
              domain={[0, 100]}
              tick={{ fontSize: 11, fill: '#5A6B7C' }}
              tickLine={false}
              axisLine={{ stroke: '#D8DFE7' }}
              label={{
                value: 'Rule score',
                position: 'insideBottom',
                offset: -12,
                style: { fontSize: 11, fill: '#5A6B7C' },
              }}
            />
            <YAxis
              type="number"
              dataKey="model"
              domain={[0, 100]}
              tick={{ fontSize: 11, fill: '#5A6B7C' }}
              tickLine={false}
              axisLine={{ stroke: '#D8DFE7' }}
              width={34}
              label={{
                value: 'Model score',
                angle: -90,
                position: 'insideLeft',
                style: { fontSize: 11, fill: '#5A6B7C' },
              }}
            />
            <ZAxis range={[26, 26]} />
            {/* The line of agreement */}
            <ReferenceLine
              segment={[
                { x: 0, y: 0 },
                { x: 100, y: 100 },
              ]}
              stroke="#0E1726"
              strokeDasharray="4 4"
              strokeOpacity={0.35}
            />
            <Tooltip
              cursor={{ strokeDasharray: '3 3' }}
              contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #D8DFE7' }}
              content={({ payload }) => {
                const p = payload?.[0]?.payload;
                if (!p) return null;
                return (
                  <div className="rounded-md border border-line bg-white px-3 py-2 text-xs shadow-card">
                    <p className="num font-medium">{p.id}</p>
                    <p className="num mt-1 text-slate1">{inr(p.amount)}</p>
                    <p className="num mt-1">
                      rules {Math.round(p.rule)} · model {Math.round(p.model)} · final{' '}
                      <span style={{ color: p.fill }}>{Math.round(p.final)}</span>
                    </p>
                  </div>
                );
              }}
            />
            <Scatter data={points} fillOpacity={0.72} />
          </ScatterChart>
        </ResponsiveContainer>
      </div>

      <p className="mt-3 border-t border-line pt-3 text-xs leading-relaxed text-slate1">
        The dashed line is agreement. <span className="num text-ink">{share}%</span> of
        transactions sit more than 40 points away from it — cases where one engine saw something
        the other did not. Points above the line are patterns the model learned that no rule
        describes; points below are policy the bank enforces regardless of the data.
      </p>
    </div>
  );
}
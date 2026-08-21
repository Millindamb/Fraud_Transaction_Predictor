import { BANDS, bandFor } from '../../lib/risk';

/**
 * Signature element: the authorisation strip.
 * One 0–100 scale showing where the rule engine landed, where the model landed,
 * and where the fused score finally sits. Reading left to right tells the whole
 * story of a decision without a single sentence of prose.
 */
export default function RiskStrip({ ruleScore = 0, mlScore = 0, finalScore = 0, height = 118 }) {
  const W = 720;
  const trackY = 62;
  const trackH = 16;
  const x = (v) => (Math.max(0, Math.min(100, v)) / 100) * W;
  const band = bandFor(finalScore);

  return (
    <svg viewBox={`0 0 ${W} ${height}`} className="w-full" role="img"
      aria-label={`Final risk score ${finalScore} of 100, ${band.label}`}>
      {/* band segments */}
      {BANDS.map((b) => {
        const start = x(b.min);
        const end = x(b.max + 1);
        return (
          <g key={b.key}>
            <rect
              x={start}
              y={trackY}
              width={Math.max(0, end - start - 2)}
              height={trackH}
              rx={2}
              fill={b.color}
              opacity={b.key === band.key ? 0.95 : 0.16}
            />
            <text
              x={start}
              y={trackY + trackH + 15}
              fontSize="10"
              fontFamily="IBM Plex Mono, monospace"
              fill="#5A6B7C"
            >
              {b.min}
            </text>
            <text
              x={start}
              y={trackY + trackH + 28}
              fontSize="9.5"
              fontFamily="Archivo, sans-serif"
              fontWeight="600"
              letterSpacing="0.06em"
              fill={b.key === band.key ? b.color : '#8A97A6'}
            >
              {b.action.toUpperCase()}
            </text>
          </g>
        );
      })}

      {/* engine ticks above the track */}
      <EngineTick x={x(ruleScore)} label="RULES" value={ruleScore} color="#16794F" y={26} />
      <EngineTick x={x(mlScore)} label="MODEL" value={mlScore} color="#5B4BD6" y={44} />

      {/* fused needle */}
      <g className="tick-in">
        <line
          x1={x(finalScore)}
          x2={x(finalScore)}
          y1={trackY - 6}
          y2={trackY + trackH + 6}
          stroke="#0E1726"
          strokeWidth="2.5"
        />
        <polygon
          points={`${x(finalScore) - 5},${trackY - 12} ${x(finalScore) + 5},${trackY - 12} ${x(finalScore)},${trackY - 5}`}
          fill="#0E1726"
        />
      </g>
    </svg>
  );
}

function EngineTick({ x, label, value, color, y }) {
  const flip = x > 620;
  return (
    <g>
      <line x1={x} x2={x} y1={y + 4} y2={56} stroke={color} strokeWidth="1" strokeDasharray="2 3" />
      <circle cx={x} cy={y} r="3" fill={color} />
      <text
        x={flip ? x - 8 : x + 8}
        y={y + 4}
        textAnchor={flip ? 'end' : 'start'}
        fontSize="10.5"
        fontFamily="IBM Plex Mono, monospace"
        fill={color}
      >
        {label} {String(Math.round(value)).padStart(2, '0')}
      </text>
    </g>
  );
}

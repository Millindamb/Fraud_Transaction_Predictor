import env from '../config/env.js';
import { buildFeatures } from './featureBuilder.js';
import { evaluateRules } from './ruleEngine.js';
import { predict } from './mlClient.js';

export function bandFor(score) {
  if (score <= env.BAND_LOW_MAX) return { band: 'LOW', decision: 'APPROVE' };
  if (score <= env.BAND_MEDIUM_MAX) return { band: 'MEDIUM', decision: 'MONITOR' };
  if (score <= env.BAND_HIGH_MAX) return { band: 'HIGH', decision: 'ALERT' };
  return { band: 'CRITICAL', decision: 'BLOCK' };
}

export function fuse(ruleScore, mlScore) {
  const weights = { rule: env.FUSION_RULE_WEIGHT, ml: env.FUSION_ML_WEIGHT };

  if (env.FUSION_STRATEGY === 'max') {
    return { finalScore: Math.max(ruleScore, mlScore), strategy: 'max', weights };
  }

  const total = weights.rule + weights.ml || 1;
  const blended = (ruleScore * weights.rule + mlScore * weights.ml) / total;

  // Guardrail: a hard rule hit must never be averaged away into an approval.
  // Without this, one confident engine gets buried by a quiet one.
  const floor = ruleScore >= 90 ? env.BAND_HIGH_MAX + 1 : 0;

  return {
    finalScore: Math.round(Math.max(blended, floor)),
    strategy: 'weighted',
    weights,
  };
}

/** The full pipeline: features → rules ∥ model → fusion → decision. */
export async function scoreTransaction(raw) {
  const startedAt = Date.now();

  const features = await buildFeatures(raw);
  const [{ flags, ruleScore }, ml] = await Promise.all([
    evaluateRules(features),
    predict(features),
  ]);

  const fusion = fuse(ruleScore, ml.mlScore);
  const { band, decision } = bandFor(fusion.finalScore);

  return {
    ruleScore,
    mlScore: ml.mlScore,
    finalScore: fusion.finalScore,
    fusion: { strategy: fusion.strategy, weights: fusion.weights },
    band,
    decision,
    flags,
    model: ml.model,
    explanation: ml.explanation,
    features,
    latencyMs: Date.now() - startedAt,
  };
}

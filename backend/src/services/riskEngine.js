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

export function fuse(ruleScore, mlScore, features = {}) {
  const weights = { rule: env.FUSION_RULE_WEIGHT, ml: env.FUSION_ML_WEIGHT };

  if (env.FUSION_STRATEGY === 'max') {
    return { finalScore: Math.max(ruleScore, mlScore), strategy: 'max', weights, floors: [] };
  }

  const total = weights.rule + weights.ml || 1;
  const blended = (ruleScore * weights.rule + mlScore * weights.ml) / total;

  // Guardrails. A weighted blend will otherwise let one confident engine be
  // averaged away by a quiet one, which is the specific failure mode blending
  // introduces. Each floor is recorded so the UI can show which one applied
  // rather than presenting an unexplained jump.
  const floors = [];

  if (ruleScore >= 85) floors.push({ reason: 'Rule score at or above 85', floor: 81 });
  else if (ruleScore >= 65) floors.push({ reason: 'Rule score at or above 65', floor: 61 });

  if (mlScore >= 85) floors.push({ reason: 'Model score at or above 85', floor: 81 });

  // Two or more independent rules firing is itself evidence, regardless of the
  // arithmetic. A single signal can be a coincidence; three rarely are.
  const flagCount = features.flagCount ?? 0;
  if (flagCount >= 3) floors.push({ reason: 'Three or more rules fired', floor: 61 });

  const applied = floors.reduce((max, f) => Math.max(max, f.floor), 0);
  const finalScore = Math.round(Math.max(blended, applied));

  return {
    finalScore,
    strategy: 'weighted',
    weights,
    blended: Math.round(blended),
    floors: applied > blended ? floors.filter((f) => f.floor === applied) : [],
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

  const fusion = fuse(ruleScore, ml.mlScore, { flagCount: flags.length });
  const { band, decision } = bandFor(fusion.finalScore);

  return {
    ruleScore,
    mlScore: ml.mlScore,
    finalScore: fusion.finalScore,
    fusion: {
      strategy: fusion.strategy,
      weights: fusion.weights,
      blended: fusion.blended,
      floors: fusion.floors,
    },
    band,
    decision,
    flags,
    model: ml.model,
    explanation: ml.explanation,
    adapter: ml.adapter || null,
    features,
    latencyMs: Date.now() - startedAt,
  };
}
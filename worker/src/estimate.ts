/**
 * Cost and time estimate for the paid solve, from the reviewed plan.
 * Tokens per call times each model's price, plus a buffer for failed checks and retries.
 * Each project's estimate and its actual cost and time go into the `estimates` table, so
 * these constants can be calibrated from history later.
 */
import { cost, type ModelConfig } from "./models";
import type { Estimate } from "./types";

export interface PlanStep {
  idx: number;
  bucket: string;
  dependsOn: number[];
  estTokens: number;
  maker: ModelConfig;
  checker: ModelConfig;
  /** Title, detail and check, used to spot calculation-heavy steps. */
  text?: string;
}

const SPEC_TOKENS = 1500; // system prompt + spec
const CHECK_OUT_TOKENS = 1500; // checker verdict incl. thinking
const MATH_CHECK_OUT_TOKENS = 4000; // re-doing someone's arithmetic takes far more thinking
const THINKING_FACTOR = 1.5; // maker output includes thinking tokens
const MATH_THINKING_FACTOR = 3; // calculation steps think much longer (plumbing run: ~7k tokens for a 1.5k estimate)
const SECONDS_PER_CALL = 40; // typical latency of a long call on a fast model
const TICK_SECONDS = 5; // queue hand-off between steps

/** Steps that work out numbers: funnels, budgets, forecasts, targets, capacity. */
const MATH = /\b(math|calculat\w*|arithmetic|funnel|forecast\w*|budget\w*|projection\w*|percent\w*|conversion|roi|targets?|capacity|hours|revenue|cost model|pricing model|spreadsheet|recompute\w*)\b|%/i;

export function isMathHeavy(text: string): boolean {
  return MATH.test(text);
}

export function estimate(steps: PlanStep[], finalChecker: ModelConfig, maxRounds: number): Estimate {
  const model = steps.filter((s) => s.bucket === "model");
  const byIdx = new Map(model.map((s) => [s.idx, s]));
  const mathSteps = new Set(model.filter((s) => isMathHeavy(s.text ?? "")).map((s) => s.idx));
  const mathHeavy = mathSteps.size > 0;

  let base = 0;
  for (const s of model) {
    const math = mathSteps.has(s.idx);
    const depTokens = s.dependsOn.reduce((n, d) => n + (byIdx.get(d)?.estTokens ?? 0), 0);
    const makerOut = s.estTokens * (math ? MATH_THINKING_FACTOR : THINKING_FACTOR);
    base += cost(s.maker, SPEC_TOKENS + depTokens, makerOut);
    base += cost(s.checker, SPEC_TOKENS + depTokens + s.estTokens, math ? MATH_CHECK_OUT_TOKENS : CHECK_OUT_TOKENS);
  }
  const allArtifacts = model.reduce((n, s) => n + s.estTokens, 0);
  const finalCost = cost(finalChecker, SPEC_TOKENS + allArtifacts, (mathHeavy ? MATH_CHECK_OUT_TOKENS : CHECK_OUT_TOKENS) * 2);

  // Low: every step passes first time.
  // High: a share of steps need another round. That share grows with the number of steps (more
  // chances for one to fail, and later steps inherit earlier ones' problems) and with
  // calculations (checkers recompute the math and often send it back; a redo is also longer).
  const retryShare = Math.min(1, 0.5 + 0.1 * Math.max(0, maxRounds - 2));
  const spread = retryShare + 0.2 * Math.max(0, model.length - 1) + (mathHeavy ? 0.75 : 0);
  const costLow = base + finalCost;
  const costHigh = base * (1 + spread) + finalCost * (mathHeavy ? 1.5 : 1);

  // Time: each step needs a make and a check; independent steps run in parallel, so the
  // critical path (longest dependency chain) sets the pace.
  const depth = new Map<number, number>();
  const chain = (idx: number, seen = new Set<number>()): number => {
    if (depth.has(idx)) return depth.get(idx)!;
    if (seen.has(idx)) return 1;
    seen.add(idx);
    const s = byIdx.get(idx);
    const d = 1 + Math.max(0, ...(s?.dependsOn ?? []).filter((x) => byIdx.has(x)).map((x) => chain(x, seen)));
    depth.set(idx, d);
    return d;
  };
  const critical = Math.max(0, ...model.map((s) => chain(s.idx)));
  const tick = Math.max(TICK_SECONDS, SECONDS_PER_CALL) * (mathHeavy ? 1.5 : 1);
  const minutesLow = Math.ceil(((critical * 2 + 1) * tick) / 60);
  const minutesHigh = Math.ceil(((critical * 2 * (1 + spread) + 1) * tick) / 60 + model.length * 0.5);

  return {
    costLowUsd: round2(costLow),
    costHighUsd: round2(Math.max(costHigh, costLow + 0.01)),
    minutesLow,
    minutesHigh: Math.max(minutesHigh, minutesLow + 1),
    modelSteps: model.length,
    calls: model.length * 2 + 1,
    mathHeavy,
  };
}

function round2(n: number): number {
  return Math.ceil(n * 100) / 100;
}

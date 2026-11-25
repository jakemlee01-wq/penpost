/**
 * Cost and time estimate for the paid solve, from the reviewed plan.
 * Tokens per call times each model's price, plus a buffer for failed checks and retries.
 * Actual cost and time are logged per project (events table) so later versions can
 * calibrate these constants from history.
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
}

const SPEC_TOKENS = 1500; // system prompt + spec
const CHECK_OUT_TOKENS = 1500; // checker verdict incl. thinking
const THINKING_FACTOR = 1.5; // maker output includes thinking tokens
const SECONDS_PER_CALL = 60; // typical latency of a long model call
const TICK_SECONDS = 60; // the cron advances each project once a minute

export function estimate(steps: PlanStep[], finalChecker: ModelConfig, maxRounds: number): Estimate {
  const model = steps.filter((s) => s.bucket === "model");
  const byIdx = new Map(model.map((s) => [s.idx, s]));
  let base = 0;
  for (const s of model) {
    const depTokens = s.dependsOn.reduce((n, d) => n + (byIdx.get(d)?.estTokens ?? 0), 0);
    const makerOut = s.estTokens * THINKING_FACTOR;
    base += cost(s.maker, SPEC_TOKENS + depTokens, makerOut);
    base += cost(s.checker, SPEC_TOKENS + depTokens + s.estTokens, CHECK_OUT_TOKENS);
  }
  const allArtifacts = model.reduce((n, s) => n + s.estTokens, 0);
  const finalCost = cost(finalChecker, SPEC_TOKENS + allArtifacts, CHECK_OUT_TOKENS * 2);

  // Low: every step passes first time. High: half the steps need one more round, a few need the max.
  const retryShare = Math.min(1, 0.5 + 0.1 * Math.max(0, maxRounds - 2));
  const costLow = base + finalCost;
  const costHigh = base * (1 + retryShare) + finalCost;

  // Time: each step needs a make tick and a check tick; independent steps run in parallel,
  // so the critical path (longest dependency chain) sets the pace.
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
  const tick = Math.max(TICK_SECONDS, SECONDS_PER_CALL);
  const minutesLow = Math.ceil(((critical * 2 + 1) * tick) / 60);
  const minutesHigh = Math.ceil(((critical * 2 * (1 + retryShare) + 1) * tick) / 60 + model.length * 0.5);

  return {
    costLowUsd: round2(costLow),
    costHighUsd: round2(Math.max(costHigh, costLow + 0.01)),
    minutesLow,
    minutesHigh: Math.max(minutesHigh, minutesLow + 1),
    modelSteps: model.length,
    calls: model.length * 2 + 1,
  };
}

function round2(n: number): number {
  return Math.ceil(n * 100) / 100;
}

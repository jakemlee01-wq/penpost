/** Shared test harness: an in-memory D1, a fake queue and scripted models. */
import { expect } from "vitest";
import { advance, approveIntake, createProject, projectView, type Deps } from "../worker/src/engine";
import type { Env } from "../worker/src/env";
import type { ModelCall, ModelConfig } from "../worker/src/models";
import * as P from "../worker/src/prompts";
import { makeD1 } from "./d1";

export type Reply = string | object | ((call: ModelCall, cfg: ModelConfig) => unknown);

/** Scripted models: each action pops its next reply. Records every call. */
export function harness(script: Partial<Record<"intake" | "plan" | "review" | "make" | "check" | "final", Reply[]>>, envOver: Partial<Env> = {}) {
  const calls: { action: string; cfg: ModelConfig; call: ModelCall }[] = [];
  let clock = 1_000_000;
  const sent: { id: string }[] = [];
  const STEPS = {
    send: async (body: { id: string }) => void sent.push(body),
    sendBatch: async (msgs: { body: { id: string } }[]) => void sent.push(...msgs.map((m) => m.body)),
  };
  const env = { DB: makeD1(), STEPS, ACCESS_CODE: "letmein", MAX_ROUNDS: "3", PROJECT_CAP_USD: "5", PREVIEW_CAP_USD: "0.75", ...envOver } as unknown as Env;
  const actionOf = (system: string) =>
    system === P.intake.system ? "intake"
    : system === P.plan.system ? "plan"
    : system === P.planReview.system ? "review"
    : system === P.make.system ? "make"
    : system === P.check.system ? "check"
    : "final";
  const d: Deps = {
    env,
    now: () => (clock += 1000),
    callModel: async (cfg, call) => {
      const action = actionOf(call.system);
      calls.push({ action, cfg, call });
      const queue = script[action as keyof typeof script] ?? [];
      const next = queue.length > 1 ? queue.shift()! : queue[0];
      if (next === undefined) throw new Error(`no scripted reply for ${action}`);
      const out = typeof next === "function" ? (next as (c: ModelCall, m: ModelConfig) => unknown)(call, cfg) : next;
      if (out instanceof Error) throw out;
      clock += 5000; // the call takes 5 seconds
      return { text: typeof out === "string" ? out : JSON.stringify(out), tokensIn: 1000, tokensOut: 500, costUsd: 0.01 };
    },
  };
  /** Move the clock forward, as if time passed with nothing happening. */
  const wait = (ms: number) => void (clock += ms);
  return { d, env, calls, sent, wait };
}

export const INTAKE = { problem: "Need a CSV dedupe script", solution: "A Python script that removes duplicate rows", acceptance: ["Script removes exact duplicate rows", "Usage is documented"] };
export const PLAN = {
  steps: [
    { title: "Write the script", detail: "Python, stdlib only", check: "Removes duplicate rows, keeps order", kind: "build", bucket: "model", depends_on: [], est_tokens: 1500 },
    { title: "Create a GitHub repo", detail: "User creates it", check: "Repo exists", kind: "build", bucket: "user", depends_on: [], est_tokens: 0 },
    { title: "Write the README", detail: "Usage docs", check: "Explains usage with an example", kind: "write", bucket: "model", depends_on: [1, 2], est_tokens: 800 },
  ],
  note: "",
};

export async function toAwaitingStart(h: ReturnType<typeof harness>) {
  const id = await createProject(h.d, "I have CSVs with duplicate rows, I want a script to clean them");
  await advance(h.d, id); // intake
  expect((await projectView(h.d, id)).status).toBe("awaiting_approval");
  await approveIntake(h.d, id);
  await advance(h.d, id); // plan
  await advance(h.d, id); // review
  return id;
}


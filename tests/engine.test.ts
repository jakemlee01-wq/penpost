import { describe, expect, it } from "vitest";
import { advance, approveIntake, createProject, projectView, resume, reviseIntake, startSolve, tick, type Deps } from "../worker/src/engine";
import type { Env } from "../worker/src/env";
import { estimate } from "../worker/src/estimate";
import { handle } from "../worker/src/index";
import { modelConfig, type ModelCall, type ModelConfig } from "../worker/src/models";
import * as P from "../worker/src/prompts";
import { makeD1 } from "./d1";

type Reply = string | object | ((call: ModelCall, cfg: ModelConfig) => unknown);

/** Scripted models: each action pops its next reply. Records every call. */
function harness(script: Partial<Record<"intake" | "plan" | "review" | "make" | "check" | "final", Reply[]>>, envOver: Partial<Env> = {}) {
  const calls: { action: string; cfg: ModelConfig; call: ModelCall }[] = [];
  let clock = 1_000_000;
  const env = { DB: makeD1(), ACCESS_CODE: "letmein", MAX_ROUNDS: "3", PROJECT_CAP_USD: "5", PREVIEW_CAP_USD: "0.75", ...envOver } as Env;
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
  return { d, env, calls };
}

const INTAKE = { problem: "Need a CSV dedupe script", solution: "A Python script that removes duplicate rows", acceptance: ["Script removes exact duplicate rows", "Usage is documented"] };
const PLAN = {
  steps: [
    { title: "Write the script", detail: "Python, stdlib only", check: "Removes duplicate rows, keeps order", kind: "build", bucket: "model", depends_on: [], est_tokens: 1500 },
    { title: "Create a GitHub repo", detail: "User creates it", check: "Repo exists", kind: "build", bucket: "user", depends_on: [], est_tokens: 0 },
    { title: "Write the README", detail: "Usage docs", check: "Explains usage with an example", kind: "write", bucket: "model", depends_on: [1, 2], est_tokens: 800 },
  ],
  note: "",
};

async function toAwaitingStart(h: ReturnType<typeof harness>) {
  const id = await createProject(h.d, "I have CSVs with duplicate rows, I want a script to clean them");
  await advance(h.d, id); // intake
  expect((await projectView(h.d, id)).status).toBe("awaiting_approval");
  await approveIntake(h.d, id);
  await advance(h.d, id); // plan
  await advance(h.d, id); // review
  return id;
}

describe("happy path", () => {
  it("runs intake, plan, review, preview, solve and final check", async () => {
    const h = harness({
      intake: [INTAKE],
      plan: [PLAN],
      review: [{ approved: true, notes: "fine" }],
      make: [
        { artifact: "import csv\n# dedupe v1", notes: "SECRET-MAKER-EXPLANATION trust me it works", needs_human: null },
        { artifact: "# README v1", notes: "first readme", needs_human: null },
        { artifact: "# README v2 with example", notes: "added example", needs_human: null },
      ],
      check: [
        { pass: true, evidence: "traced it", notes: "" },
        { pass: false, evidence: "no example", notes: "Add a usage example" },
        { pass: true, evidence: "example present", notes: "" },
      ],
      final: [{ results: INTAKE.acceptance.map((c) => ({ check: c, pass: true, evidence: "ok" })), summary: "Done: script and README." }],
    });
    const id = await toAwaitingStart(h);

    let v = await projectView(h.d, id);
    expect(v.status).toBe("awaiting_start");
    expect(v.checklist).toEqual([{ step: 2, bucket: "user", title: "Create a GitHub repo", detail: "User creates it" }]);
    expect(v.estimate!.costLowUsd).toBeGreaterThan(0);
    expect(v.estimate!.costHighUsd).toBeGreaterThan(v.estimate!.costLowUsd);
    expect(v.estimate!.modelSteps).toBe(2);

    await expect(startSolve(h.d, id, false)).rejects.toThrow(/checklist/);
    await startSolve(h.d, id, true);

    // Step 1 is the only ready step (step 3 waits on it); Model A makes it, B idles.
    await advance(h.d, id);
    v = await projectView(h.d, id);
    expect(v.steps.map((s) => s.status)).toEqual(["made", "external", "pending"]);
    expect(v.events.some((e) => e.actor === "B" && e.action === "queue_empty")).toBe(true);

    for (let i = 0; i < 10 && (await projectView(h.d, id)).status !== "done"; i++) await advance(h.d, id);
    v = await projectView(h.d, id);
    expect(v.status).toBe("done");
    expect(v.summary).toBe("Done: script and README.");
    expect(v.steps.map((s) => [s.status, s.rounds])).toEqual([["passed", 0], ["external", 0], ["passed", 1]]);

    // Segregation of duties: the checker never sees the maker's explanation.
    for (const c of h.calls.filter((x) => x.action === "check" || x.action === "final")) {
      expect(c.call.prompt).not.toContain("SECRET-MAKER-EXPLANATION");
    }
    // The retry carries the checker's notes back to the maker.
    const makes = h.calls.filter((x) => x.action === "make");
    expect(makes[2].call.prompt).toContain("Add a usage example");
    // Two providers: A makes build/write steps, B checks.
    expect(makes.every((m) => m.cfg.role === "A")).toBe(true);
    expect(h.calls.filter((x) => x.action === "check").every((c) => c.cfg.role === "B")).toBe(true);

    expect(v.spentUsd).toBeCloseTo(h.calls.length * 0.01, 5);
    expect(v.events.filter((e) => e.action === "check").map((e) => e.outcome)).toEqual(["pass", "fail", "pass"]);
    expect(v.idle.A).toBeGreaterThan(0);
  });

  it("swaps roles for research steps", async () => {
    const h = harness({
      intake: [INTAKE],
      plan: [{ steps: [{ title: "Research", detail: "d", check: "c", kind: "research", bucket: "model", depends_on: [] }] }],
      review: [{ approved: true }],
      make: [{ artifact: "findings", notes: "", needs_human: null }],
      check: [{ pass: true, evidence: "e" }],
      final: [{ results: INTAKE.acceptance.map((c) => ({ check: c, pass: true })), summary: "s" }],
    });
    const id = await toAwaitingStart(h);
    await startSolve(h.d, id, true);
    for (let i = 0; i < 5; i++) await advance(h.d, id);
    expect((await projectView(h.d, id)).status).toBe("done");
    expect(h.calls.find((c) => c.action === "make")!.cfg.role).toBe("B");
    expect(h.calls.find((c) => c.action === "check")!.cfg.role).toBe("A");
  });
});

describe("intake", () => {
  it("redrafts with the user's correction", async () => {
    const h = harness({ intake: [INTAKE] });
    const id = await createProject(h.d, "dedupe my csvs");
    await advance(h.d, id);
    await reviseIntake(h.d, id, "It is Excel files, not CSV");
    expect((await projectView(h.d, id)).status).toBe("intake");
    await advance(h.d, id);
    expect(h.calls[1].call.prompt).toContain("It is Excel files, not CSV");
  });

  it("rejects empty and oversized requests", async () => {
    const h = harness({});
    await expect(createProject(h.d, "   ")).rejects.toThrow();
    await expect(createProject(h.d, "x".repeat(9000))).rejects.toThrow();
  });
});

describe("guardrails", () => {
  it("ends without spending when there is nothing worth doing", async () => {
    const h = harness({ intake: [INTAKE], plan: [{ steps: [], note: "Already solved by a built-in tool." }] });
    const id = await createProject(h.d, "x");
    await advance(h.d, id);
    await approveIntake(h.d, id);
    await advance(h.d, id);
    const v = await projectView(h.d, id);
    expect(v.status).toBe("done");
    expect(v.summary).toBe("Already solved by a built-in tool.");
    expect(h.calls).toHaveLength(2);
  });

  it("escalates after the maximum rounds and can be resumed", async () => {
    const h = harness({
      intake: [INTAKE],
      plan: [PLAN],
      review: [{ approved: true }],
      make: [{ artifact: "attempt", notes: "", needs_human: null }],
      check: [{ pass: false, evidence: "wrong", notes: "still wrong" }],
    });
    const id = await toAwaitingStart(h);
    await startSolve(h.d, id, true);
    for (let i = 0; i < 20 && (await projectView(h.d, id)).status === "solving"; i++) await advance(h.d, id);
    let v = await projectView(h.d, id);
    expect(v.status).toBe("escalated");
    expect(v.escalation).toMatch(/failed its check 3 times/);
    expect(h.calls.filter((c) => c.action === "check")).toHaveLength(3);

    // Nothing runs while escalated.
    const before = h.calls.length;
    expect(await advance(h.d, id)).toBe(false);
    expect(h.calls.length).toBe(before);

    await resume(h.d, id);
    v = await projectView(h.d, id);
    expect(v.status).toBe("solving");
    expect(v.steps[0].rounds).toBe(0);
  });

  it("escalates a plan the checker keeps rejecting", async () => {
    const h = harness({ intake: [INTAKE], plan: [PLAN], review: [{ approved: false, notes: "missing tests" }] });
    const id = await createProject(h.d, "x");
    await advance(h.d, id);
    await approveIntake(h.d, id);
    for (let i = 0; i < 10; i++) await advance(h.d, id);
    const v = await projectView(h.d, id);
    expect(v.status).toBe("escalated");
    expect(h.calls.filter((c) => c.action === "review")).toHaveLength(3);
    // The replan sees the reviewer's notes.
    expect(h.calls.filter((c) => c.action === "plan")[1].call.prompt).toContain("missing tests");
  });

  it("stops at the dollar cap before making the call", async () => {
    const h = harness({ intake: [INTAKE] }, { PREVIEW_CAP_USD: "0.05" });
    const id = await createProject(h.d, "x");
    await advance(h.d, id);
    const v = await projectView(h.d, id);
    expect(v.status).toBe("escalated");
    expect(v.escalation).toMatch(/Dollar cap/);
    expect(h.calls).toHaveLength(0);
    await resume(h.d, id, 1);
    expect((await projectView(h.d, id)).capUsd).toBe(1);
  });

  it("refuses to start when the low estimate exceeds the cap", async () => {
    const h = harness({ intake: [INTAKE], plan: [PLAN], review: [{ approved: true }] }, { PROJECT_CAP_USD: "0.001" });
    const id = await toAwaitingStart(h);
    await expect(startSolve(h.d, id, true)).rejects.toThrow(/cap/);
  });

  it("stops at the first unexplained failure without retrying", async () => {
    const h = harness({ intake: [() => new Error("503 overloaded")] });
    const id = await createProject(h.d, "x");
    await advance(h.d, id);
    await advance(h.d, id);
    const v = await projectView(h.d, id);
    expect(v.status).toBe("failed");
    expect(v.escalation).toMatch(/503 overloaded/);
    expect(h.calls).toHaveLength(1);
  });

  it("fails on a reply that is not JSON", async () => {
    const h = harness({ intake: ["sorry, I can't"] });
    const id = await createProject(h.d, "x");
    await advance(h.d, id);
    expect((await projectView(h.d, id)).status).toBe("failed");
  });

  it("escalates to Jake when a step needs a person", async () => {
    const h = harness({
      intake: [INTAKE],
      plan: [PLAN],
      review: [{ approved: true }],
      make: [{ artifact: "", notes: "", needs_human: "Needs a live API key to test against production" }],
    });
    const id = await toAwaitingStart(h);
    await startSolve(h.d, id, true);
    await advance(h.d, id);
    const v = await projectView(h.d, id);
    expect(v.status).toBe("escalated");
    expect(v.escalation).toMatch(/needs a person: Needs a live API key/);
  });

  it("escalates when the final check fails", async () => {
    const h = harness({
      intake: [INTAKE],
      plan: [{ steps: [PLAN.steps[0]] }],
      review: [{ approved: true }],
      make: [{ artifact: "code", notes: "", needs_human: null }],
      check: [{ pass: true, evidence: "e" }],
      final: [{ results: [{ check: INTAKE.acceptance[0], pass: true }, { check: INTAKE.acceptance[1], pass: false, evidence: "no docs" }], summary: "" }],
    });
    const id = await toAwaitingStart(h);
    await startSolve(h.d, id, true);
    for (let i = 0; i < 5; i++) await advance(h.d, id);
    const v = await projectView(h.d, id);
    expect(v.status).toBe("escalated");
    expect(v.escalation).toMatch(/no docs/);
  });
});

describe("scheduling", () => {
  it("works independent steps in parallel, up to the limit", async () => {
    const steps = [1, 2, 3, 4].map((n) => ({ title: `S${n}`, detail: "d", check: "c", kind: "write", bucket: "model", depends_on: [] }));
    const h = harness(
      { intake: [INTAKE], plan: [{ steps }], review: [{ approved: true }], make: [{ artifact: "a", notes: "", needs_human: null }] },
      { PARALLEL_STEPS: "3" },
    );
    const id = await toAwaitingStart(h);
    await startSolve(h.d, id, true);
    await advance(h.d, id);
    expect((await projectView(h.d, id)).steps.map((s) => s.status)).toEqual(["made", "made", "made", "pending"]);
  });

  it("tick advances each active project once and skips leased ones", async () => {
    const h = harness({ intake: [INTAKE] });
    const a = await createProject(h.d, "a");
    const b = await createProject(h.d, "b");
    await h.env.DB.prepare("UPDATE projects SET lease_until = ? WHERE id = ?").bind(9e15, b).run();
    expect(await tick(h.d)).toBe(1);
    expect((await projectView(h.d, a)).status).toBe("awaiting_approval");
    expect((await projectView(h.d, b)).status).toBe("intake");
  });
});

describe("estimate", () => {
  it("grows with retries and dependency depth", () => {
    const a = modelConfig({} as Env, "A");
    const b = modelConfig({} as Env, "B");
    const flat = estimate(
      [1, 2].map((idx) => ({ idx, bucket: "model", dependsOn: [], estTokens: 2000, maker: a, checker: b })),
      b,
      3,
    );
    const chained = estimate(
      [1, 2].map((idx) => ({ idx, bucket: "model", dependsOn: idx === 2 ? [1] : [], estTokens: 2000, maker: a, checker: b })),
      b,
      3,
    );
    expect(flat.costHighUsd).toBeGreaterThan(flat.costLowUsd);
    expect(chained.minutesLow).toBeGreaterThan(flat.minutesLow);
    expect(flat.calls).toBe(5);
  });
});

describe("HTTP", () => {
  const ctx = { waitUntil: (_p: Promise<unknown>) => {} };
  const req = (path: string, init: RequestInit & { code?: string; origin?: string } = {}) =>
    new Request(`https://api.example${path}`, {
      ...init,
      headers: { origin: init.origin ?? "https://penpost.co", "x-access-code": init.code ?? "letmein", "content-type": "application/json" },
    });

  it("requires the access code and an allowed origin", async () => {
    const h = harness({});
    expect((await handle(req("/api/projects", { method: "POST", code: "nope" }), h.env, ctx, h.d)).status).toBe(401);
    expect((await handle(req("/api/projects", { method: "POST", origin: "https://evil.example" }), h.env, ctx, h.d)).status).toBe(403);
    const noCode = { ...h.env, ACCESS_CODE: undefined } as Env;
    expect((await handle(req("/api/projects", { method: "POST" }), noCode, ctx, h.d)).status).toBe(503);
  });

  it("creates, reads and reports user errors", async () => {
    const h = harness({});
    const res = await handle(req("/api/projects", { method: "POST", body: JSON.stringify({ request: "fix my thing" }) }), h.env, ctx, h.d);
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    const got = await handle(req(`/api/projects/${id}`), h.env, ctx, h.d);
    expect(((await got.json()) as { status: string }).status).toBe("intake");
    expect(res.headers.get("access-control-allow-origin")).toBe("https://penpost.co");
    const bad = await handle(req(`/api/projects/${id}/approve`, { method: "POST" }), h.env, ctx, h.d);
    expect(bad.status).toBe(409);
    expect((await handle(req(`/api/projects/nope`), h.env, ctx, h.d)).status).toBe(404);
  });
});

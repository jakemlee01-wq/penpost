/** Tests for the fixes from the first three live runs (coffee shop, plumbing, dog walking). */
import { describe, expect, it } from "vitest";
import { advance, approveIntake, createProject, idleTime, projectView, resume, selfReviewSteps, startSolve, stripRoleLabels } from "../worker/src/engine";
import type { Env } from "../worker/src/env";
import { estimate } from "../worker/src/estimate";
import { callGemini, modelConfig, ModelError, type ModelCall, type ModelConfig } from "../worker/src/models";
import * as P from "../worker/src/prompts";
import { capNote, usd } from "../src/format";
import { harness, INTAKE, PLAN, toAwaitingStart } from "./harness";

const ONE_STEP = { steps: [PLAN.steps[0]] };
const passAll = { results: INTAKE.acceptance.map((c) => ({ check: c, pass: true, evidence: "ok" })), summary: "done" };
const cutOff = (tokensOut: number) => (call: ModelCall, cfg: ModelConfig) =>
  new ModelError(`Model ${cfg.role} hit the output limit (${call.maxTokens} tokens)`, { tokensIn: 900, tokensOut, costUsd: 0.02 }, "max_tokens");

async function solving(h: ReturnType<typeof harness>) {
  const id = await toAwaitingStart(h);
  await startSolve(h.d, id, true);
  return id;
}

// ------------------------------------------------------------------ 1. output limit

describe("1. output limit and lost spend", () => {
  it("retries once with double the allowance after hitting the output limit, and charges both attempts", async () => {
    let attempt = 0;
    const h = harness({
      intake: [INTAKE],
      plan: [ONE_STEP],
      review: [{ approved: true }],
      make: [(c: ModelCall, m: ModelConfig) => (attempt++ === 0 ? cutOff(16000)(c, m) : { artifact: "code", notes: "", needs_human: null })],
      check: [{ pass: true, evidence: "e" }],
      final: [passAll],
    });
    const id = await solving(h);
    await advance(h.d, id); // make: cut off, retried, succeeds
    const makes = h.calls.filter((c) => c.action === "make");
    expect(makes.map((c) => c.call.maxTokens)).toEqual([16000, 32000]);

    const v = await projectView(h.d, id);
    const ev = v.events.filter((e) => e.action === "make");
    expect(ev.map((e) => e.outcome)).toEqual(["retry", "ok"]);
    expect(ev[0]).toMatchObject({ tokensIn: 900, tokensOut: 16000, costUsd: 0.02 });
    expect(ev[0].note).toMatch(/Retrying once with 32000 tokens/);
    // 3 earlier calls at $0.01, the cut-off attempt at $0.02, the retry at $0.01.
    expect(v.spentUsd).toBeCloseTo(0.06, 6);
    expect(v.steps[0].status).toBe("made");
  });

  it("fails after the second cut-off, still logging and charging both attempts", async () => {
    const h = harness({ intake: [INTAKE], plan: [ONE_STEP], review: [{ approved: true }], make: [cutOff(16000), cutOff(32000)] });
    const id = await solving(h);
    await advance(h.d, id);
    const v = await projectView(h.d, id);
    expect(v.status).toBe("failed");
    expect(v.escalation).toMatch(/hit the output limit \(32000 tokens\)/);
    const ev = v.events.filter((e) => e.action === "make");
    expect(ev.map((e) => [e.outcome, e.tokensOut, e.costUsd])).toEqual([
      ["retry", 16000, 0.02],
      ["error", 32000, 0.02],
    ]);
    expect(v.spentUsd).toBeCloseTo(0.07, 6);
    expect(h.calls.filter((c) => c.action === "make")).toHaveLength(2);
  });

  it("charges a failed call's usage even when it isn't retryable", async () => {
    const h = harness({ intake: [() => new ModelError("Model A declined the request", { tokensIn: 300, tokensOut: 40, costUsd: 0.005 })] });
    const id = await createProject(h.d, "x");
    await advance(h.d, id);
    const v = await projectView(h.d, id);
    expect(v.status).toBe("failed");
    expect(v.spentUsd).toBeCloseTo(0.005, 6);
    expect(v.events.find((e) => e.action === "intake")).toMatchObject({ outcome: "error", tokensIn: 300, tokensOut: 40, costUsd: 0.005 });
    expect(h.calls).toHaveLength(1); // not retried
  });

  it("says so when a failed call reported no usage", async () => {
    const h = harness({ intake: [() => new Error("socket hang up")] });
    const id = await createProject(h.d, "x");
    await advance(h.d, id);
    const ev = (await projectView(h.d, id)).events.find((e) => e.action === "intake")!;
    expect(ev.note).toMatch(/reported no usage/);
  });

  it("won't retry past the dollar cap", async () => {
    // Model B (Gemini prices) makes research steps; doubling to 32k output would cost ~$0.24.
    const research = { steps: [{ ...PLAN.steps[0], kind: "research" }] };
    const h = harness({ intake: [INTAKE], plan: [research], review: [{ approved: true }], make: [cutOff(16000)] }, { PROJECT_CAP_USD: "0.2" });
    const id = await solving(h);
    await advance(h.d, id);
    const v = await projectView(h.d, id);
    expect(v.status).toBe("escalated");
    expect(v.escalation).toMatch(/Dollar cap/);
    expect(h.calls.filter((c) => c.action === "make")).toHaveLength(1);
    expect(v.events.find((e) => e.action === "make")!.costUsd).toBe(0.02); // the cut-off attempt is still charged
  });

  it("gives a redo of a failed step more room, and sets Gemini thinking levels", async () => {
    const h = harness({
      intake: [INTAKE],
      plan: [ONE_STEP],
      review: [{ approved: true }],
      make: [{ artifact: "v1", notes: "", needs_human: null }, { artifact: "v2", notes: "", needs_human: null }],
      check: [{ pass: false, evidence: "e", notes: "fix it" }, { pass: true, evidence: "e" }],
      final: [passAll],
    });
    const id = await solving(h);
    for (let i = 0; i < 6; i++) await advance(h.d, id);
    expect((await projectView(h.d, id)).status).toBe("done");
    const makes = h.calls.filter((c) => c.action === "make");
    expect(makes.map((c) => c.call.maxTokens)).toEqual([16000, 24000]);
    expect(makes.every((c) => c.call.thinking === "low")).toBe(true);
    const checks = h.calls.filter((c) => c.action === "check" || c.action === "final" || c.action === "review");
    expect(checks.every((c) => c.call.thinking === "medium")).toBe(true);
  });

  it("sends Gemini a thinking level and reports cut-offs with their usage", async () => {
    const env = { GEMINI_API_KEY: "k" } as unknown as Env;
    const cfg = modelConfig({} as Env, "B");
    let body: { generationConfig: Record<string, unknown> } | null = null;
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return new Response(
        JSON.stringify({
          candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [] } }],
          usageMetadata: { promptTokenCount: 2000, candidatesTokenCount: 1000, thoughtsTokenCount: 15000 },
        }),
      );
    }) as unknown as typeof fetch;
    const err = await callGemini(env, cfg, { system: "s", prompt: "p", maxTokens: 16000, thinking: "low" }, fetchImpl).catch((e) => e);
    expect(body!.generationConfig).toMatchObject({ maxOutputTokens: 16000, thinkingConfig: { thinkingLevel: "low" } });
    expect(err).toBeInstanceOf(ModelError);
    expect(err.kind).toBe("max_tokens");
    expect(err.message).toMatch(/15000 spent thinking/);
    expect(err.usage).toMatchObject({ tokensIn: 2000, tokensOut: 16000 });
    expect(err.usage.costUsd).toBeCloseTo((2000 * 1.5 + 16000 * 7.5) / 1e6, 9);
  });
});

// ------------------------------------------------------------------ 2. idle time

describe("2. idle time only counts while the project is active", () => {
  it("stops counting when the project stops and restarts on resume", async () => {
    const h = harness({
      intake: [INTAKE],
      plan: [ONE_STEP],
      review: [{ approved: true }],
      make: [{ artifact: "", notes: "", needs_human: "needs a live API key" }],
    });
    const id = await solving(h);
    await advance(h.d, id); // make asks for a person: escalated
    const stopped = await projectView(h.d, id);
    expect(stopped.status).toBe("escalated");

    h.wait(60 * 60 * 1000); // an hour passes while it waits for Jake
    const later = await projectView(h.d, id);
    expect(later.idle).toEqual(stopped.idle);
    expect(later.idle.B).toBeLessThan(30_000);

    await resume(h.d, id);
    h.wait(10_000);
    const resumed = await projectView(h.d, id);
    expect(resumed.idle.B).toBeGreaterThanOrEqual(later.idle.B + 10_000);
    expect(resumed.idle.B).toBeLessThan(later.idle.B + 20_000);
  });

  it("treats a failed call in older logs as the stop", () => {
    // Shape of the plumbing run: solving starts at 0, a 125 s call fails at 245 s, nothing after.
    const e = (id: number, actor: string, action: string, s: number, f: number, outcome: string | null) =>
      ({ id, step_id: null, actor, model: null, action, started_at: s, finished_at: f, tokens_in: 0, tokens_out: 0, cost_usd: 0, outcome, note: null });
    const events = [
      e(1, "user", "start", 0, 0, "ok"),
      e(2, "B", "make", 1_000, 23_000, "ok"),
      e(3, "A", "check", 27_000, 35_000, "pass"),
      e(4, "B", "make", 120_000, 245_000, "error"),
    ];
    const idle = idleTime({ solve_started_at: 0, finished_at: null, status: "failed" }, events, 60 * 60 * 1000);
    expect(idle.A).toBe(245_000 - 8_000);
    expect(idle.B).toBe(245_000 - 22_000 - 125_000);
  });
});

// ------------------------------------------------------------------ 3. planner rules

describe("3. no self-review steps; independent work in parallel", () => {
  it("flags review and audit steps, but not ordinary work", () => {
    const steps = (titles: string[]) => titles.map((title) => ({ title, bucket: "model" }));
    expect(selfReviewSteps(steps(["Draft the loyalty program document", "Audit counts and placeholder compliance, then correct"]))).toEqual([2]);
    for (const t of ["Proofread the sign", "Final review of all sections", "Quality check the FAQ", "Fact-check the claims", "Review and revise the emails", "Double-check the math"]) {
      expect(selfReviewSteps(steps([t]))).toEqual([1]);
    }
    expect(
      selfReviewSteps(steps(["Target segments and contact sources (plan sections 1-2)", "Outreach messages and tracking checklist", "Funnel math, weekly targets and capacity verdict", "Review of competitors' pricing"])),
    ).toEqual([]);
    expect(selfReviewSteps([{ title: "Audit your bank statements", bucket: "user" }])).toEqual([]); // the person's own task is fine
  });

  it("sends a plan with an audit step straight back without paying for a review", async () => {
    const withAudit = { steps: [PLAN.steps[0], { ...PLAN.steps[0], title: "Audit counts and placeholders, then correct", depends_on: [1] }] };
    const h = harness({ intake: [INTAKE], plan: [withAudit, ONE_STEP], review: [{ approved: true }] });
    const id = await createProject(h.d, "x");
    await advance(h.d, id);
    await approveIntake(h.d, id);
    await advance(h.d, id); // plan with an audit step
    let v = await projectView(h.d, id);
    expect(v.status).toBe("planning");
    expect(h.calls.filter((c) => c.action === "review")).toHaveLength(0);
    expect(v.events.at(-1)).toMatchObject({ actor: "system", action: "plan_verdict", outcome: "fail" });

    await advance(h.d, id); // replan sees why
    expect(h.calls.filter((c) => c.action === "plan")[1].call.prompt).toMatch(/Remove step 2 \("Audit counts/);
    await advance(h.d, id); // review
    v = await projectView(h.d, id);
    expect(v.status).toBe("awaiting_start");
    expect(v.steps).toHaveLength(1);
  });

  it("tells the planner and reviewer the rules", () => {
    expect(P.plan.system).toMatch(/Never create self-review, audit, compliance-check, proofreading/);
    expect(P.plan.system).toMatch(/Split independent deliverables into separate steps/);
    expect(P.planReview.system).toMatch(/Reject any self-review, audit, proofreading or compliance-check step/);
  });
});

// ------------------------------------------------------------------ 4 and 5. intake rules, labels

describe("4 and 5. intake rules and customer-facing text", () => {
  it("gives intake the rules for checks, assumptions, targets and placeholders", () => {
    expect(P.intake.system).toMatch(/cannot browse/);
    expect(P.intake.system).toMatch(/Never require links, URLs or sources "a reviewer can open and confirm exists"/);
    expect(P.intake.system).toMatch(/goal, deadline, team size, budget, word or length limits.*never label them ASSUMPTION/);
    expect(P.intake.system).toMatch(/Never require the work to hit a target/);
    expect(P.intake.system).toMatch(/Never invent policies, fees/);
    expect(P.check.system).toMatch(/cannot browse/);
  });

  it("strips Maker: and Checker: labels from what the person sees", async () => {
    expect(stripRoleLabels("Maker: Produce all four deliverables.\n\nChecker: Verify each item.")).toBe("Produce all four deliverables.\n\nVerify each item.");
    expect(stripRoleLabels("**Checker:** Count words directly.")).toBe("Count words directly.");
    expect(stripRoleLabels("The checklist maker: a tool")).toBe("The checklist maker: a tool"); // mid-sentence text is left alone

    const h = harness({ intake: [{ problem: "p", solution: "Maker: Write it.\nChecker: Count it.", acceptance: ["Checker: under 60 words"] }] });
    const id = await createProject(h.d, "x");
    await advance(h.d, id);
    const v = await projectView(h.d, id);
    expect(v.solution).toBe("Write it.\nCount it.");
    expect(v.acceptance).toEqual(["under 60 words"]);
  });
});

// ------------------------------------------------------------------ 6. display

describe("6. display", () => {
  it("shows tiny costs as <$0.001", () => {
    expect(usd(0)).toBe("$0.00");
    expect(usd(0.0004)).toBe("<$0.001");
    expect(usd(0.00099)).toBe("<$0.001");
    expect(usd(0.0012)).toBe("$0.001");
    expect(usd(0.054)).toBe("$0.054");
    expect(usd(1.5)).toBe("$1.50");
  });

  it("labels the preview cap separately from the project cap", () => {
    const note = capNote(0.004, 0.5, 2);
    expect(note).toMatch(/^Solving is capped at \$2\.00 for the whole project/);
    expect(note).toMatch(/\$0\.004 of its separate \$0\.50 limit/);
  });

  it("returns both caps in the project view", async () => {
    const h = harness({ intake: [INTAKE], plan: [ONE_STEP], review: [{ approved: true }] }, { PROJECT_CAP_USD: "2", PREVIEW_CAP_USD: "0.5" });
    const id = await toAwaitingStart(h);
    const v = await projectView(h.d, id);
    expect([v.capUsd, v.previewCapUsd, v.projectCapUsd]).toEqual([0.5, 0.5, 2]);
  });

  it("says in plain words what Resume will do", async () => {
    // A step that failed its check, then its redo hit the output limit twice.
    const h = harness({
      intake: [INTAKE],
      plan: [ONE_STEP],
      review: [{ approved: true }],
      make: [{ artifact: "v1", notes: "", needs_human: null }, cutOff(24000), cutOff(48000)],
      check: [{ pass: false, evidence: "e", notes: "math is off" }],
    });
    const id = await solving(h);
    for (let i = 0; i < 4; i++) await advance(h.d, id);
    const v = await projectView(h.d, id);
    expect(v.status).toBe("failed");
    expect(v.resumePlan).toMatch(/Model A redoes step 1 \("Write the script"\) using the checker's notes/);
    expect(v.resumePlan).toMatch(/room for 24,000 tokens \(it ran out of room last time/);
    expect(v.resumePlan).toMatch(/then Model B checks it/);
    expect(v.resumePlan).toMatch(/Failed-check counts reset, so each gets 3 fresh tries/);
    expect(v.resumePlan).toMatch(/new cap \(now \$5\.00\)/);

    const fresh = await projectView(h.d, await createProject(h.d, "y"));
    expect(fresh.resumePlan).toBeNull();
  });

  it("explains a final-check resume and a cap stop", async () => {
    const h = harness({
      intake: [INTAKE],
      plan: [ONE_STEP],
      review: [{ approved: true }],
      make: [{ artifact: "code", notes: "", needs_human: null }],
      check: [{ pass: true, evidence: "e" }],
      final: [{ results: [{ check: "x", pass: false, evidence: "no" }], summary: "" }],
    });
    const id = await solving(h);
    for (let i = 0; i < 4; i++) await advance(h.d, id);
    expect((await projectView(h.d, id)).resumePlan).toMatch(/reruns only the final sign-off.*No steps are redone/);

    const capped = harness({ intake: [INTAKE] }, { PREVIEW_CAP_USD: "0.001" });
    const cid = await createProject(capped.d, "x");
    await advance(capped.d, cid);
    expect((await projectView(capped.d, cid)).resumePlan).toMatch(/stopped at its \$0\.00 cap, so enter a higher cap/);
  });
});

// ------------------------------------------------------------------ 7. estimator

describe("7. estimator", () => {
  const a = modelConfig({} as Env, "A");
  const b = modelConfig({} as Env, "B");
  const step = (idx: number, text: string, dependsOn: number[] = []) => ({ idx, bucket: "model", dependsOn, estTokens: 1500, maker: b, checker: a, text });

  it("widens the range for multi-step and math-heavy plans", () => {
    const one = estimate([step(1, "Write a product description")], b, 3);
    const three = estimate([step(1, "Segments"), step(2, "Emails", [1]), step(3, "Checklist", [1])], b, 3);
    const mathy = estimate([step(1, "Segments"), step(2, "Emails", [1]), step(3, "Funnel math, weekly targets and capacity", [1])], b, 3);
    const ratio = (e: { costLowUsd: number; costHighUsd: number }) => e.costHighUsd / e.costLowUsd;
    expect(one.mathHeavy).toBe(false);
    expect(mathy.mathHeavy).toBe(true);
    expect(ratio(three)).toBeGreaterThan(ratio(one));
    expect(ratio(mathy)).toBeGreaterThan(ratio(three));
    expect(mathy.costHighUsd).toBeGreaterThan(three.costHighUsd);
  });

  it("stores the estimate and the actual cost per project", async () => {
    const h = harness({ intake: [INTAKE], plan: [ONE_STEP], review: [{ approved: true }], make: [{ artifact: "c", notes: "", needs_human: null }], check: [{ pass: true, evidence: "e" }], final: [passAll] });
    const id = await solving(h);
    for (let i = 0; i < 4; i++) await advance(h.d, id);
    expect((await projectView(h.d, id)).status).toBe("done");
    const row = await h.env.DB.prepare("SELECT * FROM estimates WHERE project_id = ?").bind(id).first<Record<string, number | string>>();
    expect(row).toMatchObject({ model_steps: 1, outcome: "done", preview_usd: 0.03, model_calls: 3, retries: 0 });
    expect(row!.actual_solve_usd).toBeCloseTo(0.03, 6);
    expect(row!.actual_total_usd).toBeCloseTo(0.06, 6);
    expect(Number(row!.est_high_usd)).toBeGreaterThan(Number(row!.est_low_usd));
  });
});

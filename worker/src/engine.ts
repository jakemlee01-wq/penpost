/**
 * The orchestrator. Plain code, not an AI: it passes messages between the two models,
 * saves state in D1 and enforces the guardrails. `advance` does one unit of work for a
 * project and returns; the cron (or a user action) calls it again for the next one.
 */
import { num, type Env } from "./env";
import { estimate, type PlanStep } from "./estimate";
import { cost, modelConfig, ModelError, parseJson, type ModelCaller, type ModelConfig, type Role, type ThinkingLevel, type Usage } from "./models";
import * as P from "./prompts";
import {
  ACTIVE_STATUSES,
  type ChecklistItem,
  type EventView,
  type ProjectStatus,
  type ProjectView,
  type StepBucket,
  type StepKind,
  type StepStatus,
  type StepView,
} from "./types";

export interface Deps {
  env: Env;
  callModel: ModelCaller;
  now?: () => number;
}

interface ProjectRow {
  id: string;
  created_at: number;
  status: ProjectStatus;
  resume_status: ProjectStatus | null;
  request: string;
  revision_note: string | null;
  problem: string | null;
  solution: string | null;
  acceptance_json: string | null;
  plan_notes: string | null;
  plan_rounds: number;
  checklist_json: string | null;
  estimate_json: string | null;
  cap_usd: number;
  preview_cap_usd: number;
  spent_usd: number;
  summary: string | null;
  escalation: string | null;
  solve_started_at: number | null;
  finished_at: number | null;
}

interface StepRow {
  id: string;
  project_id: string;
  idx: number;
  title: string;
  detail: string;
  check_text: string;
  kind: StepKind;
  bucket: StepBucket;
  depends_json: string;
  est_tokens: number;
  status: StepStatus;
  rounds: number;
  artifact: string | null;
  maker_notes: string | null;
  checker_notes: string | null;
  evidence: string | null;
}

interface EventRow {
  id: number;
  step_id: string | null;
  actor: string;
  model: string | null;
  action: string;
  started_at: number;
  finished_at: number | null;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  outcome: string | null;
  note: string | null;
}

/** Thrown to stop the current run after the project has been escalated or failed. */
class Halt extends Error {}

export class UserError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

/** Longer than a queue consumer's 15-minute wall-time limit, so a live run never loses its lease. */
const LEASE_MS = 16 * 60 * 1000;
/** A project untouched this long, with no lease, has lost its queue chain; the cron re-queues it. */
const STALE_MS = 2 * 60 * 1000;
const MAX_REQUEST_CHARS = 8000;
const PRE_START: ProjectStatus[] = ["intake", "awaiting_approval", "planning", "plan_review", "awaiting_start"];

const now = (d: Deps) => (d.now ? d.now() : Date.now());
const db = (d: Deps) => d.env.DB;
const settings = (env: Env) => ({
  maxRounds: num(env.MAX_ROUNDS, 3),
  capUsd: num(env.PROJECT_CAP_USD, 2),
  previewCapUsd: num(env.PREVIEW_CAP_USD, 0.5),
  parallel: Math.max(1, num(env.PARALLEL_STEPS, 3)),
  maxTokens: num(env.MAX_OUTPUT_TOKENS, 16000),
  /** A redo of a failed step carries the old artifact and the checker's notes, so it gets more room. */
  retryMaxTokens: num(env.RETRY_OUTPUT_TOKENS, 24000),
  /** Hard ceiling for any single call, including the one retry after hitting the output limit. */
  outputCeiling: num(env.MAX_OUTPUT_CEILING, 64000),
  thinkingMake: (String(env.GEMINI_THINKING_MAKE ?? "low") as ThinkingLevel),
  thinkingCheck: (String(env.GEMINI_THINKING_CHECK ?? "medium") as ThinkingLevel),
  swapKinds: String(env.SWAP_KINDS ?? "research")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
});

function rolesFor(env: Env, kind: StepKind): { maker: ModelConfig; checker: ModelConfig } {
  const a = modelConfig(env, "A");
  const b = modelConfig(env, "B");
  return settings(env).swapKinds.includes(kind) ? { maker: b, checker: a } : { maker: a, checker: b };
}

function spec(p: ProjectRow): P.Spec {
  return { problem: p.problem ?? "", solution: p.solution ?? "", acceptance: JSON.parse(p.acceptance_json ?? "[]") };
}

// ---------------------------------------------------------------- data access

async function loadProject(d: Deps, id: string): Promise<ProjectRow> {
  const p = await db(d).prepare("SELECT * FROM projects WHERE id = ?").bind(id).first<ProjectRow>();
  if (!p) throw new UserError("project not found", 404);
  return p;
}

async function loadSteps(d: Deps, id: string): Promise<StepRow[]> {
  const r = await db(d).prepare("SELECT * FROM steps WHERE project_id = ? ORDER BY idx").bind(id).all<StepRow>();
  return r.results;
}

async function setProject(d: Deps, id: string, fields: Partial<Record<keyof ProjectRow, unknown>>): Promise<void> {
  const keys = Object.keys(fields);
  const sql = `UPDATE projects SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`;
  await db(d)
    .prepare(sql)
    .bind(...keys.map((k) => (fields as Record<string, unknown>)[k] ?? null), now(d), id)
    .run();
}

async function setStep(d: Deps, id: string, fields: Partial<Record<keyof StepRow | "started_at" | "finished_at", unknown>>): Promise<void> {
  const keys = Object.keys(fields);
  await db(d)
    .prepare(`UPDATE steps SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`)
    .bind(...keys.map((k) => (fields as Record<string, unknown>)[k] ?? null), id)
    .run();
}

interface LogEntry {
  stepId?: string | null;
  actor: string;
  cfg?: ModelConfig;
  action: string;
  startedAt: number;
  finishedAt?: number | null;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  outcome?: string | null;
  note?: string | null;
}

async function log(d: Deps, projectId: string, e: LogEntry): Promise<void> {
  await db(d)
    .prepare(
      `INSERT INTO events (project_id, step_id, actor, provider, model, action, started_at, finished_at, tokens_in, tokens_out, cost_usd, outcome, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      projectId,
      e.stepId ?? null,
      e.actor,
      e.cfg?.provider ?? null,
      e.cfg?.model ?? null,
      e.action,
      e.startedAt,
      e.finishedAt ?? null,
      e.tokensIn ?? 0,
      e.tokensOut ?? 0,
      e.costUsd ?? 0,
      e.outcome ?? null,
      e.note ?? null,
    )
    .run();
}

// ---------------------------------------------------------------- guardrails

async function escalate(d: Deps, p: ProjectRow, reason: string): Promise<never> {
  await setProject(d, p.id, { status: "escalated", resume_status: p.status, escalation: reason });
  await log(d, p.id, { actor: "system", action: "escalate", startedAt: now(d), finishedAt: now(d), outcome: "fail", note: reason });
  await recordOutcome(d, p.id, "escalated");
  throw new Halt(reason);
}

async function fail(d: Deps, p: ProjectRow, reason: string): Promise<never> {
  await setProject(d, p.id, { status: "failed", resume_status: p.status, escalation: reason });
  await log(d, p.id, { actor: "system", action: "stopped", startedAt: now(d), finishedAt: now(d), outcome: "fail", note: reason });
  await recordOutcome(d, p.id, "failed");
  throw new Halt(reason);
}

const approxTokens = (s: string) => Math.ceil(s.length / 3.5);

function capFor(p: ProjectRow): number {
  return PRE_START.includes(p.status) ? p.preview_cap_usd : p.cap_usd;
}

/** Worst-case cost of a call: its whole prompt plus the full output allowance. */
function worstCase(d: Deps, cfg: ModelConfig, system: string, prompt: string, allowance = settings(d.env).maxTokens): number {
  return cost(cfg, approxTokens(system + prompt), allowance);
}

async function ensureBudget(d: Deps, p: ProjectRow, reserve: number): Promise<void> {
  const fresh = await loadProject(d, p.id);
  const cap = capFor(p);
  if (fresh.spent_usd + reserve > cap) {
    await escalate(
      d,
      p,
      `Dollar cap reached: $${fresh.spent_usd.toFixed(2)} spent, next work could cost up to $${reserve.toFixed(2)}, cap is $${cap.toFixed(2)}.`,
    );
  }
}

interface CallOpts {
  stepId?: string | null;
  /** Output allowance (reply plus thinking). Defaults to MAX_OUTPUT_TOKENS. */
  maxTokens?: number;
  /** Gemini thinking level; ignored by Anthropic. */
  thinking?: ThinkingLevel;
}

async function charge(d: Deps, p: ProjectRow, usd: number): Promise<void> {
  if (usd > 0) await db(d).prepare("UPDATE projects SET spent_usd = spent_usd + ? WHERE id = ?").bind(usd, p.id).run();
}

/**
 * Make one model call, log it, and charge it to the project.
 * - A reply cut off at the output limit is retried once with double the allowance (up to the
 *   ceiling, and only if the budget allows). Anything else stops the project.
 * - Every attempt is logged with its tokens and cost, and billed usage is charged even when the
 *   call failed, so spend is never lost.
 */
async function call<T>(
  d: Deps,
  p: ProjectRow,
  cfg: ModelConfig,
  action: string,
  prompt: { system: string; prompt: string },
  opts: CallOpts = {},
): Promise<T> {
  const s = settings(d.env);
  const stepId = opts.stepId ?? null;
  let allowance = Math.min(opts.maxTokens ?? s.maxTokens, s.outputCeiling);
  for (let attempt = 1; ; attempt++) {
    const startedAt = now(d);
    const base = { stepId, actor: cfg.role, cfg, action, startedAt };
    let res: Awaited<ReturnType<ModelCaller>>;
    try {
      res = await d.callModel(cfg, { ...prompt, maxTokens: allowance, thinking: opts.thinking });
    } catch (err) {
      const usage: Usage | undefined = err instanceof ModelError ? err.usage : undefined;
      await charge(d, p, usage?.costUsd ?? 0);
      const why = err instanceof ModelError ? err.message : `API error: ${(err as Error).message}`;
      const bigger = Math.min(allowance * 2, s.outputCeiling);
      const retry = err instanceof ModelError && err.kind === "max_tokens" && attempt === 1 && bigger > allowance;
      await log(d, p.id, {
        ...base,
        finishedAt: now(d),
        tokensIn: usage?.tokensIn ?? 0,
        tokensOut: usage?.tokensOut ?? 0,
        costUsd: usage?.costUsd ?? 0,
        outcome: retry ? "retry" : "error",
        note: retry
          ? `${why}. Retrying once with ${bigger} tokens.`
          : usage
            ? why
            : `${why} (the provider reported no usage, so this call's cost could not be logged)`,
      });
      if (retry) {
        await ensureBudget(d, p, worstCase(d, cfg, prompt.system, prompt.prompt, bigger));
        allowance = bigger;
        continue;
      }
      return fail(d, p, `${action} by Model ${cfg.role} (${cfg.model}) failed: ${why}`);
    }
    await charge(d, p, res.costUsd);
    const usage = { finishedAt: now(d), tokensIn: res.tokensIn, tokensOut: res.tokensOut, costUsd: res.costUsd };
    try {
      const parsed = parseJson<T>(res.text);
      await log(d, p.id, { ...base, ...usage, outcome: "ok" });
      return parsed;
    } catch (err) {
      await log(d, p.id, { ...base, ...usage, outcome: "error", note: (err as Error).message });
      return fail(d, p, `${action} by Model ${cfg.role} (${cfg.model}) failed: ${(err as Error).message}`);
    }
  }
}

// ---------------------------------------------------------------- user actions

export async function createProject(d: Deps, request: string): Promise<string> {
  const text = request.trim();
  if (!text) throw new UserError("Describe the problem and the solution you want.");
  if (text.length > MAX_REQUEST_CHARS) throw new UserError(`Keep it under ${MAX_REQUEST_CHARS} characters.`);
  const s = settings(d.env);
  const id = crypto.randomUUID();
  const t = now(d);
  await db(d)
    .prepare(
      "INSERT INTO projects (id, created_at, updated_at, status, request, cap_usd, preview_cap_usd) VALUES (?, ?, ?, 'intake', ?, ?, ?)",
    )
    .bind(id, t, t, text, s.capUsd, s.previewCapUsd)
    .run();
  await log(d, id, { actor: "user", action: "submit", startedAt: t, finishedAt: t, outcome: "ok" });
  return id;
}

export async function approveIntake(d: Deps, id: string): Promise<void> {
  const p = await loadProject(d, id);
  if (p.status !== "awaiting_approval") throw new UserError("Nothing to approve right now.", 409);
  await setProject(d, id, { status: "planning" });
  await log(d, id, { actor: "user", action: "approve", startedAt: now(d), finishedAt: now(d), outcome: "ok" });
}

export async function reviseIntake(d: Deps, id: string, note: string): Promise<void> {
  const p = await loadProject(d, id);
  if (p.status !== "awaiting_approval") throw new UserError("Nothing to revise right now.", 409);
  if (!note.trim()) throw new UserError("Say what to change.");
  await setProject(d, id, { status: "intake", revision_note: note.trim().slice(0, MAX_REQUEST_CHARS) });
  await log(d, id, { actor: "user", action: "revise", startedAt: now(d), finishedAt: now(d), outcome: "ok", note: note.trim().slice(0, 500) });
}

export async function startSolve(d: Deps, id: string, confirmedChecklist: boolean): Promise<void> {
  const p = await loadProject(d, id);
  if (p.status !== "awaiting_start") throw new UserError("This project isn't ready to start.", 409);
  const checklist = JSON.parse(p.checklist_json ?? "[]") as ChecklistItem[];
  if (checklist.length && !confirmedChecklist) throw new UserError("Confirm the before-we-start checklist first.");
  const est = p.estimate_json ? JSON.parse(p.estimate_json) : null;
  if (est && est.costLowUsd > p.cap_usd) {
    throw new UserError(`The low estimate ($${est.costLowUsd}) is above this project's $${p.cap_usd} cap. Jake needs to raise the cap first.`, 409);
  }
  await db(d).prepare("UPDATE steps SET status = 'external' WHERE project_id = ? AND bucket != 'model'").bind(id).run();
  await setProject(d, id, { status: "solving", solve_started_at: now(d) });
  await log(d, id, { actor: "user", action: "start", startedAt: now(d), finishedAt: now(d), outcome: "ok" });
}

/** Jake clears an escalation: optionally raise the cap; the stuck step gets fresh rounds. */
export async function resume(d: Deps, id: string, capUsd?: number): Promise<void> {
  const p = await loadProject(d, id);
  if (p.status !== "escalated" && p.status !== "failed") throw new UserError("Nothing to resume.", 409);
  const back = p.resume_status ?? "intake";
  const fields: Record<string, unknown> = { status: back, resume_status: null, escalation: null };
  if (capUsd !== undefined) {
    if (!(capUsd > 0 && capUsd <= 500)) throw new UserError("Cap must be between $0 and $500.");
    if (PRE_START.includes(back)) fields.preview_cap_usd = capUsd;
    else fields.cap_usd = capUsd;
  }
  if (back === "plan_review" || back === "planning") fields.plan_rounds = 0;
  await setProject(d, id, fields);
  await db(d)
    .prepare("UPDATE steps SET rounds = 0 WHERE project_id = ? AND status IN ('failed', 'made', 'pending') AND rounds > 0")
    .bind(id)
    .run();
  await log(d, id, { actor: "user", action: "resume", startedAt: now(d), finishedAt: now(d), outcome: "ok", note: capUsd ? `cap $${capUsd}` : null });
}

// ---------------------------------------------------------------- the loop

/** Do one unit of work for a project. Returns true if it did anything. */
export async function advance(d: Deps, id: string): Promise<boolean> {
  const p = await loadProject(d, id);
  try {
    switch (p.status) {
      case "intake":
        await runIntake(d, p);
        return true;
      case "planning":
        await runPlan(d, p);
        return true;
      case "plan_review":
        await runPlanReview(d, p);
        return true;
      case "solving":
        return await runSolve(d, p);
      case "final_check":
        await runFinalCheck(d, p);
        return true;
      default:
        return false;
    }
  } catch (err) {
    if (err instanceof Halt) return true;
    // Unexpected (a bug or a database error): stop rather than retry silently.
    const fresh = await loadProject(d, id);
    if (ACTIVE_STATUSES.includes(fresh.status)) {
      await log(d, id, { actor: "system", action: "error", startedAt: now(d), finishedAt: now(d), outcome: "error", note: String(err) });
      await setProject(d, id, { status: "failed", resume_status: fresh.status, escalation: `Unexpected error: ${String(err)}` });
    }
    return true;
  }
}

async function runIntake(d: Deps, p: ProjectRow): Promise<void> {
  const a = modelConfig(d.env, "A");
  const prompt = { system: P.intake.system, prompt: P.intake.prompt(p.request, p.revision_note) };
  await ensureBudget(d, p, worstCase(d, a, prompt.system, prompt.prompt));
  const r = await call<{ problem?: string; solution?: string; acceptance?: string[] }>(d, p, a, "intake", prompt);
  const acceptance = (r.acceptance ?? []).filter((c) => typeof c === "string" && c.trim()).slice(0, 10);
  if (!r.problem || !r.solution || !acceptance.length) await fail(d, p, "Intake reply was missing the problem, solution or checks.");
  await setProject(d, p.id, {
    status: "awaiting_approval",
    problem: stripRoleLabels(r.problem!),
    solution: stripRoleLabels(r.solution!),
    acceptance_json: JSON.stringify(acceptance.map(stripRoleLabels)),
  });
}

/** Titles of steps that only review, audit or proofread other work. */
const SELF_REVIEW =
  /\b(audit|audits|auditing|proofread|proof-read|proofreading|self[- ]review|compliance[- ]check|quality[- ](check|assurance|review)|qa (pass|check|review)|fact[- ]check|double[- ]check|final (review|check|pass)|sanity[- ]check|review (and|&|then) (correct|revise|fix|edit|polish)|verify (and|&|then) (correct|revise|fix))\b/i;

/** 1-based indexes of model steps that are self-review busywork. */
export function selfReviewSteps(steps: { title: string; bucket: string }[]): number[] {
  return steps.flatMap((x, i) => (x.bucket === "model" && SELF_REVIEW.test(x.title) ? [i + 1] : []));
}

/** Role labels the models sometimes put in customer-facing text ("Maker: ...", "Checker: ..."). */
export function stripRoleLabels(text: string): string {
  return text.replace(/^[ \t]*(\*\*)?(maker|checker|model [ab])(\*\*)?[ \t]*:[ \t]*(\*\*)?[ \t]*/gim, "");
}

interface PlanReply {
  steps?: { title?: string; detail?: string; check?: string; kind?: string; bucket?: string; depends_on?: number[]; est_tokens?: number }[];
  note?: string;
}

async function runPlan(d: Deps, p: ProjectRow): Promise<void> {
  const a = modelConfig(d.env, "A");
  const prompt = { system: P.plan.system, prompt: P.plan.prompt(spec(p), p.plan_notes) };
  await ensureBudget(d, p, worstCase(d, a, prompt.system, prompt.prompt));
  const r = await call<PlanReply>(d, p, a, "plan", prompt);
  const raw = Array.isArray(r.steps) ? r.steps.slice(0, 20) : [];

  if (!raw.length) {
    // "Nothing worth doing right now" is a valid outcome: end without spending more.
    await setProject(d, p.id, { status: "done", summary: r.note || "Nothing worth doing right now.", finished_at: now(d) });
    return;
  }

  // The checker already reviews every step, so a plan with its own review/audit step is sent
  // straight back (no reviewer call spent on it).
  const reviewSteps = selfReviewSteps(raw.map((x) => ({ title: String(x.title ?? ""), bucket: String(x.bucket ?? "model") })));
  if (reviewSteps.length) {
    const rounds = p.plan_rounds + 1;
    const notes = `Remove ${reviewSteps.map((i) => `step ${i} ("${raw[i - 1].title}")`).join(" and ")}. Never add self-review, audit, compliance-check or proofreading steps: an independent checker already checks every step against its check. Fold any count or rule into the producing step's own check instead.`;
    await setProject(d, p.id, { plan_rounds: rounds, plan_notes: notes });
    await log(d, p.id, { actor: "system", action: "plan_verdict", startedAt: now(d), finishedAt: now(d), outcome: "fail", note: notes });
    if (rounds >= settings(d.env).maxRounds) await escalate(d, p, `Plan rejected ${rounds} times. Last notes: ${notes}`);
    return; // still "planning": the next run replans with these notes
  }

  const kinds: StepKind[] = ["build", "write", "research"];
  const buckets: StepBucket[] = ["model", "user", "blocker"];
  const stmts = [db(d).prepare("DELETE FROM steps WHERE project_id = ?").bind(p.id)];
  raw.forEach((s, i) => {
    const idx = i + 1;
    const deps = (Array.isArray(s.depends_on) ? s.depends_on : [])
      .map(Number)
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= raw.length && n !== idx);
    stmts.push(
      db(d)
        .prepare(
          `INSERT INTO steps (id, project_id, idx, title, detail, check_text, kind, bucket, depends_json, est_tokens, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
        )
        .bind(
          crypto.randomUUID(),
          p.id,
          idx,
          String(s.title ?? `Step ${idx}`).slice(0, 300),
          String(s.detail ?? "").slice(0, 4000),
          String(s.check ?? "").slice(0, 1000),
          kinds.includes(s.kind as StepKind) ? s.kind : "write",
          buckets.includes(s.bucket as StepBucket) ? s.bucket : "model",
          JSON.stringify([...new Set(deps)]),
          Math.min(Math.max(Math.round(Number(s.est_tokens) || 2000), 200), 30000),
        ),
    );
  });
  await db(d).batch(stmts);
  await setProject(d, p.id, { status: "plan_review" });
}

async function runPlanReview(d: Deps, p: ProjectRow): Promise<void> {
  const b = modelConfig(d.env, "B");
  const steps = await loadSteps(d, p.id);
  const planView = steps.map((s) => ({
    step: s.idx,
    title: s.title,
    detail: s.detail,
    check: s.check_text,
    kind: s.kind,
    bucket: s.bucket,
    depends_on: JSON.parse(s.depends_json),
  }));
  const prompt = { system: P.planReview.system, prompt: P.planReview.prompt(spec(p), planView) };
  await ensureBudget(d, p, worstCase(d, b, prompt.system, prompt.prompt));
  const r = await call<{ approved?: boolean; notes?: string }>(d, p, b, "plan_review", prompt, { thinking: settings(d.env).thinkingCheck });
  const s = settings(d.env);

  if (r.approved !== true) {
    const rounds = p.plan_rounds + 1;
    await setProject(d, p.id, { plan_rounds: rounds, plan_notes: r.notes ?? "Rejected without notes." });
    await log(d, p.id, { actor: "B", action: "plan_verdict", startedAt: now(d), finishedAt: now(d), outcome: "fail", note: r.notes ?? null });
    if (rounds >= s.maxRounds) {
      await escalate(d, { ...p, status: "planning" }, `Plan rejected ${rounds} times. Last notes: ${r.notes ?? "none"}`);
    }
    await setProject(d, p.id, { status: "planning" });
    return;
  }

  await log(d, p.id, { actor: "B", action: "plan_verdict", startedAt: now(d), finishedAt: now(d), outcome: "pass", note: r.notes ?? null });
  const checklist: ChecklistItem[] = steps
    .filter((x) => x.bucket !== "model")
    .map((x) => ({ step: x.idx, bucket: x.bucket as "user" | "blocker", title: x.title, detail: x.detail }));
  const planSteps: PlanStep[] = steps.map((x) => ({
    idx: x.idx,
    bucket: x.bucket,
    dependsOn: JSON.parse(x.depends_json),
    estTokens: x.est_tokens,
    text: `${x.title}\n${x.detail}\n${x.check_text}`,
    ...rolesFor(d.env, x.kind),
  }));
  const est = estimate(planSteps, b, s.maxRounds);
  await setProject(d, p.id, {
    status: "awaiting_start",
    checklist_json: JSON.stringify(checklist),
    estimate_json: JSON.stringify(est),
  });
  const spent = (await loadProject(d, p.id)).spent_usd;
  await db(d)
    .prepare(
      `INSERT INTO estimates (project_id, estimated_at, model_steps, math_heavy, est_low_usd, est_high_usd, est_minutes_low, est_minutes_high, preview_usd)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id) DO UPDATE SET estimated_at = excluded.estimated_at, model_steps = excluded.model_steps,
         math_heavy = excluded.math_heavy, est_low_usd = excluded.est_low_usd, est_high_usd = excluded.est_high_usd,
         est_minutes_low = excluded.est_minutes_low, est_minutes_high = excluded.est_minutes_high, preview_usd = excluded.preview_usd`,
    )
    .bind(p.id, now(d), est.modelSteps, est.mathHeavy ? 1 : 0, est.costLowUsd, est.costHighUsd, est.minutesLow, est.minutesHigh, spent)
    .run();
}

/**
 * Record actual cost and time against the estimate when a project stops (done, escalated or
 * failed). Only projects that got an estimate have a row; the latest stop wins, so a resumed
 * project's row reflects its final outcome.
 */
async function recordOutcome(d: Deps, id: string, outcome: "done" | "escalated" | "failed"): Promise<void> {
  const p = await db(d)
    .prepare("SELECT spent_usd, solve_started_at FROM projects WHERE id = ?")
    .bind(id)
    .first<{ spent_usd: number; solve_started_at: number | null }>();
  if (!p) return;
  const since = p.solve_started_at ?? Number.MAX_SAFE_INTEGER;
  const agg = await db(d)
    .prepare(
      `SELECT COALESCE(SUM(cost_usd), 0) AS solve_usd,
              SUM(CASE WHEN model IS NOT NULL THEN 1 ELSE 0 END) AS calls,
              SUM(CASE WHEN outcome = 'retry' THEN 1 ELSE 0 END) AS retries
       FROM events WHERE project_id = ? AND started_at >= ?`,
    )
    .bind(id, since)
    .first<{ solve_usd: number; calls: number | null; retries: number | null }>();
  const t = now(d);
  await db(d)
    .prepare(
      `UPDATE estimates SET outcome = ?, recorded_at = ?, actual_solve_usd = ?, actual_total_usd = ?, actual_solve_minutes = ?,
         model_calls = ?, retries = ? WHERE project_id = ?`,
    )
    .bind(
      outcome,
      t,
      p.solve_started_at ? (agg?.solve_usd ?? 0) : 0,
      p.spent_usd,
      p.solve_started_at ? (t - p.solve_started_at) / 60000 : 0,
      agg?.calls ?? 0,
      agg?.retries ?? 0,
      id,
    )
    .run();
}

type Action = { type: "make" | "check"; step: StepRow; role: Role };

async function runSolve(d: Deps, p: ProjectRow): Promise<boolean> {
  const s = settings(d.env);
  const steps = await loadSteps(d, p.id);
  const done = new Set(steps.filter((x) => x.status === "passed" || x.status === "external").map((x) => x.idx));
  const modelSteps = steps.filter((x) => x.bucket === "model");

  if (modelSteps.every((x) => x.status === "passed")) {
    await setProject(d, p.id, { status: "final_check" });
    return true;
  }

  const ready = modelSteps.filter(
    (x) => x.status !== "passed" && (JSON.parse(x.depends_json) as number[]).every((dep) => done.has(dep)),
  );
  // Checks first: they unblock later steps. Then makes, in plan order.
  const queue: Action[] = [
    ...ready.filter((x) => x.status === "made").map((x) => ({ type: "check" as const, step: x, role: rolesFor(d.env, x.kind).checker.role })),
    ...ready
      .filter((x) => x.status === "pending" || x.status === "failed")
      .map((x) => ({ type: "make" as const, step: x, role: rolesFor(d.env, x.kind).maker.role })),
  ];

  if (!queue.length) {
    const waiting = modelSteps.filter((x) => x.status !== "passed").map((x) => x.idx);
    await escalate(d, p, `The plan is stuck: steps ${waiting.join(", ")} wait on dependencies that cannot finish.`);
  }

  const batch = queue.slice(0, s.parallel);
  await logIdle(d, p, batch, queue, modelSteps);

  // Reserve the worst case for the whole batch up front, so parallel calls can't jointly overrun.
  const prompts = await Promise.all(batch.map((a) => buildPrompt(d, p, a, steps)));
  const reserve = prompts.reduce((n, x, i) => n + worstCase(d, cfgFor(d, batch[i]), x.system, x.prompt, allowanceFor(d, batch[i])), 0);
  await ensureBudget(d, p, reserve);

  const results = await Promise.allSettled(batch.map((a, i) => runAction(d, p, a, prompts[i])));
  const halted = results.find((r) => r.status === "rejected");
  if (halted && halted.status === "rejected" && !(halted.reason instanceof Halt)) throw halted.reason;
  return true;
}

/** Output allowance for an action: a redo of a failed step gets more room for its larger prompt and rewrite. */
function allowanceFor(d: Deps, a: Action): number {
  const s = settings(d.env);
  return a.type === "make" && a.step.status === "failed" ? Math.max(s.retryMaxTokens, s.maxTokens) : s.maxTokens;
}

function cfgFor(d: Deps, a: Action): ModelConfig {
  const r = rolesFor(d.env, a.step.kind);
  return a.type === "make" ? r.maker : r.checker;
}

function depArtifacts(step: StepRow, all: StepRow[]) {
  const deps = JSON.parse(step.depends_json) as number[];
  return all
    .filter((x) => deps.includes(x.idx) && x.bucket === "model" && x.artifact)
    .map((x) => ({ idx: x.idx, title: x.title, artifact: x.artifact as string }));
}

async function buildPrompt(_d: Deps, p: ProjectRow, a: Action, all: StepRow[]) {
  const st = { idx: a.step.idx, title: a.step.title, detail: a.step.detail, check: a.step.check_text };
  if (a.type === "make") {
    return {
      system: P.make.system,
      prompt: P.make.prompt({
        spec: spec(p),
        step: st,
        dependencies: depArtifacts(a.step, all),
        checkerNotes: a.step.status === "failed" ? a.step.checker_notes : null,
        previousArtifact: a.step.status === "failed" ? a.step.artifact : null,
      }),
    };
  }
  // The checker gets the artifact, never the maker's notes.
  return {
    system: P.check.system,
    prompt: P.check.prompt({ spec: spec(p), step: st, artifact: a.step.artifact ?? "", dependencies: depArtifacts(a.step, all) }),
  };
}

async function runAction(d: Deps, p: ProjectRow, a: Action, prompt: { system: string; prompt: string }): Promise<void> {
  const cfg = cfgFor(d, a);
  const s = settings(d.env);
  const step = a.step;
  if (a.type === "make") {
    if (step.rounds === 0 && step.status === "pending") await setStep(d, step.id, { started_at: now(d) });
    const r = await call<{ artifact?: string; notes?: string; needs_human?: string | null }>(d, p, cfg, "make", prompt, {
      stepId: step.id,
      maxTokens: allowanceFor(d, a),
      thinking: s.thinkingMake,
    });
    if (r.needs_human) {
      await setStep(d, step.id, { maker_notes: r.notes ?? null });
      await escalate(d, p, `Step ${step.idx} needs a person: ${r.needs_human}`);
    }
    if (!r.artifact || !String(r.artifact).trim()) await fail(d, p, `Step ${step.idx}: the maker returned an empty artifact.`);
    await setStep(d, step.id, { status: "made", artifact: String(r.artifact), maker_notes: r.notes ?? null });
    return;
  }

  const r = await call<{ pass?: boolean; evidence?: string; notes?: string }>(d, p, cfg, "check", prompt, {
    stepId: step.id,
    thinking: s.thinkingCheck,
  });
  const passed = r.pass === true;
  await db(d)
    .prepare("UPDATE events SET outcome = ? WHERE id = (SELECT MAX(id) FROM events WHERE project_id = ? AND step_id = ? AND action = 'check')")
    .bind(passed ? "pass" : "fail", p.id, step.id)
    .run();
  if (passed) {
    await setStep(d, step.id, { status: "passed", evidence: r.evidence ?? null, checker_notes: r.notes ?? null, finished_at: now(d) });
    return;
  }
  const rounds = step.rounds + 1;
  await setStep(d, step.id, { status: "failed", rounds, evidence: r.evidence ?? null, checker_notes: r.notes ?? "Failed without notes." });
  if (rounds >= s.maxRounds) {
    await escalate(d, p, `Step ${step.idx} ("${step.title}") failed its check ${rounds} times. Last notes: ${r.notes ?? "none"}`);
  }
}

/**
 * Record when a model's queue runs dry, and why. Logged once per dry spell (not every tick),
 * so the roll-up can show what caused idle time.
 */
async function logIdle(d: Deps, p: ProjectRow, batch: Action[], queue: Action[], modelSteps: StepRow[]): Promise<void> {
  for (const role of ["A", "B"] as Role[]) {
    if (batch.some((a) => a.role === role)) continue;
    const last = await db(d)
      .prepare("SELECT action FROM events WHERE project_id = ? AND actor = ? ORDER BY id DESC LIMIT 1")
      .bind(p.id, role)
      .first<{ action: string }>();
    if (last?.action === "queue_empty") continue;
    const other = role === "A" ? "B" : "A";
    const queuedForMe = queue.some((a) => a.role === role);
    const blocked = modelSteps.filter((x) => x.status !== "passed").length;
    const cause = queuedForMe
      ? "parallel limit reached; work is queued"
      : blocked
        ? `waiting on Model ${other} or on step dependencies`
        : "nothing left for this model";
    await log(d, p.id, { actor: role, action: "queue_empty", startedAt: now(d), finishedAt: now(d), note: cause });
  }
}

async function runFinalCheck(d: Deps, p: ProjectRow): Promise<void> {
  const b = modelConfig(d.env, "B");
  const steps = await loadSteps(d, p.id);
  const work = steps.filter((x) => x.bucket === "model").map((x) => ({ idx: x.idx, title: x.title, artifact: x.artifact ?? "" }));
  const userSteps = steps.filter((x) => x.bucket !== "model").map((x) => `Step ${x.idx}: ${x.title}`);
  const prompt = { system: P.finalCheck.system, prompt: P.finalCheck.prompt(spec(p), work, userSteps) };
  await ensureBudget(d, p, worstCase(d, b, prompt.system, prompt.prompt));
  const r = await call<{ results?: { check?: string; pass?: boolean; evidence?: string }[]; summary?: string }>(d, p, b, "final_check", prompt, {
    thinking: settings(d.env).thinkingCheck,
  });
  const results = Array.isArray(r.results) ? r.results : [];
  const acceptance = spec(p).acceptance;
  const failed = results.filter((x) => x.pass !== true);
  if (results.length < acceptance.length || failed.length) {
    const list = failed.map((x) => `"${x.check}": ${x.evidence ?? ""}`).join("; ") || "not every check was answered";
    await escalate(d, p, `Final check did not pass: ${list}`);
  }
  await setProject(d, p.id, { status: "done", summary: r.summary ?? "All acceptance checks passed.", finished_at: now(d) });
  await recordOutcome(d, p.id, "done");
}

// ---------------------------------------------------------------- scheduling

/** Acquire a short lease so the cron and a user-triggered run never advance one project twice. */
async function acquire(d: Deps, id: string): Promise<boolean> {
  const t = now(d);
  const r = await db(d)
    .prepare(
      "UPDATE projects SET lease_until = ?, updated_at = ? WHERE id = ? AND (lease_until IS NULL OR lease_until < ?) RETURNING id",
    )
    .bind(t + LEASE_MS, t, id, t)
    .first<{ id: string }>();
  return Boolean(r);
}

async function release(d: Deps, id: string): Promise<void> {
  await db(d).prepare("UPDATE projects SET lease_until = NULL, updated_at = ? WHERE id = ?").bind(now(d), id).run();
}

/**
 * Advance one project by one step under a lease. Returns true when the project is still
 * active afterwards, so the caller should queue its next step.
 */
export async function runOne(d: Deps, id: string): Promise<boolean> {
  if (!(await acquire(d, id))) return false; // another run holds it; that run queues the next step
  try {
    await advance(d, id);
  } finally {
    await release(d, id);
  }
  const p = await db(d).prepare("SELECT status FROM projects WHERE id = ?").bind(id).first<{ status: ProjectStatus }>();
  return Boolean(p && ACTIVE_STATUSES.includes(p.status));
}

/**
 * Cron sweeper: active projects nobody has touched for `staleMs` and that hold no lease.
 * Normally each step queues the next one, so this only finds chains that broke (a crashed
 * run, a dropped message). The caller re-queues them.
 */
export async function stalled(d: Deps, staleMs = STALE_MS, limit = 25): Promise<string[]> {
  const t = now(d);
  const placeholders = ACTIVE_STATUSES.map(() => "?").join(", ");
  const r = await db(d)
    .prepare(
      `SELECT id FROM projects WHERE status IN (${placeholders}) AND (lease_until IS NULL OR lease_until < ?) AND updated_at < ? ORDER BY updated_at LIMIT ?`,
    )
    .bind(...ACTIVE_STATUSES, t, t - staleMs, limit)
    .all<{ id: string }>();
  return r.results.map((x) => x.id);
}

// ---------------------------------------------------------------- views

export async function projectView(d: Deps, id: string): Promise<ProjectView> {
  const p = await loadProject(d, id);
  const steps = await loadSteps(d, id);
  const events = (await db(d).prepare("SELECT * FROM events WHERE project_id = ? ORDER BY id").bind(id).all<EventRow>()).results;
  const idxById = new Map(steps.map((x) => [x.id, x.idx]));

  const stepViews: StepView[] = steps.map((x) => {
    const r = rolesFor(d.env, x.kind);
    return {
      idx: x.idx,
      title: x.title,
      detail: x.detail,
      check: x.check_text,
      kind: x.kind,
      bucket: x.bucket,
      status: x.status,
      rounds: x.rounds,
      maker: x.bucket === "model" ? `Model ${r.maker.role}` : "You",
      checker: x.bucket === "model" ? `Model ${r.checker.role}` : "-",
      artifact: x.artifact,
      checkerNotes: x.checker_notes,
      evidence: x.evidence,
    };
  });

  const eventViews: EventView[] = events.map((e) => ({
    id: e.id,
    stepIdx: e.step_id ? (idxById.get(e.step_id) ?? null) : null,
    actor: e.actor,
    model: e.model,
    action: e.action,
    startedAt: e.started_at,
    finishedAt: e.finished_at,
    tokensIn: e.tokens_in,
    tokensOut: e.tokens_out,
    costUsd: e.cost_usd,
    outcome: e.outcome,
    note: e.note,
  }));

  return {
    id: p.id,
    status: p.status,
    createdAt: p.created_at,
    request: p.request,
    problem: p.problem && stripRoleLabels(p.problem),
    solution: p.solution && stripRoleLabels(p.solution),
    acceptance: (JSON.parse(p.acceptance_json ?? "[]") as string[]).map(stripRoleLabels),
    checklist: JSON.parse(p.checklist_json ?? "[]"),
    estimate: p.estimate_json ? JSON.parse(p.estimate_json) : null,
    capUsd: PRE_START.includes(p.status) ? p.preview_cap_usd : p.cap_usd,
    previewCapUsd: p.preview_cap_usd,
    projectCapUsd: p.cap_usd,
    spentUsd: p.spent_usd,
    summary: p.summary,
    escalation: p.escalation,
    resumePlan: resumePlan(d, p, steps),
    steps: stepViews,
    events: eventViews,
    idle: idleTime(p, events, now(d)),
  };
}

/**
 * Plain-language description of what Resume will do for a stopped project: which step reruns,
 * who runs it, and what is different this time.
 */
export function resumePlan(d: Deps, p: ProjectRow, steps: StepRow[]): string | null {
  if (p.status !== "escalated" && p.status !== "failed") return null;
  const s = settings(d.env);
  const why = p.escalation ?? "";
  const back = p.resume_status ?? "intake";
  const cap = PRE_START.includes(back) ? p.preview_cap_usd : p.cap_usd;
  const capLine = /dollar cap/i.test(why)
    ? ` It stopped at its $${cap.toFixed(2)} cap, so enter a higher cap or it will stop again at the same point.`
    : ` You can also enter a new cap (now $${cap.toFixed(2)}); leave it blank to keep it.`;

  if (back === "intake") return `Resume drafts the brief again from your request.${capLine}`;
  if (back === "planning" || back === "plan_review") {
    return `Resume has Model A write a new plan using the reviewer's last notes, and resets the plan's rejection count so it gets ${s.maxRounds} fresh tries.${capLine}`;
  }
  if (back === "final_check") {
    return `Resume reruns only the final sign-off: Model B checks every "Done means" item against the work already delivered. No steps are redone.${capLine}`;
  }
  const done = new Set(steps.filter((x) => x.status === "passed" || x.status === "external").map((x) => x.idx));
  const next = steps.filter(
    (x) => x.bucket === "model" && x.status !== "passed" && (JSON.parse(x.depends_json) as number[]).every((dep) => done.has(dep)),
  );
  if (!next.length) return `Resume continues solving from where it stopped.${capLine}`;
  const limitHit = /output limit/i.test(why);
  const lines = next.map((x) => {
    const r = rolesFor(d.env, x.kind);
    const name = `step ${x.idx} ("${x.title}")`;
    if (x.status === "failed") {
      const room = Math.max(s.retryMaxTokens, s.maxTokens).toLocaleString("en-US");
      return `Model ${r.maker.role} redoes ${name} using the checker's notes from its last failed check, with room for ${room} tokens${
        limitHit ? " (it ran out of room last time; if that happens again it gets one more try with double the room)" : ""
      }, then Model ${r.checker.role} checks it`;
    }
    if (x.status === "made") return `Model ${r.checker.role} checks ${name}, which is already written`;
    return `Model ${r.maker.role} makes ${name}, then Model ${r.checker.role} checks it`;
  });
  const reset = next.some((x) => x.rounds > 0) ? ` Failed-check counts reset, so each gets ${s.maxRounds} fresh tries.` : "";
  return `Resume picks up where it stopped: ${lines.join("; ")}. Steps that already passed are kept.${reset}${capLine}`;
}

/**
 * Idle = time a model spent waiting while the project was actively solving. Only periods in an
 * active status count: from the start of solving (or a resume) until the project stops
 * (escalated, failed or done). Busy time is the merged span of that model's calls.
 */
export function idleTime(
  p: Pick<ProjectRow, "solve_started_at" | "finished_at" | "status">,
  events: EventRow[],
  t: number,
): { A: number; B: number } {
  if (p.solve_started_at == null) return { A: 0, B: 0 };
  const start0 = p.solve_started_at;
  const sorted = events
    .filter((e) => (e.finished_at ?? e.started_at) >= start0)
    .sort((x, y) => x.started_at - y.started_at || x.id - y.id);

  // Active intervals: solving starts active; a stop marker (escalate, stopped, or a failed call
  // in older logs) closes the interval; a resume reopens it.
  const intervals: [number, number][] = [];
  let open: number | null = start0;
  for (const e of sorted) {
    const at = e.finished_at ?? e.started_at;
    const stop = e.action === "escalate" || e.action === "stopped" || (e.outcome === "error" && e.actor !== "user");
    if (stop && open !== null) {
      intervals.push([open, Math.max(open, at)]);
      open = null;
    } else if (e.action === "resume" && open === null) {
      open = e.started_at;
    }
  }
  if (open !== null) {
    const stillActive = ACTIVE_STATUSES.includes(p.status);
    const lastSeen = Math.max(open, ...sorted.map((e) => e.finished_at ?? e.started_at));
    const end = p.finished_at ?? (stillActive ? t : lastSeen);
    intervals.push([open, Math.max(open, end)]);
  }
  const activeMs = intervals.reduce((n, [a, b]) => n + (b - a), 0);

  const busy = (role: string) => {
    const spans = sorted
      .filter((e) => e.actor === role && e.finished_at && ["make", "check", "final_check"].includes(e.action))
      .flatMap((e) =>
        // Only the part of a call inside an active interval counts.
        intervals
          .map(([a, b]) => [Math.max(a, e.started_at), Math.min(b, e.finished_at!)] as [number, number])
          .filter(([x, y]) => y > x),
      )
      .sort((x, y) => x[0] - y[0]);
    let total = 0;
    let cur: [number, number] | null = null;
    for (const [s0, f] of spans) {
      if (cur && s0 <= cur[1]) cur[1] = Math.max(cur[1], f);
      else {
        if (cur) total += cur[1] - cur[0];
        cur = [s0, f];
      }
    }
    if (cur) total += cur[1] - cur[0];
    return total;
  };
  return { A: Math.max(0, activeMs - busy("A")), B: Math.max(0, activeMs - busy("B")) };
}

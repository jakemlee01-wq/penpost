/** Shared between the Worker and the front end. No runtime imports here. */

export type ProjectStatus =
  | "intake" // Model A is drafting the problem, solution and acceptance checks
  | "awaiting_approval" // user approves or corrects the draft
  | "planning" // Model A breaks the work into steps
  | "plan_review" // Model B reviews the plan
  | "awaiting_start" // free preview is ready; user starts the paid solve
  | "solving" // maker and checker loop
  | "final_check" // Model B checks every acceptance check
  | "done"
  | "escalated" // waiting on Jake
  | "failed"; // stopped at an unexplained failure; Jake can resume

export const ACTIVE_STATUSES: ProjectStatus[] = ["intake", "planning", "plan_review", "solving", "final_check"];

export type StepKind = "build" | "write" | "research";
export type StepBucket = "model" | "user" | "blocker";
export type StepStatus = "pending" | "made" | "passed" | "failed" | "external";

export interface Estimate {
  costLowUsd: number;
  costHighUsd: number;
  minutesLow: number;
  minutesHigh: number;
  modelSteps: number;
  calls: number;
  /** True when the plan involves calculations (funnels, budgets, targets), which run long and fail checks more. */
  mathHeavy?: boolean;
}

export interface ChecklistItem {
  step: number;
  bucket: "user" | "blocker";
  title: string;
  detail: string;
}

export interface ProjectView {
  id: string;
  status: ProjectStatus;
  createdAt: number;
  request: string;
  problem: string | null;
  solution: string | null;
  acceptance: string[];
  checklist: ChecklistItem[];
  estimate: Estimate | null;
  /** The cap in effect right now: the preview cap before solving starts, the project cap after. */
  capUsd: number;
  /** Limit on the free part (brief, plan, review). */
  previewCapUsd: number;
  /** Limit on the whole project once solving starts. */
  projectCapUsd: number;
  spentUsd: number;
  summary: string | null;
  escalation: string | null;
  /** For a stopped project: what Resume will do, in plain words. */
  resumePlan: string | null;
  steps: StepView[];
  events: EventView[];
  idle: IdleView;
}

export interface StepView {
  idx: number;
  title: string;
  detail: string;
  check: string;
  kind: StepKind;
  bucket: StepBucket;
  status: StepStatus;
  rounds: number;
  maker: string;
  checker: string;
  artifact: string | null;
  checkerNotes: string | null;
  evidence: string | null;
}

export interface EventView {
  id: number;
  stepIdx: number | null;
  actor: string;
  model: string | null;
  action: string;
  startedAt: number;
  finishedAt: number | null;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  outcome: string | null;
  note: string | null;
}

export interface IdleView {
  /** Milliseconds each model spent waiting with an empty queue while solving. */
  A: number;
  B: number;
}

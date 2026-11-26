export interface StepMessage {
  id: string;
}

export interface Env {
  DB: D1Database;
  /** Queue of {id} messages; each message advances one project by one step. */
  STEPS: Queue<StepMessage>;
  /** Secrets (wrangler secret put). */
  ANTHROPIC_API_KEY?: string;
  GEMINI_API_KEY?: string;
  /** Shared code the front end must send while payments are out of scope. */
  ACCESS_CODE?: string;
  /** Vars (wrangler.toml). All optional; defaults live in code. */
  ALLOWED_ORIGINS?: string;
  MODEL_A_PROVIDER?: string;
  MODEL_A?: string;
  MODEL_A_PRICE_IN?: string;
  MODEL_A_PRICE_OUT?: string;
  MODEL_B_PROVIDER?: string;
  MODEL_B?: string;
  MODEL_B_PRICE_IN?: string;
  MODEL_B_PRICE_OUT?: string;
  SWAP_KINDS?: string;
  ANTHROPIC_EFFORT?: string;
  MAX_OUTPUT_TOKENS?: string;
  MAX_ROUNDS?: string;
  PROJECT_CAP_USD?: string;
  PREVIEW_CAP_USD?: string;
  PARALLEL_STEPS?: string;
  [key: string]: unknown;
}

export function num(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && v !== undefined && v !== "" ? n : fallback;
}

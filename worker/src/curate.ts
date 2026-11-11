/**
 * On-demand editions: the Worker side of the "See today's paper" button.
 *
 *   POST /curate          {"date": "2026-10-19", "topics": ["local-twin-cities", "mn-business"]}
 *   GET  /curate/status   ?date=2026-10-19&topics=local-twin-cities,mn-business
 *
 * The Worker stays thin. It reads the day's topic manifest (content/topics/<date>.json) and the
 * recent workflow runs from GitHub, and for topics nobody has generated yet it dispatches the
 * "Draft daily edition" workflow with just those topic IDs. GitHub Actions does the work.
 *
 * A topic is "ready" for a reader only when its stories are live on the site: the manifest says
 * ready AND a "Test, build, deploy" run that started after the topic finished has succeeded.
 *
 * Reply shapes (both endpoints):
 *   {"status": "ready", "readyAt": ISO, "ready": n, "total": n, "failed": [...]}
 *   {"status": "generating", "pending": [...], "ready": n, "total": n}
 *   {"status": "failed", "failed": [...], "ready": 0, "total": n}
 * The app compares readyAt with its own build time to know whether it needs to reload. readyAt is
 * empty when none of the topics added stories (nothing new to load).
 */
import type { Areas } from "../../src/lib/areas";
import { chicagoDate } from "../../src/lib/dates";
import { MAX_CURATE_TOPICS, TOPIC_ID_PATTERN, allTopicIds, isRealDate, isWeekend, parseManifest, type TopicManifest } from "../../src/lib/topics";

export interface CurateEnv {
  /**
   * Secret: `npx wrangler secret put GITHUB_TOKEN --config worker/wrangler.toml`. A fine-grained token
   * for this one repository with Actions read/write and Contents read, nothing else.
   */
  GITHUB_TOKEN?: string;
  /** owner/repo. Defaults to jakemlee01-wq/penpost. */
  GITHUB_REPO?: string;
}

export const DRAFT_WORKFLOW = "draft-edition.yml";
export const DEPLOY_WORKFLOW = "deploy.yml";
const RUN_TITLE_PREFIX = "Draft edition: ";
const CACHE_MS = 8000;

type Reply = { status: number; body: Record<string, unknown> };
export type Run = { status: string; conclusion: string | null; created_at: string; display_title?: string; event?: string };

// ---------------------------------------------------------------------------
// Validation

export function validateCurate(
  input: { date?: unknown; topics?: unknown },
  areas: Areas,
  now: Date,
): { date: string; topics: string[] } | { error: string } {
  const { date, topics } = input;
  if (!isRealDate(date)) return { error: "date must be a real YYYY-MM-DD" };
  if (date !== chicagoDate(now)) return { error: "only today's paper can be curated" };
  if (isWeekend(date)) return { error: "no new editions on weekends" };
  if (!Array.isArray(topics) || topics.length === 0) return { error: "topics must be a non-empty list" };
  if (topics.length > MAX_CURATE_TOPICS) return { error: `at most ${MAX_CURATE_TOPICS} topics` };
  const known = new Set(allTopicIds(areas.regions));
  for (const t of topics) {
    if (typeof t !== "string" || !TOPIC_ID_PATTERN.test(t) || !known.has(t)) return { error: "unknown topic id" };
  }
  return { date, topics: [...new Set(topics as string[])] };
}

// ---------------------------------------------------------------------------
// Deciding what each topic needs (pure, so it's easy to test)

export type Evaluation = { ready: string[]; pending: string[]; failed: string[]; missing: string[]; readyAt: string };

/** Topics a queued or running draft run already covers, from its run title. */
export function coveredByActiveRuns(runs: Run[], all: string[]): Set<string> {
  const out = new Set<string>();
  for (const r of runs) {
    if (r.status === "completed") continue;
    const title = r.display_title ?? "";
    if (!title.startsWith(RUN_TITLE_PREFIX)) {
      // A run without our title (an older run, or a manual one): assume it covers everything.
      all.forEach((t) => out.add(t));
      continue;
    }
    const list = title.slice(RUN_TITLE_PREFIX.length).trim();
    if (list === "all topics") all.forEach((t) => out.add(t));
    else list.split(",").map((s) => s.trim()).filter(Boolean).forEach((t) => out.add(t));
  }
  return out;
}

export function evaluate(topics: string[], manifest: TopicManifest, draftRuns: Run[], deployRuns: Run[], all: string[]): Evaluation {
  const activeDraft = draftRuns.some((r) => r.status !== "completed");
  const activeDeploy = deployRuns.some((r) => r.status !== "completed");
  const covered = coveredByActiveRuns(draftRuns, all);
  const out: Evaluation = { ready: [], pending: [], failed: [], missing: [], readyAt: "" };
  for (const id of topics) {
    const e = manifest.topics[id];
    if (e?.status === "ready") {
      const finished = e.finishedAt ?? "";
      // No new stories means nothing to deploy; otherwise wait for a deploy that started after the topic finished.
      const live = !e.storiesWritten || deployRuns.some((r) => r.conclusion === "success" && r.created_at >= finished);
      if (live) {
        out.ready.push(id);
        // Only topics that added stories need a newer build; a topic with no news needs nothing.
        if (e.storiesWritten && finished > out.readyAt) out.readyAt = finished;
      } else if (activeDeploy || activeDraft) out.pending.push(id);
      else out.failed.push(id); // stories written but the deploy failed: regenerating wouldn't help
    } else if (e?.status === "pending") {
      (activeDraft ? out.pending : out.missing).push(id);
    } else {
      // Not started, or a failed attempt: in progress only if a queued or running run covers it.
      (covered.has(id) ? out.pending : out.missing).push(id);
    }
  }
  return out;
}

function summarize(ev: Evaluation, total: number, missingIs: "pending" | "failed"): Record<string, unknown> {
  const pending = missingIs === "pending" ? [...ev.pending, ...ev.missing] : ev.pending;
  const failed = missingIs === "failed" ? [...ev.failed, ...ev.missing] : ev.failed;
  if (pending.length) return { status: "generating", pending, ready: ev.ready.length, total };
  if (ev.ready.length) return { status: "ready", readyAt: ev.readyAt, ready: ev.ready.length, total, failed };
  return { status: "failed", failed, ready: 0, total };
}

// ---------------------------------------------------------------------------
// GitHub

const cache = new Map<string, { at: number; value: unknown }>();
export function _clearCache() {
  cache.clear();
}

class GitHubError extends Error {}

function repo(env: CurateEnv): string {
  return env.GITHUB_REPO || "jakemlee01-wq/penpost";
}

async function gh(env: CurateEnv, path: string, fetchImpl: typeof fetch, init: { method?: string; body?: unknown; raw?: boolean } = {}): Promise<Response> {
  return fetchImpl(`https://api.github.com/repos/${repo(env)}${path}`, {
    method: init.method ?? "GET",
    headers: {
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      accept: init.raw ? "application/vnd.github.raw+json" : "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "penpost-worker",
      ...(init.body ? { "content-type": "application/json" } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
}

async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value as T;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  return value;
}

export async function loadManifest(env: CurateEnv, date: string, fetchImpl: typeof fetch): Promise<TopicManifest> {
  return cached(`manifest:${date}`, async () => {
    const res = await gh(env, `/contents/content/topics/${date}.json?ref=main`, fetchImpl, { raw: true });
    if (res.status === 404) return parseManifest(null, date);
    if (!res.ok) throw new GitHubError(`manifest: ${res.status}`);
    return parseManifest(await res.text(), date);
  });
}

async function listRuns(env: CurateEnv, workflow: string, fetchImpl: typeof fetch): Promise<Run[]> {
  return cached(`runs:${workflow}`, async () => {
    const res = await gh(env, `/actions/workflows/${workflow}/runs?branch=main&per_page=10`, fetchImpl);
    if (!res.ok) throw new GitHubError(`runs ${workflow}: ${res.status}`);
    const data = (await res.json()) as { workflow_runs?: Run[] };
    return (data.workflow_runs ?? []).filter((r) => r.event !== "pull_request");
  });
}

async function dispatch(env: CurateEnv, date: string, topics: string[], fetchImpl: typeof fetch): Promise<void> {
  const res = await gh(env, `/actions/workflows/${DRAFT_WORKFLOW}/dispatches`, fetchImpl, {
    method: "POST",
    body: { ref: "main", inputs: { date, topics: topics.join(",") } },
  });
  if (!res.ok) throw new GitHubError(`dispatch: ${res.status}`);
  // The next status check should see the new run, not a cached list.
  cache.delete(`runs:${DRAFT_WORKFLOW}`);
}

async function look(env: CurateEnv, date: string, topics: string[], areas: Areas, fetchImpl: typeof fetch): Promise<Evaluation> {
  const manifest = await loadManifest(env, date, fetchImpl);
  const draftRuns = await listRuns(env, DRAFT_WORKFLOW, fetchImpl);
  const needsDeploy = topics.some((t) => manifest.topics[t]?.status === "ready" && manifest.topics[t]?.storiesWritten);
  const deployRuns = needsDeploy ? await listRuns(env, DEPLOY_WORKFLOW, fetchImpl) : [];
  return evaluate(topics, manifest, draftRuns, deployRuns, allTopicIds(areas.regions));
}

// ---------------------------------------------------------------------------
// Endpoints

export async function curate(body: unknown, env: CurateEnv, areas: Areas, fetchImpl: typeof fetch = fetch, now = new Date()): Promise<Reply> {
  const v = validateCurate((body ?? {}) as { date?: unknown; topics?: unknown }, areas, now);
  if ("error" in v) return { status: 400, body: { error: v.error } };
  if (!env.GITHUB_TOKEN) return { status: 503, body: { error: "curate not configured" } };
  try {
    const ev = await look(env, v.date, v.topics, areas, fetchImpl);
    if (ev.missing.length) await dispatch(env, v.date, ev.missing, fetchImpl);
    return { status: 200, body: summarize(ev, v.topics.length, "pending") };
  } catch (e) {
    console.warn(`curate: ${(e as Error).message}`);
    return { status: 502, body: { error: "github error" } };
  }
}

export async function curateStatus(params: URLSearchParams, env: CurateEnv, areas: Areas, fetchImpl: typeof fetch = fetch, now = new Date()): Promise<Reply> {
  const topics = (params.get("topics") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const v = validateCurate({ date: params.get("date"), topics }, areas, now);
  if ("error" in v) return { status: 400, body: { error: v.error } };
  if (!env.GITHUB_TOKEN) return { status: 503, body: { error: "curate not configured" } };
  try {
    // Read-only: topics nobody is working on count as failed, so the app can offer a retry.
    const ev = await look(env, v.date, v.topics, areas, fetchImpl);
    return { status: 200, body: summarize(ev, v.topics.length, "failed") };
  } catch (e) {
    console.warn(`curate status: ${(e as Error).message}`);
    return { status: 502, body: { error: "github error" } };
  }
}

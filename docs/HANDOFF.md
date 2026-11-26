# PenPost Problem Solver: Handoff Brief

Status as of 2026-11-26 (updated after the first deployment). This brief is self-contained: it assumes you have the repo but none of the earlier conversation.

## 0. Where things stand right now (read this first)

- **The Worker is deployed** on the Cloudflare **Free** plan. Jake wants to stay on Free for now.
  - Worker: `penpost-solver` at https://penpost-solver.jakemlee01.workers.dev
  - D1 database: `penpost-solver`, id `2084e04b-c786-4cd5-863c-8a2f2c6d10c5`, migration `0001_init.sql` applied.
  - Queue: `penpost-solver-steps`. The Worker is both its producer and its consumer.
  - Cron: `* * * * *`. It only sweeps stalled projects back onto the queue.
- **Check after deploy:**
  - `GET /api/projects/x` from origin `https://penpost.co` returns `503 {"error":"server not configured"}`. That is expected until `ACCESS_CODE` is set.
  - A request from another origin gets 403.
  - The CORS preflight returns 204.
- **Not done yet, waiting on Jake:** adding the three Worker secrets in the Cloudflare dashboard (Workers & Pages, then `penpost-solver`, Settings, Variables and Secrets, type Secret): `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `ACCESS_CODE`. Jake sets monthly spend limits on both model keys first.
- **Not done yet, needs Jake's OK:** merging `claude/bold-babbage-kqgmx3` to `main`. That deploys the new site to penpost.co through GitHub Pages, replacing what's there, and removes the old news workflow. Nothing has been pushed to `main`.
- **Next task once the secrets are in:** build order step 4. Run one small real problem end to end through the deployed Worker. Then check that it doesn't stall from the Free plan's CPU limit (section 12, item 2), compare the logged cost (`events` table) with the Anthropic and Google dashboards, and fix any prompts whose replies don't parse as JSON.
- **Update 2026-11-26, later:** the secrets are in, Jake set $5 spend limits per model key, and the branch is merged to `main` (fast-forward, now `c0462a4` or later).
  - **The site is live on penpost.co** (deploy run 70, 2026-11-26). Jake re-enabled the "Test, build, deploy" workflow, which had been disabled manually, and Pages is set to Source "GitHub Actions" with the custom domain penpost.co. www.penpost.co redirects to penpost.co. The built bundle points at the Worker URL. Pushes to `main` should now deploy on their own; if one doesn't, run the workflow by hand.
- **First live test run (done):** "Write a 150-word product description for a reusable water bottle."
  - **Driven directly, not through the site:** Claude couldn't read `ACCESS_CODE`, so it skipped the website and drove the live Worker directly. It inserted the project and the user actions into D1, the same way the API does, and pushed queue messages through the Cloudflare API.
  - **Result:** intake, plan, plan review, make, step check and final check all ran on the real models. The description came out at exactly 150 words with no digits.
  - **Bug found and fixed:** the final check counted the prompt's `--- Step 1: …` label as part of the work and failed it. Artifacts are now wrapped in `<deliverable>` tags (`c0462a4`). After the fix was deployed and the project resumed, it finished `done`.
  - **Totals:**
    - 7 model calls.
    - Logged cost $0.0542: Haiku $0.0027 (3 calls) and Gemini $0.0515 (4 calls, priced at the 2027 rate; about $0.026 at the current introductory rate).
    - The solve took about 2.5 minutes of wall time. The estimate shown was $0.04 to $0.05 and 2 to 4 minutes.
    - Nothing stalled on the Free plan's CPU limit.
- **Changes in the latest round:**
  - **Models:** Model A is now `claude-haiku-5-5` ($0.10 / $0.50 per million tokens) and Model B is `gemini-3.8-flash`. Model B is priced at $1.50 / $7.50, Google's rate from 2027-01-01, to stay conservative; the introductory rate until 2026-12-31 is $0.75 / $3.75. Haiku doesn't accept the Anthropic server-side refusal fallback, so `models.ts` only sends `fallbacks` for models in `SERVER_FALLBACK_MODELS`.
  - **Caps:** `PREVIEW_CAP_USD` is $0.50 and `PROJECT_CAP_USD` is $2. These are the defaults in both `wrangler.toml` and the code.
  - **Execution:** steps now run as queue consumers, one message per step, batch size 1, `max_retries = 0`. Each step queues the next while the project is active. User actions queue the first step. The lease is 16 minutes, longer than the consumer's 15-minute wall time. The cron calls `sweep()`, which re-queues active, unleased projects untouched for 2 minutes. `tick()` was replaced by `stalled()`/`sweep()`.
  - **Estimator:** time constants retuned for fast models and queue hand-off (40 seconds per call, 5 seconds per hand-off).
  - **Site:** `deploy.yml` builds with `VITE_API_URL` set to the `PENPOST_API_URL` repo variable if present, else the Worker URL above.
  - **Tests:** 20, all passing. Both typechecks are clean.
- **How Claude deployed:** a Cloudflare API token, account `b0200d37fc44add03e63f4f82e4786ab`, held by Claude's cloud environment. Your session will need its own way to run `wrangler`: `npx wrangler login`, or a `CLOUDFLARE_API_TOKEN` with Workers Scripts, D1 and Queues edit permissions. Redeploy with `npm run worker:deploy`; run `npm run db:migrate:remote` only when the migrations change.

---

## 1. What we are building

A problem-solving tool on **penpost.co**. A user states a problem and the solution they want. They get a **free preview** (feasibility, cost estimate, time estimate, and a before-we-start checklist). They can then pay to have **two independent AI models from different providers** solve it together in a **maker and checker loop**.

The owner is **Jake**. Anything that spends real money, uses real credentials or production systems, puts something live, or contacts outside people must **escalate to Jake** rather than proceed.

### The original requirements (summarized from Jake's build brief)

- **Reuse existing infrastructure:** the existing repo, GitHub Pages deployment, Cloudflare account, Worker setup and DNS. Delete what the new tool doesn't need. Don't rebuild what already works. Confirm deletions with Jake first. *(Done: Jake approved the deletion list.)*
- **Front end:** a static site on GitHub Pages at penpost.co. No API keys in the front end.
- **Back end:** a Cloudflare Worker that holds both model API keys as secrets (Anthropic and Google Gemini) and runs the orchestrator. State lives in Cloudflare D1. *(Jake chose D1 over KV.)*
- **Orchestrator:** plain code, not an AI. It passes messages between the models, saves state and enforces limits. A Worker request can't run long, so the loop runs **one step per invocation**, triggered by a Cron Trigger or a queue, picking up saved state each time.
- **Spend limits:** before keys go in, Jake sets hard monthly spend limits in the Anthropic and Google consoles.
- **Flow:**
  1. Intake: problem statement, solution statement, pass/fail acceptance checks. The user approves. This is the main human touchpoint.
  2. Plan: Model A breaks the work into high-level steps, each with its own pass/fail check. Model B reviews the plan before any work starts.
  3. Free preview: feasibility, cost, time and a before-we-start checklist. Never show step-by-step scripts or prompts.
  4. Solve: maker and checker loop, step by step, after the user pays.
  5. Done: all acceptance checks pass and a final summary is delivered.
- **Maker and checker loop:** modeled on accounting segregation of duties.
  - Model A builds a step. Model B checks it only against the step's check and independent evidence (test results, the written spec, real data).
  - Model B never accepts Model A's own explanation as evidence.
  - A failed step goes back to Model A with notes.
  - Use two different providers so the models have different blind spots. Roles can swap by step type.
- **Queue behavior:**
  - Work is handed off as a queue, not single tasks, so neither side sits idle.
  - Run independent steps in parallel. Batch questions for the other model into one message. Hand off only true blockers.
  - Every queued item must tie to a planned step.
  - "Nothing worth doing right now" is a valid outcome: the run ends without spending on busy work.
- **Feasibility buckets:**
  1. The models can do it alone (copy, code, research).
  2. The user must do it (creating accounts, payment details, identity verification). Models never sign up for accounts; the user creates them and provides a limited access token.
  3. Blockers: legal, tax or business registration steps that need a real person.

  The before-we-start checklist comes from buckets 2 and 3.
- **Cost and time estimator:** after planning, estimate tokens per step times each model's price, plus a buffer for failed checks and retries. Show ranges (for example $2 to $5, and a time range). Log the actual cost and time per project against the estimate, and use that history to improve future estimates.
- **Guardrails:**
  1. Maximum rounds per step, then escalate to Jake.
  2. A dollar cap per project, enforced by the orchestrator, on top of the console spend limits.
  3. Escalate to Jake for spending money, real credentials or production systems, going live, or contacting outside people.
  4. Stop at the first unexplained failure. No silent retries past the cap.
- **Logging and audit:** for every step, log who did it, start time, finish time, when the queue ran dry, idle time, tokens, cost, and pass or fail. Show a per-project roll-up with average idle time per cycle and what caused it.
- **Interface:** very simple. Build a bare-bones version alongside the back end so Jake can see the loop working; polish later.
  1. Problem screen: one box.
  2. Confirm screen: problem, solution, acceptance checks and the free preview, with an approve button.
  3. Progress screen: a live feed of steps showing who did what, pass or fail, cost so far, and idle time.
- **Build order:**
  1. Audit the existing repo and Cloudflare setup; propose what to keep and delete. **Done.**
  2. Worker with secrets, database, and the one-step-per-run orchestrator. **Done and deployed** (Cloudflare Free plan). The model keys and access code are not set yet.
  3. Bare-bones interface wired to it. **Done.** It goes live on penpost.co once the branch merges to `main`.
  4. Run one small test problem end to end with low caps. **Not done: waiting on the three secrets.**
  5. Add the estimator, feasibility check and logging roll-up. **Partly done** (see section 9).
  6. Payments come later and are out of scope.

---

## 2. Repository state

- **Repo:** `jakemlee01-wq/penpost` on GitHub.
- **Working branch:** `claude/bold-babbage-kqgmx3`, pushed to origin. **Not merged to `main`.** No PR is open for it yet.
- **Commits on the branch, on top of `main`:**
  - `3ebc685`: removes the old Penpost news product.
  - `c0d6c42`: adds the problem solver (Worker, D1 schema, site, tests).
  - `ab76611`: adds this handoff brief.
  - `548fe74`: switches step execution to a Cloudflare Queue, switches the models to Haiku and Gemini Flash, lowers the caps, and records the deployment.
  - plus a small commit that updates this brief.
- **`main` still holds the old news app.** Until this branch merges, the old `draft-edition.yml` workflow on `main` is still scheduled for weekdays at 09:00 UTC. It calls Gemini with the repo's `GEMINI_API_KEY` Actions secret and pushes editions to `main`. The last edition is dated 2026-10-27, so it may already be failing or disabled. Merging this branch deletes that workflow.

### What was removed (the old product)

Penpost used to be a Minnesota news reader: React app, stories, editions, a Gemini drafting pipeline, AI writer avatars, a `penpost-setup` Cloudflare Worker that parsed reader setup text, and photo workflows. All of it was deleted from the branch:

- **App and content:** `src/`, `content/`, `pipeline/`, `source-assets/`, `public/`, `docs/PENPOST_BRIEF.md`.
- **Old Worker and tests:** the old `worker/` and `tests/`.
- **Old scripts:** `scripts/backfill-photos.ts`, `scripts/fetch-photos.ts`, `scripts/validate-content.ts`, `scripts/artifact-copy.py`.
- **Workflows:** `.github/workflows/draft-edition.yml`, `.github/workflows/backfill-photos.yml`.
- **Leftovers:** the committed `tsconfig.tsbuildinfo`.

The "senior living newsletter" Jake mentioned is **not in this repo**. The "hub prototype" exists only on branch `feat/private-hub-stage1a` (draft PR #21, about 2,100 lines under `hub/`, never merged). It is untouched.

### Kept

- `.github/workflows/deploy.yml`: test, build and deploy to GitHub Pages (updated, see section 7).
- The Vite + TypeScript + Vitest tooling, and `.gitignore`.
- `scripts/screenshots.mjs`, **a leftover from the news app** that is not adapted to the new screens. Delete it or rewrite it.
- The penpost.co custom domain. It is configured in the GitHub Pages settings, not by a CNAME file in the repo.

---

## 3. Architecture

```text
Browser (penpost.co, GitHub Pages, static)
   │  fetch + x-access-code header
   ▼
Cloudflare Worker "penpost-solver"
   ├─ fetch handler: REST API (create / read / approve / revise / start / resume)
   │     └─ after each user action: STEPS.send({id})                     ← queue the next step
   ├─ queue consumer (penpost-solver-steps, batch size 1, no retries):
   │     runOne(id) = one step under a lease; if still active → STEPS.send({id}) again
   ├─ scheduled handler: cron "* * * * *" → sweep(): re-queue active projects whose chain broke
   ├─ D1 database "penpost-solver" (binding DB): projects, steps, events
   └─ secrets: ANTHROPIC_API_KEY, GEMINI_API_KEY, ACCESS_CODE
         │
         ├─ Model A: Anthropic Messages API via @anthropic-ai/sdk (default claude-haiku-5-5)
         └─ Model B: Gemini generateContent REST (default gemini-3.8-flash)
```

- **Stack:**
  - TypeScript everywhere.
  - Front end: plain TypeScript with no framework, built by Vite 5.
  - Worker: bundled by Wrangler 4.
  - Tests: Vitest 2 on Node 22, using `node:sqlite` as a D1 stand-in.
- **Dependencies:**
  - Runtime: `@anthropic-ai/sdk` ^1.14.0, used only by the Worker.
  - Dev: `typescript`, `vite`, `vitest`, `wrangler`, `@cloudflare/workers-types`, `@types/node`.

---

## 4. File map

```text
index.html                       site shell; loads src/main.ts and src/style.css
src/main.ts                      the whole front end: access-code screen, problem screen, project screen
src/style.css                    light/dark tokens, phone-first layout
worker/wrangler.toml             Worker config: cron, queue producer and consumer, D1 binding (real id), vars
worker/tsconfig.json             Worker-only typecheck (workers-types)
worker/migrations/0001_init.sql  D1 schema: projects, steps, events
worker/src/index.ts              HTTP routing, CORS, access code, queue consumer (consume), cron sweeper (sweep)
worker/src/engine.ts             the orchestrator: state machine, guardrails, logging, view builder
worker/src/prompts.ts            system and user prompts for each action (all replies are JSON)
worker/src/models.ts             model configs, Anthropic and Gemini callers, cost math, JSON extraction
worker/src/estimate.ts           cost and time estimate from the reviewed plan
worker/src/env.ts                Env interface (bindings, secrets, vars) and a num() helper
worker/src/types.ts              shared types for the Worker and the front end (ProjectView etc.)
tests/d1.ts                      minimal D1 stand-in over node:sqlite; runs the real migration
tests/engine.test.ts             20 tests: full loop with scripted fake models, guardrails, HTTP
.github/workflows/deploy.yml     CI: test, typecheck the Worker, build the site, deploy Pages (main only)
README.md                        setup and developer guide
docs/HANDOFF.md                  this file
```

---

## 5. Data model (D1, `worker/migrations/0001_init.sql`)

Times are Unix milliseconds. Money is USD.

**`projects`**

| Column | Meaning |
|---|---|
| `id` | UUID |
| `status` | see the state machine in section 6 |
| `resume_status` | the status to return to when an escalation is cleared |
| `request` | the user's original text (max 8,000 chars) |
| `revision_note` | the user's correction to the intake draft |
| `problem`, `solution`, `acceptance_json` | the intake output; acceptance is a string[] |
| `plan_notes`, `plan_rounds` | the reviewer's rejection notes and the rejection count |
| `checklist_json` | the before-we-start items (`user` and `blocker` steps) |
| `estimate_json` | `{costLowUsd, costHighUsd, minutesLow, minutesHigh, modelSteps, calls}` |
| `cap_usd`, `preview_cap_usd`, `spent_usd` | the solve cap, the preview cap, and the running spend |
| `summary`, `escalation` | the final summary, or why the project is paused |
| `lease_until` | lock so two runs never advance the same project |
| `solve_started_at`, `finished_at` | timestamps |

**`steps`**: `id`, `project_id`, `idx` (1-based), `title`, `detail`, `check_text`, `kind` (`build`/`write`/`research`), `bucket` (`model`/`user`/`blocker`), `depends_json` (an array of idx), `est_tokens`, `status` (`pending`/`made`/`passed`/`failed`/`external`), `rounds` (failed checks so far), `artifact` (the maker's work product), `maker_notes` (the maker's explanation, **never shown to the checker**), `checker_notes`, `evidence`, `started_at`, `finished_at`.

**`events`** (the audit log): one row per model call or notable event.
- Columns: `actor` (`A`/`B`/`system`/`user`), `provider`, `model`, `action`, `started_at`, `finished_at`, `tokens_in`, `tokens_out`, `cost_usd`, `outcome` (`pass`/`fail`/`ok`/`error`), `note`.
- Actions: `submit`, `intake`, `approve`, `revise`, `plan`, `plan_review`, `plan_verdict`, `start`, `make`, `check`, `final_check`, `queue_empty`, `escalate`, `error`, `resume`.

---

## 6. The state machine (`worker/src/engine.ts`)

```text
intake ──(A drafts brief)──▶ awaiting_approval ──user approves──▶ planning
   ▲                              │
   └────────user "revise"─────────┘
planning ──(A plans; empty plan ⇒ done "nothing worth doing")──▶ plan_review
plan_review ──(B rejects; notes back)──▶ planning   [after MAX_ROUNDS rejections ⇒ escalated]
plan_review ──(B approves; build checklist + estimate)──▶ awaiting_start
awaiting_start ──user starts (must confirm checklist; low estimate must be ≤ cap)──▶ solving
solving ──(maker/checker rounds until all model steps pass)──▶ final_check
final_check ──(B passes every acceptance check)──▶ done
any active state ──guardrail──▶ escalated     any active state ──error──▶ failed
escalated/failed ──Jake "resume" (optional new cap)──▶ resume_status
```

- **Active statuses** (those that keep queuing steps): `intake`, `planning`, `plan_review`, `solving`, `final_check`.
- **`advance(deps, id)`** does exactly one unit of work and returns.
- **`runOne`** wraps `advance` in a lease. It takes `UPDATE … WHERE lease_until IS NULL OR lease_until < now … RETURNING id` and also bumps `updated_at`. The lease lasts 16 minutes, longer than a queue consumer's 15-minute limit. `runOne` returns true if the project is still active, and the consumer then queues the next step. If the lease is taken, the message is dropped: the run holding the lease queues the next step itself.
- **`stalled` / `sweep`:** the cron finds active projects with no lease that haven't been touched for 2 minutes (a broken chain), and re-queues them with `sendBatch`.
- **Why one message per step:** the Free plan allows 50 D1 queries per invocation, and one solve step uses about 25 at most. Batch size 1 keeps each invocation well under that.

### One solving "step" (`runSolve`)

1. Load the steps. A dependency counts as satisfied when it is `passed` or `external`. `user` and `blocker` steps become `external` when the user starts the solve.
2. If every `model` step has passed, move to `final_check`.
3. Build the queue from the ready steps (all dependencies satisfied). **Checks come first**, because they unblock later steps; then makes in plan order. A `made` step needs a check; a `pending` or `failed` step needs a make.
4. If the queue is empty but steps remain, escalate: "plan is stuck" (for example, a dependency cycle).
5. Take up to `PARALLEL_STEPS` actions. For each model with no action in this batch, log `queue_empty` with a cause, but only once per dry spell.
6. Reserve the worst-case cost of the whole batch up front, then run the batch with `Promise.allSettled`.

### Who does what

- **Default:** Model A makes and Model B checks.
- **Swap:** for step kinds listed in `SWAP_KINDS` (default `research`), Model B makes and Model A checks.
- **Fixed roles:** intake and planning are always Model A. Plan review and the final check are always Model B.

### Segregation of duties (how it's enforced)

- The checker prompt contains the spec, the step's check, the artifact, and the artifacts of dependency steps. It never contains `maker_notes`.
- The maker's reply shape is `{"artifact", "notes", "needs_human"}`. Only `artifact` is passed on.
- The checker's system prompt tells it not to accept claims inside the artifact as evidence.
- A test asserts that a marker string in the maker's notes never appears in any check or final-check prompt.

### Retries

A failed check increments `rounds`, stores the checker's notes, and sets the step to `failed`. The next make for that step includes the notes and the previous artifact. When `rounds` reaches `MAX_ROUNDS`, the project escalates.

---

## 7. Guardrails, as implemented

| Guardrail | Implementation |
|---|---|
| Max rounds | `MAX_ROUNDS` (default 3) per step and per plan, then `escalated` |
| Dollar cap | `ensureBudget` runs before every call or batch. It reserves the worst case (approx input tokens, taken as prompt chars / 3.5, plus the full `MAX_OUTPUT_TOKENS` allowance, at the configured prices). If spent + reserve > cap, the project escalates **before** the call. The cap is `preview_cap_usd` (default $0.50) before the solve starts and `cap_usd` (default $2) after. |
| Start gate | The start is refused if the checklist exists and isn't confirmed, or if the estimate's low end is above `cap_usd`. |
| Escalate to Jake | The maker returns `needs_human` (money, credentials, production, going live, contacting people), a cap is hit, the plan is stuck, the plan is rejected too often, a step fails too often, or the final check fails. |
| Stop at first unexplained failure | An API error, a reply with no parseable JSON, an empty artifact, or a missing intake field sets the project to `failed` with the reason. The orchestrator never retries. (The Anthropic SDK's own transport retries, `maxRetries: 2` for 429/5xx, still apply.) Unexpected exceptions also set `failed`. |
| Access control | Every API request needs the `x-access-code` header to equal the `ACCESS_CODE` secret (constant-time compare). There's a CORS allowlist (`ALLOWED_ORIGINS`), and requests with a disallowed `Origin` get 403. If `ACCESS_CODE` is unset, the API returns 503. |
| Nothing worth doing | If the plan returns an empty `steps` array, the project goes straight to `done`, using the model's `note` as the summary. |

---

## 8. HTTP API (`worker/src/index.ts`)

Every route requires `x-access-code`. JSON in and out. Errors come back as `{"error": "..."}` with 400, 401, 403, 404, 409, 503 or 500.

| Method and path | Body | Effect |
|---|---|---|
| `POST /api/projects` | `{request}` | creates a project in `intake`, kicks it, returns `201 {id}` |
| `GET /api/projects/:id` | none | returns a `ProjectView` (see `worker/src/types.ts`) |
| `POST /api/projects/:id/approve` | none | `awaiting_approval` to `planning` |
| `POST /api/projects/:id/revise` | `{note}` | `awaiting_approval` back to `intake`, with the note |
| `POST /api/projects/:id/start` | `{confirmed: bool}` | `awaiting_start` to `solving` |
| `POST /api/projects/:id/resume` | `{capUsd?}` (0 to 500) | `escalated`/`failed` back to `resume_status`; resets plan rounds or step rounds |

`ProjectView` includes the status, the brief, the checklist, the estimate, the cap in effect, the amount spent, the summary or escalation, the steps (with maker and checker labels, artifact, checker notes and evidence), every event, and the idle time per model.

**Idle time** is the solving wall time minus the merged durations of that model's `make`/`check`/`final_check` calls.

---

## 9. Configuration (`worker/wrangler.toml` `[vars]`)

| Var | Default | Notes |
|---|---|---|
| `ALLOWED_ORIGINS` | `https://penpost.co,https://www.penpost.co,http://localhost:5173` | |
| `MODEL_A_PROVIDER` / `MODEL_A` | `anthropic` / `claude-haiku-5-5` | Haiku takes no server-side refusal fallback, so the code only sends `fallbacks` for models that accept it |
| `MODEL_A_PRICE_IN` / `_OUT` | `0.10` / `0.50` | USD per million tokens (prompts up to 100K tokens) |
| `MODEL_B_PROVIDER` / `MODEL_B` | `gemini` / `gemini-3.8-flash` | the price below is Google's rate from 2027-01-01; until 2026-12-31 Google lists an introductory $0.75 / $3.75 |
| `MODEL_B_PRICE_IN` / `_OUT` | `1.50` / `7.50` | |
| `SWAP_KINDS` | `research` | comma-separated step kinds where B makes and A checks |
| `ANTHROPIC_EFFORT` | `high` | `low` / `medium` / `high` / `xhigh` / `max` |
| `MAX_OUTPUT_TOKENS` | `16000` | per call; also sets the worst-case reservation |
| `MAX_ROUNDS` | `3` | |
| `PROJECT_CAP_USD` | `2` | |
| `PREVIEW_CAP_USD` | `0.50` | |
| `PARALLEL_STEPS` | `3` | |

**Secrets** (set with `wrangler secret put … --config worker/wrangler.toml`): `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `ACCESS_CODE`.

**Front end:** `VITE_API_URL` at build time. `deploy.yml` uses the repo variable `PENPOST_API_URL` if it's set, and otherwise `https://penpost-solver.jakemlee01.workers.dev`.

### Model call details (`worker/src/models.ts`)

- **Anthropic:**
  - Uses `client.beta.messages.stream(...).finalMessage()` with `thinking: {type: "adaptive"}` and `output_config: {effort}`.
  - Server-side refusal fallback: `betas: ["server-side-fallback-2026-07-01"]`, `fallbacks: "default"`.
  - A `refusal` or `max_tokens` stop reason throws.
  - Cost is input tokens (including cache tokens) times the input price, plus output tokens times the output price. Output includes thinking.
- **Gemini:**
  - `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent` with the key in the `x-goog-api-key` header, `systemInstruction`, and `generationConfig.responseMimeType: "application/json"`.
  - Output tokens = `candidatesTokenCount` + `thoughtsTokenCount`.
  - Finish reason `MAX_TOKENS` or empty text throws.
- **Reply parsing:** `parseJson` takes the text from the first `{` to the last `}` and parses it. Failure means the project stops as `failed`.

### Estimator (`worker/src/estimate.ts`)

The constants are guesses with no calibration yet: spec tokens 1,500; checker output 1,500; maker thinking factor 1.5; 40 seconds per call; 5 seconds of queue hand-off between steps.

- **Low cost:** every step passes first time. **High cost:** the base times (1 + retry share), where the retry share is 0.5 at `MAX_ROUNDS` = 2 and grows with more rounds. The final check is added to both.
- **Time:** based on the critical path (the longest dependency chain) times about 2 calls per step.

---

## 10. Front end (`src/main.ts`)

- **Routing:** hash routes. `#/` is the problem screen and `#/p/<id>` is the project screen.
- **Access code:** asked for once and stored in `localStorage` under `penpost.code`. It is cleared on a 401.
- **Project screen:** one screen that changes with the status:
  - A status banner, including the escalation reason or the summary.
  - A Resume card, with an optional new cap, when the project is `escalated` or `failed`.
  - The brief, or the raw request before intake is done.
  - On `awaiting_approval`: "Looks right" and "Something's off", which opens a note box and a "Redo the brief" button.
  - On `awaiting_start`: the free preview stats (feasible or "needs you", cost range, time range), the before-we-start checklist with a confirm checkbox, and "Start solving".
  - From solving on: progress stats (steps passed, cost so far against the cap, idle time for A and B), step cards (status pill, who makes and who checks, failed-check count, checker notes, an expandable artifact and evidence), and an activity feed, newest first.
- **Polling:** every 4 seconds while the status is active. Open `<details>` and typed inputs survive refreshes.
- **Screenshots:** checked at 390px and 1200px with mocked data. No horizontal overflow.

---

## 11. Verification done so far

- `npm test`: **20/20 pass.** They cover:
  - Happy path: intake, plan, review, preview, start, the solve with one failed check and a retry, the final check, then done.
  - The checklist and estimate shapes.
  - The start gate.
  - The role swap for research steps.
  - Parallelism, with the batch limited to `PARALLEL_STEPS`.
  - The queue chain: a step queues the next one while the project is active, and stops when it waits on the user. A leased project is skipped and not re-queued. The cron sweeper re-queues only stalled, unleased, active projects.
  - A revise that redrafts with the user's note.
  - An empty plan ending as `done`.
  - Escalation after 3 failed checks, then resume.
  - Escalation after the plan is rejected 3 times, with the reviewer's notes reaching the replan.
  - The dollar cap stopping the run before the call, and resume raising the cap.
  - The start being refused when the estimate is above the cap.
  - An API error leading to `failed` with no retry.
  - A non-JSON reply leading to `failed`.
  - `needs_human` leading to escalation.
  - A failed final check leading to escalation.
  - HTTP: the access code, the origin check, 503 when unconfigured, create and read, 409 and 404.
- `npx tsc -p tsconfig.json` and `npx tsc -p worker/tsconfig.json` are clean. `npm run build` succeeds.
- `wrangler deploy --dry-run` bundles the Worker.
- **Local `wrangler dev` with a local D1:** creating a project worked, the immediate kick ran intake, and with no API key the project went to `failed` ("ANTHROPIC_API_KEY is not set") and logged an error event. A scheduled trigger did not retry it. An unauthenticated GET returned 401.
- **Not verified:** any real Anthropic or Gemini call, cost accuracy against provider billing, behavior on the deployed Worker, and GitHub Pages deployment of the new site.

---

## 12. Known gaps and risks (read before changing things)

1. **Fixed: long calls are no longer cut off.** Steps now run as queue consumers, which get up to 15 minutes of wall time, and the lease (16 minutes) outlasts that. If a consumer dies mid-step, the lease expires and the cron sweeper re-queues the project. A call cut off that way could still have cost money that never got logged, but that now needs an infrastructure failure, not routine use.
2. **Free plan CPU limit.** The Workers Free plan allows about 10 ms of CPU per invocation. Waiting on `fetch` (model calls, D1) doesn't count, but parsing a large model reply and the Anthropic SDK's stream handling do. If invocations get killed for exceeding CPU, the symptom is projects stalling, then being re-queued by the cron, and failing again. Fixes, if needed: lower `MAX_OUTPUT_TOKENS`, call Anthropic without streaming, or upgrade. Jake wants to stay on Free for now.
3. **Free plan quotas.** Queues get 10,000 operations a day; each step uses about 3 (write, read, delete). D1 gets 50 queries per invocation (the step budget is about 25) plus daily read and write limits.
4. **No real evidence execution.** The brief says the checker should use independent evidence such as **test results**. Right now artifacts are plain text and the checker only reasons over them; nothing runs code or tests. A sandbox would close this, for example Anthropic's server-side code execution tool or a separate runner.
5. **Resuming a `needs_human` escalation re-runs the same step,** which will likely escalate again. There's no endpoint to mark a step done externally or to edit it. The same applies to a failed final check: resume re-runs the final check only and can't send the work back to solving.
6. **Cost accuracy.** Costs are computed from tokens times the configured prices. If the Anthropic server-side fallback routes to a different model, the cost is still charged at Model A's price. Prices must be kept in sync by hand.
7. **The estimator is uncalibrated.** Step 5's "use history to improve estimates" is not built. The data is there: compare `estimate_json` with the `events` totals per project.
8. **The logging roll-up is partial.** Per-call events, `queue_empty` events with a cause, and per-model idle time are built. The **per-project roll-up with average idle time per cycle, broken down by cause,** is not.
9. **Parallel escalation.** If one action in a batch escalates, the other actions in that batch still finish and save their results. That is acceptable, but worth knowing.
10. **Auth is a single shared access code.** There are no user accounts, no per-user project lists and no rate limiting. Anyone with the code can read any project whose UUID they know. This is fine while Jake is the only user, but must change before public launch or payments.
11. **`node:sqlite` in tests** is loaded through `createRequire`, because Vite 5 doesn't resolve that builtin. It needs Node 22.5 or newer and prints an ExperimentalWarning.
12. **`scripts/screenshots.mjs`** is stale (from the news app).

---

## 13. Setup steps still owed (Jake has to do these, or give access)

1. **Set hard monthly spend limits** in the Anthropic Console and Google AI Studio / Cloud billing. Do this first.
2. ~~Create D1, run the migration, create the queue, deploy the Worker.~~ **Done 2026-11-26:** D1 `penpost-solver`, queue `penpost-solver-steps`, Worker at https://penpost-solver.jakemlee01.workers.dev.
3. ~~Check that it's live.~~ **Done.** It answers 503 "server not configured" until `ACCESS_CODE` is set, refuses other origins with 403, and the CORS preflight from penpost.co returns 204.
4. **Add the three secrets** in the Cloudflare dashboard (Workers & Pages, then `penpost-solver`, Settings, Variables and Secrets, type Secret): `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `ACCESS_CODE`.
5. ~~Confirm the Gemini model.~~ **Done:** `gemini-3.8-flash`. Its price is set at Google's 2027 rate.
6. ~~Set `PENPOST_API_URL`.~~ **No longer needed:** the Worker URL is the default in `deploy.yml`.
7. Merge the branch to `main`. This deploys the site and removes the old daily news workflow.
8. **Cleanup of the old product:**
   - delete the old `penpost-setup` Worker and its Gemini key in Cloudflare;
   - remove the old `PENPOST_PARSE_URL` Actions variable and the `GEMINI_API_KEY` and `UNSPLASH_ACCESS_KEY` Actions secrets (the new Worker's keys live in Cloudflare, not GitHub);
   - decide whether to close draft PR #21 and the roughly 22 stale branches.
9. If the Free plan CPU limit (section 12, item 2) bites, upgrade to the Workers Paid plan or apply the fixes listed there.

---

## 14. Suggested next steps, in order

1. ~~Fix the long-call execution path.~~ **Done** (Queues).
2. **Build order step 4:** with the keys in (caps are already low: $0.50 preview, $2 per project), run one small real problem end to end. Watch the events, compare the logged cost with the provider dashboards, and tune the prompts if replies fail JSON parsing.
3. **Build order step 5:**
   - per-project roll-up: average idle per cycle and idle by cause;
   - estimator calibration from history (estimate against actual, per step kind and model);
   - surface both in the UI.
4. **Recovery tools for escalations:** mark a step done externally, edit a step or its check, and send a failed final check back to solving.
5. **Real evidence:** let the checker run code and tests (a sandbox or a code-execution tool) for `build` steps.
6. **Before any public launch:** real auth, per-user projects, rate limiting, then payments.

---

## 15. Commands cheat sheet

```bash
npm install
npm test                                   # 20 engine, queue and HTTP tests
npx tsc -p tsconfig.json                   # site + tests typecheck
npx tsc -p worker/tsconfig.json            # Worker typecheck
npm run build                              # site to dist/
npm run dev                                # site dev server :5173 (set VITE_API_URL)
echo "ACCESS_CODE=localtest" > worker/.dev.vars
npm run db:migrate:local
npx wrangler dev --config worker/wrangler.toml --port 8787 --test-scheduled
curl "localhost:8787/__scheduled?cron=*+*+*+*+*"     # fire the cron locally
curl -H "origin: http://localhost:5173" -H "x-access-code: localtest" \
     -H "content-type: application/json" \
     -X POST localhost:8787/api/projects -d '{"request":"..."}'
```

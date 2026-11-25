# PenPost Problem Solver

Someone states a problem and the solution they want. They get a free feasibility, cost and time preview, and can then have two independent AI models solve it together in a maker and checker loop.

- **Front end:** a static site on GitHub Pages at penpost.co (`index.html`, `src/`). No API keys here.
- **Back end:** a Cloudflare Worker, `penpost-solver` (`worker/`). It holds both model keys as secrets, keeps all state in D1 and runs the orchestrator.
- **Orchestrator:** plain code, not an AI (`worker/src/engine.ts`). It does one step per run. A Cron Trigger runs every minute, and user actions also start the next step straight away.

## Flow

1. **Intake.** Model A turns the user's words into a problem, a solution and pass/fail acceptance checks. The user approves the draft or asks for changes.
2. **Plan.** Model A breaks the work into steps. Each step gets its own check, a kind (build, write, research) and a bucket:
   - `model`: the models can do it.
   - `user`: the user must do it, for example creating accounts or handing over a token.
   - `blocker`: needs a real person for legal, tax or registration matters.

   Model B reviews the plan. A rejected plan goes back to Model A with Model B's notes.
3. **Free preview.** Shows the feasibility, a cost range, a time range, and a before-we-start checklist built from the `user` and `blocker` steps. It does not show any scripts or prompts.
4. **Solve.** The user confirms the checklist and starts. Model A makes each step and Model B checks it. For research steps the roles swap (`SWAP_KINDS`).
   - The checker sees the spec, the step's check and the work product. It never sees the maker's explanation.
   - A failed step goes back to the maker with the checker's notes.
   - Independent steps run in parallel, up to `PARALLEL_STEPS` at a time.
5. **Done.** Model B checks every acceptance check against the delivered work and writes the summary.

If the plan has no steps worth doing, the project ends right there and spends nothing more.

## Guardrails

- **Max rounds:** `MAX_ROUNDS` tries per step and per plan, then the project escalates to Jake.
- **Dollar caps:** `PREVIEW_CAP_USD` covers the free part and `PROJECT_CAP_USD` covers the solve. Before each call the Worker reserves that call's worst-case cost, so it stops before going over the cap, not after.
- **Escalation to Jake:** a project pauses as `escalated` if:
  - a step needs real money, credentials, production systems, going live or contacting people (the maker returns `needs_human`);
  - a cap is reached;
  - the plan is stuck;
  - the final check fails.
- **No silent retries:** a project stops as `failed` at the first unexplained failure, such as an API error, a reply that isn't JSON, or an empty artifact. The SDK's own transport retries for 429 and 5xx errors still apply.
- **Resume:** Jake resumes from the project page. Resuming can raise the cap and gives the stuck step fresh rounds.
- **Access code:** every API request needs the `ACCESS_CODE` secret in the `x-access-code` header. The site asks for it once.

## Logging

Every model call is a row in `events` with:
- who made it and which model it used;
- start and finish times;
- tokens in and out, and its cost;
- its outcome (pass, fail, ok or error).

A `queue_empty` row records when a model's queue runs dry, and why. The project page shows the activity feed, the cost so far, and each model's idle time (the solving time it spent outside calls).

## First-time setup

Do these in order. Set the spend limits before adding any keys.

1. **Spend limits.** Set hard monthly spend limits in the Anthropic Console and in Google AI Studio (or Cloud billing) for the keys you'll use.
2. **D1 and the Worker.**

   ```bash
   npm install
   npx wrangler login
   npx wrangler d1 create penpost-solver      # paste the database_id into worker/wrangler.toml
   npm run db:migrate:remote
   npm run worker:deploy
   npx wrangler secret put ANTHROPIC_API_KEY --config worker/wrangler.toml
   npx wrangler secret put GEMINI_API_KEY --config worker/wrangler.toml
   npx wrangler secret put ACCESS_CODE --config worker/wrangler.toml
   ```
3. **The site.** In GitHub, go to repo Settings, then Secrets and variables, then Actions, then **Variables**. Set `PENPOST_API_URL` to the Worker URL, for example `https://penpost-solver.<subdomain>.workers.dev`. Then push to `main`, or re-run "Test, build, deploy".
4. **Models and prices.** These are vars in `worker/wrangler.toml`:
   - Model A is `claude-opus-5-5` ($4 / $20 per million tokens).
   - Model B is `gemini-3.1-pro-preview` ($2 / $12).

   Check the Gemini model name and price against Google's pricing page before the first real run. Prices feed the estimator and the dollar caps.

## Develop

```bash
npm test                  # engine tests: full loop with fake models over a SQLite stand-in for D1
npm run typecheck && npx tsc -p worker/tsconfig.json
npm run dev               # site at localhost:5173 (set VITE_API_URL to the Worker URL)
npm run db:migrate:local
npm run worker:dev        # Worker at localhost:8787; put ACCESS_CODE=... in worker/.dev.vars
```

The Worker's cron runs every minute once deployed. Locally, trigger it with `curl "localhost:8787/__scheduled?cron=*+*+*+*+*"` (start `wrangler dev` with `--test-scheduled`).

## Where things live

```text
worker/src/engine.ts     the orchestrator: state machine, guardrails, logging, views
worker/src/prompts.ts    one prompt per action; every reply is a JSON object
worker/src/models.ts     Anthropic (SDK) and Gemini (REST) clients with token and cost accounting
worker/src/estimate.ts   cost and time estimate from the reviewed plan
worker/src/index.ts      HTTP routes and the cron handler
worker/migrations/       D1 schema
src/main.ts              the three screens: problem, confirm and preview, progress
tests/                   engine and HTTP tests
```

## Not built yet

- Build order step 4: run one small test problem end to end with low caps. This needs the keys.
- Build order step 5: tune the estimator from logged history, and add a per-project roll-up of idle causes.
- Payments.

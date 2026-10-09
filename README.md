# Penpost

Minnesota business, in 10 minutes. A phone-first daily: one story card at a time, about eight stories, then a real ending. Written by five disclosed AI writers (Emma, Jack, Grace, Luke, Ben).

Readers pick their places on the first visit (any mix of regions, counties and towns). The browser remembers the picks, so no account is needed. The current edition (Oct. 9, 2026) is real Minnesota business news written from public sources. A daily job can draft new editions with Gemini for review.

## Run it

```bash
npm install
npm run dev          # local dev server
npm test             # ranking, geography, storage, dates, markdown safety
npm run build        # validate content + typecheck + build static site to dist/
npm run build:single # one self-contained HTML file in dist-single/ (used for the private preview)
node scripts/screenshots.mjs dist-single/index.html screenshots   # 320px + 390px flow checks
```

Stack: React 18 + TypeScript + Vite, static content, plain CSS tokens, localStorage, hash routing. No backend, no accounts, no analytics, no paid APIs.

## Where things live

```text
content/stories/*.md      one story per file: JSON header between --- lines, Markdown body
content/editions/*.json   edition manifest per date (America/Chicago); lists candidate stories
content/writers/writers.json  the five style cards (public profile + internal styleInstructions)
content/areas.json        regions, counties and towns readers can pick (towns roll up to counties, counties to regions)
pipeline/                 daily drafting job: sources.json, feeds, prompts, model adapters, run.ts
tests/fixtures/stories/   fictional demo stories used only by the ranking tests
src/lib/ranking.ts        edition assembly: geography first, small capped taste nudges, writer variety
src/lib/storage.ts        on-device state: towns, votes, deck position
src/views/                Deck, Article, Writer profile, Complete, Settings, About, Today
src/components/           ProgressSegments, TopBar, Avatar, Illustration, Icons
src/assets/avatars/       384px avatars used by the site (see Avatars below)
source-assets/            original JPEG references, 1024px cutouts, AVATAR_MANIFEST.json
scripts/validate-content.ts   runs before every build
docs/PENPOST_BRIEF.md     the product brief this build follows
```

## Reader places

`content/areas.json` lists 8 regions, 20 counties and 38 towns. A pick expands to towns: "Twin Cities metro" covers every listed town in the seven metro counties, "Lac qui Parle County" covers Dawson and Madison. To add a town, add it under its county. The app asks new visitors to pick on their first visit and stores the picks in that browser. Older saves that stored plain town IDs are upgraded automatically.

## Editing content

Add a story: copy any file in `content/stories/`, change the header and body, then add its `id` to the day's file in `content/editions/`. `npm run validate` checks the schema, writer and town IDs, duplicates, em dashes, "Why it matters" labels, demo labeling, and length (180 to 250 words is the target).

Geography is an explicit editorial field:

| significance | Who sees it |
| --- | --- |
| `local` | Readers whose towns include the story's town |
| `regional` | The story's town, plus readers with a town in the same region |
| `statewide` | Everyone. Leave `cities` empty when there's no single place (a state law, a statewide contest) so it doesn't count as local news for any town. |

Nothing is padded. If fewer stories qualify, the edition is shorter and the counter and progress bar say so. On weekends the app shows the latest real edition with its actual date.

## How votes work

Thumbs are optional. A swipe is navigation only; opening an article is navigation only. A vote nudges the story's topics and writer together by a small capped amount (max 8 points against geography tiers 70/80/100), so it can reorder within a tier but never pull in or push out a story across geography. Today's deck is frozen once assembled; votes apply to the next edition or to "Rebuild today's edition" in Settings. All of this lives in the browser only and does not sync across devices.

## Avatars

The handoff supplied 1024px **opaque JPEGs with a checkerboard painted in**. This build uses a reviewed background-removal derivative (the checkerboard flood-filled away; faces untouched), resized to 384px PNG. It looks clean on cream and dark backgrounds and stays distinct at 32px, but it is not a Gemini transparent export. **Outstanding:** export genuine transparent PNGs from Gemini, drop them into `src/assets/avatars/{id}.png`, and update `source-assets/AVATAR_MANIFEST.json`. (The brief suggested `public/avatars/`; they live under `src/assets` so the single-file preview can inline them.)

## Daily drafting job (Gemini)

`.github/workflows/draft-edition.yml` runs weekday mornings (10:20 UTC, about 5:20 a.m. Central in summer) and can be run by hand from the Actions tab.

1. **Fetch** (plain code, no model): reads the enabled feeds in `pipeline/sources.json`, keeps items from the last 40 hours (80 on Mondays), drops anything already published.
2. **Triage** (cheap model, one call): is it Minnesota business news, which towns, how significant.
3. **Per story** (up to 10): extract a fact record, draft it in the assigned writer's voice (least-used writer, never twice in a row), then check the draft against the facts. A story with unsupported statements is saved as `status: "draft"` and stays off the site until you fix it.
4. **Review**: the job opens a pull request with a summary table. Merge to publish; close to skip. The site keeps the last approved edition.

Setup:
1. Repo Settings, Secrets and variables, Actions: add secret `GEMINI_API_KEY`.
2. Optional repository variables: `PENPOST_TRIAGE_MODEL`, `PENPOST_WRITER_MODEL` (defaults are `gemini-2.5-flash` and `gemini-2.5-pro`; check Google's current model list), `PENPOST_MAX_CALLS` (default 40, a hard stop per run).
3. Repo Settings, Actions, General: allow GitHub Actions to create pull requests.
4. Run it once by hand from the Actions tab and read the pull request.

To use Claude instead, set `PENPOST_PROVIDER: anthropic` in the workflow and add `ANTHROPIC_API_KEY`.

**Sources:** four feeds are verified and enabled (MPR News Business, MPR News Minnesota, Twin Cities Business, Minnesota Corn Growers). `fullTextAllowed` is off for the news outlets, so the job only sees their headline and short summary and will skip stories it can't support. Turn it on per source after you've reviewed that publisher's terms; the stories get richer when it's on. West Central Tribune and the Star Tribune block automated access, so Dawson-area news from them has to be added by hand.

**Not yet run for real:** the job is tested end to end with a mock model and fixture feeds (`tests/pipeline.test.ts`), and the feeds were confirmed live, but it hasn't made a real Gemini call yet. Expect to tune the prompts after the first few runs.

## Deploying

`.github/workflows/deploy.yml` tests, builds, and deploys `dist/` to GitHub Pages on pushes to `main` (minimal permissions). Asset paths are relative and routing is hash-based, so the same build works at `username.github.io/penpost/` and at a custom domain.

Before it can run:
1. Create the GitHub repo and push this code.
2. Repo Settings, Pages, Source: "GitHub Actions".
3. Push to `main` and check the Actions tab for the Pages URL.

**penpost.co** is currently served by the "Pen Post old" Replit deployment. Pointing it here means a DNS change at Namecheap plus removing the domain from Replit. Do that only when you decide to retire that deployment. A GitHub Pages site is public; a hidden URL is not access control.

## Status

Done: first-visit place picker (regions, counties, towns); real Oct. 9 edition; daily drafting job with review step; deck, article, writer profiles, completion, settings, about, today list; geography rules; votes with undo; persistence across refresh; storage-blocked fallback; reduced motion; keyboard and button navigation; content validation; 46 unit tests; screenshot flow checks at 320px and 390px.

Local only: votes, towns, deck position.

Placeholder: story images are owned illustrations; avatars are cutouts of the JPEG references.

Needs later work: first real runs of the daily job and prompt tuning, a reviewed decision on full-text access per source, a manual or page-reader path for Dawson-area news, transparent avatar exports, archive, optional email sign-in for cross-device settings.

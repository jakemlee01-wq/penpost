# Penpost

Your places and interests, rooted in Minnesota. A phone-first daily: one story card at a time, up to five stories, then a real ending. Written by five disclosed AI writers (Emma, Jack, Grace, Luke, Ben).

Readers set up on one screen by saying what they want in their own words (typed, or spoken through the mic button). Penpost turns that into places, sections, specific likes and dislikes. Personalization is meant to be experienced, not configured: the reader lands straight on an edition, and the granular controls live in Settings. Editions are capped at five stories, with at least one per chosen section when there's news. The browser remembers the picks, so no account is needed. The current edition (Oct. 9, 2026) is real Minnesota business news written from public sources. On weekdays the paper is written on demand: a reader taps "See today's paper" and Penpost researches and writes just the topics that reader's settings need and nobody has asked for yet that day. A day with no taps writes nothing and costs nothing.

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
src/lib/setupParse.ts     first-run setup: Worker prompt, sanitizer, in-browser parser, defaults
worker/                   Cloudflare Worker: reads setup answers (/parse) and starts on-demand editions (/curate)
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

## First-run setup

One screen: a text box, a mic button (the browser's own speech-to-text; hidden where unsupported), an example answer, and "Show my edition".

The answer is parsed into the existing preference model (`src/lib/setupParse.ts`):

- **Places**: matched to `areas.json`. "Twin Cities" is the metro region; "Minnesota" alone is not a place. No place mentioned means no areas, which gives statewide and national news. Setup never blocks on places.
- **Sections**: mapped to the 10 sections, each with a scope. "Nationally I like the economy" becomes Economy at National.
- **Likes**: niche interests kept as free-form phrases ("value investing", "berkshire hathaway", "ai tools"). They nudge matching stories up, matched against story topic tags, headline and preview.
- **Dislikes**: explicit "don't care about soccer" becomes an `avoids` phrase. It moves matching stories down, never out, so a must-know story always gets through.

Who parses it, in order:

1. The **setup Worker** (`worker/`), a Cloudflare Worker holding a second Gemini key. The site can't keep a key secret, so it posts the answer there. The Worker only accepts requests from penpost.co (and localhost), stores nothing, and runs the same sanitizer as the site so only real area IDs and sections come back.
2. If the Worker isn't configured or fails, a **keyword parser in the browser** (`localParse`). Less smart, but setup always works.
3. If neither finds a section, the **starter default** (Minnesota business), disclosed on the deck.

After submit the deck shows one line: "Built from what you told us. We'll keep learning as you read." (or the starter-default version). Settings shows what the reader said, a "Redo setup in your own words" link (`#/setup`), and the granular controls: places, sections, More of, Less of, favorite writers.

**Deploying the Worker** (one time, free Cloudflare account):

```bash
npx wrangler login
npx wrangler deploy --config worker/wrangler.toml
npx wrangler secret put GEMINI_API_KEY --config worker/wrangler.toml   # the second key, not the drafting key
npx wrangler secret put GITHUB_TOKEN --config worker/wrangler.toml     # for on-demand editions, see below
```

Or paste `worker/penpost-setup-worker.bundle.js` into the Cloudflare Worker editor (rebuild it with `npm run worker:bundle` after changing `worker/src`), then add both secrets under the Worker's Settings, Variables and secrets.

The Worker holds two secrets: the second Gemini key, and a GitHub token. `GITHUB_TOKEN` is a **fine-grained personal access token** for `jakemlee01-wq/penpost` only, with **Actions: read and write** and **Contents: read-only**, nothing else. It lets the Worker read the day's topic manifest and start the drafting workflow. The Gemini drafting key stays in GitHub Actions.

Then in GitHub, repo Settings, Secrets and variables, Actions, **Variables**: add `PENPOST_PARSE_URL` = the Worker URL plus `/parse` (for example `https://penpost-setup.<your-subdomain>.workers.dev/parse`) and push or re-run the deploy. The site finds `/curate` on the same Worker. Set a spending cap on that Gemini key in Google AI Studio. Each visitor gets 10 Worker requests a minute (the `RATE_LIMITER` binding in `worker/wrangler.toml`).

## Interests, tone and writers

Sections live in `content/interests.json`. Every story has `categories` (1 or 2 sections), `tone` (light, neutral, heavy) and `mustKnow`.

- A local or regional story needs a place match AND a section the reader turned on at any scope.
- A statewide story needs a section at Minnesota or National scope; a national story needs National.
- Editions lean lighter for everyone: heavy stories (closings, layoffs) get in only when marked must-know. There is no mood setting.
- Must-know stories skip the section and tone checks, so big news for a reader's places always gets through.
- Likes (+3 each, up to +6), a dislike (-6), favorite writers (+3, Settings only), votes and a small lift for light stories are all nudges. Together they're capped at 9, under the 10-point gap between geography tiers.
- Political stories are written neutrally. There is no political lean setting by design.

## Photos

Every story carries a licensed photo in `image.photo` (kind, caption, credit, license, the photo's page, and a download or hotlink URL). Order of preference:

1. **press**: the company's own media photo, cleared for editorial use (added by hand after a rights check).
2. **place**: an openly licensed photo of the real place (for example U.S. Bank Stadium).
3. **stock**: a generic photo. Always captioned "Stock photo" and labeled on the card, so it never reads as the actual event.
4. The illustration, when nothing fits or a download fails.

`npm run photos` downloads `downloadUrl` photos into `src/assets/photos/<story id>.jpg`; the deploy workflow runs it before every build. The private preview can't load outside images, so it shows illustrations until the site is on GitHub. The daily job adds stock photos through the Unsplash API when `UNSPLASH_ACCESS_KEY` is set (free key; API photos are hotlinked and credited as Unsplash requires). No AI-generated photos, by design.

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

## On-demand editions ("See today's paper")

There is no schedule. Stories are researched and written only when a reader asks for today's paper, and only for topics nobody has generated yet that day.

1. **The tap.** On a weekday, a reader without today's deck sees one button, "See today's paper." Opening the app is not a tap. The app turns the reader's settings into topic IDs (`src/lib/topics.ts`, `readerTopicIds`): one `local-<region>` per region with a picked town, `mn-<section>` for each Minnesota or National section, `us-<section>` for each National section, `mn-feel-good` always and `us-feel-good` with any National section. No sections: `mn-business`.
2. **The Worker** (`POST /curate`) checks the topics (real IDs only, at most 20, today's date, weekdays only), reads `content/topics/<date>.json` from the repo, and dispatches `.github/workflows/draft-edition.yml` with just the topics that are neither ready nor already being written. It answers `ready` or `generating`.
3. **The workflow** first marks those topics `pending` in the manifest and pushes that right away, so a second tap during the run doesn't pay again. Then one run at a time researches and writes (`pipeline/agent.ts`, exact topic IDs, local and feel-good stories first, `PENPOST_MAX_CALLS` as the hard stop), validates, commits the stories and edition, marks each topic `ready` (or `failed`, so a later tap can retry it) with `finishedAt`, `storiesWritten` and `modelCalls`, and starts the deploy.
4. **The curating screen** polls `GET /curate/status` every 12 seconds. A topic counts as ready once its stories are deployed: the manifest says ready and a "Test, build, deploy" run that started afterwards succeeded. The app compares the Worker's `readyAt` with its own build time and reloads itself if it's an older build, then builds and freezes the deck as before. After 5 minutes, or if the run fails, it shows the latest edition with "Today's paper is still being put together. Here is your latest." and a Try again button.

Weekends: no generation; the app shows the latest edition. A day with no taps leaves the repo untouched and makes no Gemini calls.

`content/topics/<date>.json` is the shared cache and the spend record (per topic, per day). It isn't bundled into the site.

**Running it by hand:** Actions tab, "Draft daily edition", Run workflow. Blank topics means every topic that isn't ready today; `dry_run` researches and writes without publishing. To regenerate a topic that's already ready, delete its entry from the day's manifest first.

Setup:
1. Repo Settings, Secrets and variables, Actions: secret `GEMINI_API_KEY` (the drafting key). Optional: `UNSPLASH_ACCESS_KEY` for stock photos.
2. Optional repository variables: `PENPOST_TRIAGE_MODEL`, `PENPOST_WRITER_MODEL`, `PENPOST_FALLBACK_MODEL`, `PENPOST_MAX_CALLS` (default 300, a hard stop per run).
3. Deploy the Worker with `GITHUB_TOKEN` (above). Without it, the button falls back to the latest edition.

To use Claude instead, set `PENPOST_PROVIDER: anthropic` in the workflow and add `ANTHROPIC_API_KEY`.

**Sources:** four feeds are verified and enabled (MPR News Business, MPR News Minnesota, Twin Cities Business, Minnesota Corn Growers). `fullTextAllowed` is off for the news outlets, so the job only sees their headline and short summary and will skip stories it can't support. Turn it on per source after you've reviewed that publisher's terms; the stories get richer when it's on. West Central Tribune and the Star Tribune block automated access, so Dawson-area news from them has to be added by hand.

**Not yet run for real:** the job is tested end to end with a mock model and fixture feeds (`tests/pipeline.test.ts`), and the feeds were confirmed live, but it hasn't made a real Gemini call yet. Expect to tune the prompts after the first few runs.

## Deploying

`.github/workflows/deploy.yml` tests, builds, and deploys `dist/` to GitHub Pages on pushes to `main` (minimal permissions). Asset paths are relative and routing is hash-based, so the same build works at `username.github.io/penpost/` and at a custom domain.

Before it can run:
1. Create the GitHub repo and push this code.
2. Repo Settings, Pages, Source: "GitHub Actions".
3. Push to `main` and check the Actions tab for the Pages URL.

**penpost.co** points here (Namecheap DNS: four GitHub A records and a `www` CNAME). A GitHub Pages site is public; a hidden URL is not access control.

## Status

Done: one-screen free-text setup with voice input and the setup Worker; real Oct. 9 edition; daily drafting job with review step; deck, article, writer profiles, completion, settings, about, today list; geography rules; votes with undo; persistence across refresh; storage-blocked fallback; reduced motion; keyboard and button navigation; content validation; 86 unit tests; screenshot flow checks at 320px and 390px.

Local only: votes, towns, deck position.

Placeholder: avatars are cutouts of the JPEG references. Illustrations show only when a photo can't load.

Needs later work: first real runs of the daily job and prompt tuning, a reviewed decision on full-text access per source, a manual or page-reader path for Dawson-area news, transparent avatar exports, archive, optional email sign-in for cross-device settings.

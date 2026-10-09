# Penpost

Minnesota business, in 10 minutes. A phone-first daily: one story card at a time, about eight stories, then a real ending. Written by five disclosed AI writers (Emma, Jack, Grace, Luke, Ben).

This is the first working prototype. All stories are **demo fixtures** with fictional companies and amounts, clearly labeled in the app.

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
content/towns.json        town catalog with regions (drives regional eligibility)
src/lib/ranking.ts        edition assembly: geography first, small capped taste nudges, writer variety
src/lib/storage.ts        on-device state: towns, votes, deck position
src/views/                Deck, Article, Writer profile, Complete, Settings, About, Today
src/components/           ProgressSegments, TopBar, Avatar, Illustration, Icons
src/assets/avatars/       384px avatars used by the site (see Avatars below)
source-assets/            original JPEG references, 1024px cutouts, AVATAR_MANIFEST.json
scripts/validate-content.ts   runs before every build
docs/PENPOST_BRIEF.md     the product brief this build follows
```

## Editing content

Add a story: copy any file in `content/stories/`, change the header and body, then add its `id` to the day's file in `content/editions/`. `npm run validate` checks the schema, writer and town IDs, duplicates, em dashes, "Why it matters" labels, demo labeling, and length (180 to 250 words is the target).

Geography is an explicit editorial field:

| significance | Who sees it |
| --- | --- |
| `local` | Readers whose towns include the story's town |
| `regional` | The story's town, plus readers with a town in the same region |
| `statewide` | Everyone |

Nothing is padded. If fewer stories qualify, the edition is shorter and the counter and progress bar say so. On weekends the app shows the latest real edition with its actual date.

## How votes work

Thumbs are optional. A swipe is navigation only; opening an article is navigation only. A vote nudges the story's topics and writer together by a small capped amount (max 8 points against geography tiers 70/80/100), so it can reorder within a tier but never pull in or push out a story across geography. Today's deck is frozen once assembled; votes apply to the next edition or to "Rebuild today's edition" in Settings. All of this lives in the browser only and does not sync across devices.

## Avatars

The handoff supplied 1024px **opaque JPEGs with a checkerboard painted in**. This build uses a reviewed background-removal derivative (the checkerboard flood-filled away; faces untouched), resized to 384px PNG. It looks clean on cream and dark backgrounds and stays distinct at 32px, but it is not a Gemini transparent export. **Outstanding:** export genuine transparent PNGs from Gemini, drop them into `src/assets/avatars/{id}.png`, and update `source-assets/AVATAR_MANIFEST.json`. (The brief suggested `public/avatars/`; they live under `src/assets` so the single-file preview can inline them.)

## Deploying

`.github/workflows/deploy.yml` tests, builds, and deploys `dist/` to GitHub Pages on pushes to `main` (minimal permissions). Asset paths are relative and routing is hash-based, so the same build works at `username.github.io/penpost/` and at a custom domain.

Before it can run:
1. Create the GitHub repo and push this code.
2. Repo Settings, Pages, Source: "GitHub Actions".
3. Push to `main` and check the Actions tab for the Pages URL.

**penpost.co** is currently served by the "Pen Post old" Replit deployment. Pointing it here means a DNS change at Namecheap plus removing the domain from Replit. Do that only when you decide to retire that deployment. A GitHub Pages site is public; a hidden URL is not access control.

## Status

Done: deck, article, writer profiles, completion, settings, about, today list; geography rules; votes with undo; persistence across refresh; storage-blocked fallback; reduced motion; keyboard and button navigation; content validation; 31 unit tests; screenshot flow checks at 320px and 390px.

Local only: votes, towns, deck position.

Placeholder: all ten stories and their sources (fictional, `example.com` links); story images are owned illustrations; avatars are cutouts of the JPEG references.

Needs later work: real sourced stories, approved source registry and curation pipeline with Jake's review step, transparent avatar exports, archive, backend for cross-device settings.

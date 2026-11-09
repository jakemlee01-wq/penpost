# Private hub (draft, synthetic data only)

A private, phone-first view of Jake's whole world: the day, and how each part of it stands.
It sits on top of existing tools and replaces none of them. It is not a task manager.

Current state: **synthetic-data prototype plus an authentication design.** No live sources,
nothing deployed, no accounts set up. Every person, task, date and fact in the fixtures is invented,
and the page shows an "Example data" banner whenever fixtures are served.

## The screen

**Glance surface (`/`)**

1. Title: `Today - Mon Nov 9`, from the current Chicago date.
2. Hero: the morning message and today's calendar, each with a quiet source and "checked" line.
   The calendar works on its own when other sources fail.
3. Next: **one** thing, with a quiet count ("1 thing needs you, 4 more later.") and one link,
   "4 more in Task list".
4. Five domain cards: **Today, Jobs, More Juice, BreakerOps, Money.** Each shows one current fact or
   an explicit state, and links one tap behind to that domain's page.

No buttons and no status pills on the glance surface. Wording is declarative ("Sample invoice is ready
to send"), not imperative.

**Domain pages (`/d/<domain>`)** hold the fact with full provenance, the domain's tasks, "Open in"
links and the flag sheet. `/d/today` is the full Task list.

## States (never merged)

| State | Meaning | Card text |
| --- | --- | --- |
| ok | fresh fact from a recently checked feed | the fact |
| quiet | feed checked recently, nothing new | "Quiet." + checked time |
| late | feed not checked recently, or today's daily write missing | "No update yet from X." + last checked |
| unreachable | source could not be reached | "Could not reach X just now." |
| bad data | source answered with something unreadable | "X sent something the hub could not read." |
| not connected | no source wired | "X is not connected yet." |

"Quiet" is only shown when a recently checked feed supports it. A feed with no items whose last check
is too old is **late**, not quiet. The morning message has the same states and never silently disappears.

## Freshness: two clocks

1. **Feed recency.** Each feed's `checked_at` must be within its refresh contract's
   `max_feed_age_hours`. An old feed is late even if its records look recent, and its content is hidden.
2. **Record freshness.** Each record's `source_updated_at` must pass its own rule (`max_age` hours, or
   `daily_by` a Chicago hour). A stale record is never picked as the next thing; a stale fact shows as
   "Last known: ..." with "May be out of date".

Dates are computed in America/Chicago on the server.

## Refresh contracts (`REFRESH_CONTRACTS` in `hub/src/contract.ts`)

Each source has a deadline (CT), maximum feed age, and late and failure treatment.
**Owner is `null` for every source on purpose.** No source may be wired until a real owner, deadline
and failure treatment are agreed. No owners or live feeds are invented here.

## Source contract

- **Task**: `id, domain, label (declarative), body, status (needs_you | later | waiting), source {label, url?, record_ref}, source_updated_at, checked_at, freshness`.
- **Domain fact**: `text, source, source_updated_at, freshness`.
- **Calendar entry**: `id, title, due_date (CT), due_time (CT or null), source`.
- **Morning message**: `text, for_date, generated_at, source`. Passed through verbatim from the canonical object behind the morning message; never rewritten here.
- **Feed**: `{ ok: true, checked_at, written_for_date?, items }` or `{ ok: false, reason, last_checked_at? }`.

Standing rules: source order is kept (no recommendations); no job counts until a verified feed exists;
no BreakerOps scorecard until its metric and refresh match the existing weekly report; the proposed
`hub_cards` endpoint is **not** wired; no grant, RLS or service-credential changes; Gmail and finance
stay out.

## Where it lives and why

GitHub Pages cannot enforce sign-in, so anything in `public/` would be readable by anyone. The hub is a
**separate Cloudflare Worker** in `hub/` with its own `wrangler.toml`. It is not imported by `src/` and
never reaches `dist/`.

## Security design (proposal)

- **Sign-in: Cloudflare Access** (free Zero Trust plan), one allowed email. Access owns the session
  cookie (HttpOnly, Secure).
- The Worker **re-verifies the Access JWT on every private route**: RS256 signature against the team's
  keys, issuer, audience, expiry, not-before, and the allowed email.
- One public route: `/hub-public.css`, generic styling so sign-in and error pages render readably.
  It contains nothing private. All other routes, including 404s, need a verified session first.
- `workers_dev = false`, `preview_urls = false`. All responses private and no-store, `Vary` on session
  headers, strict CSP, no Worker-set cookies, nothing logged.
- Distinct messages: signed out or expired (401), wrong account (403), sign-in check down (503),
  not set up (503, stays locked), too many requests (429).
- Sign out: `/cdn-cgi/access/logout`.

### Unverified until deployed (required before any private data connects)

Local tests run the Worker code with a throwaway signing key. They do **not** prove:

- real Cloudflare Access sign-in on the chosen hostname;
- cookie sign-out and session expiry (local tests only show that a request with no token is refused);
- isolation from other hostnames (local tests only show that a request with no token is refused whatever
  the Host header says; they do not exercise DNS, routes or workers.dev settings);
- Cloudflare cache isolation (local tests check response headers only).

Each needs a check against the deployed setup before any real source is wired.

### Separate decisions (not made here)

Hostname and DNS, the allowed identity, and session length (remembered device).

### Secrets (dashboard only, never in chat, code or PRs)

`ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `ALLOWED_EMAILS` as Worker secrets. If any is missing the hub stays locked.

## Flags

"Flag as wrong" (on domain pages) copies a note. **It sends nothing**, and the sheet says so.

## Run it locally (synthetic data)

```
npx vitest run tests/hub-*.test.ts
npx tsx hub/scripts/preview.ts /some/out/dir /path/to/chrome
```

The preview runs the real Worker handler behind a local server, saves screenshots and `report.json`.
Results from this PR are in `hub/docs/`.

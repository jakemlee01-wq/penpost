# Private hub (stage 1A)

A private, phone-first home page that answers one question: **What needs me next?**
It sits on top of existing tools and does not replace any of them.

Stage 1A is a **synthetic-data prototype plus an authentication design**. No live sources are
connected, nothing is deployed, and every name, task and link in the fixtures is invented.

## Where it lives and why

The news site is static and published by GitHub Pages. GitHub Pages cannot enforce sign-in, so
anything placed in `public/` would be readable by anyone who guesses the URL. The hub is therefore a
**separate Cloudflare Worker** in `hub/`, never part of the Pages build. It is not imported by `src/`,
not copied into `dist/`, and has its own `hub/wrangler.toml`.

## Security design (proposal for review)

**Sign-in: Cloudflare Access (Zero Trust free plan, up to 50 users, no cost).**
An established identity service handles sign-in instead of a hand-written passcode.

1. Access application on the hub hostname (proposed `hub.penpost.co`), policy: *Allow*, *Emails*, one address.
   Login method: one-time PIN to email (no extra account needed), or Google if preferred.
2. Access keeps the session in its own `CF_Authorization` cookie: HttpOnly, Secure, scoped to the hub hostname.
3. The Worker **independently verifies** the signed JWT Access forwards (`Cf-Access-Jwt-Assertion`) on every
   request: RS256 signature against the team's published keys, issuer, this application's audience tag,
   expiry and not-before, and the email against `ALLOWED_EMAILS`. So even if Access is misconfigured, or
   someone reaches the Worker another way (workers.dev, another hostname, a forged header), the Worker refuses.
4. `workers_dev = false` and `preview_urls = false`: no public workers.dev address or preview URLs.
5. Every route needs a verified session first, including CSS, JS and 404s. Nothing private is built before that.
6. All responses: `Cache-Control: private, no-store`, `Vary` on the session headers, strict CSP
   (no inline script or style), `noindex`, `no-referrer`, no framing. The Worker sets no cookies of its own.
7. Sign out: `/cdn-cgi/access/logout` (ends the Access session).
8. Failures are told apart: signed out / expired (401), wrong account (403), sign-in check down (503),
   hub not set up (503, fails closed), too many requests (429).
9. Rate limiting: Access handles login attempts. An optional per-IP Workers rate limit binding runs before
   the JWT check (sketched in `wrangler.toml`; confirm current Cloudflare docs before enabling).
10. Input limits: GET and HEAD only, URLs over 2048 characters refused, tokens over 8 KB refused.
    All source text is HTML-escaped; only `https:` links are rendered.
11. Nothing is logged: no tokens, emails or data.

**Remembered device (decision needed).** Access session length is set per application.
Proposal: **14 days** on a personal phone, with "Sign out" available. Longer is more convenient but a lost,
unlocked phone stays signed in that long. Options: 24 hours, 7 days, 14 days, 30 days.

**Hosting assumption to confirm.** A custom hostname needs penpost.co's DNS on Cloudflare. If it is not,
the hub must stay local until it is (or until a different Cloudflare-managed hostname is chosen). Access can
also protect a workers.dev hostname, but this config disables workers.dev to keep one door.

### Secrets and settings (set in the Cloudflare dashboard, never in chat, code or PRs)

| Name | What | Where |
| --- | --- | --- |
| `ACCESS_TEAM_DOMAIN` | e.g. `yourteam.cloudflareaccess.com` | Worker secret |
| `ACCESS_AUD` | Access application Audience (AUD) tag | Worker secret |
| `ALLOWED_EMAILS` | the one allowed email | Worker secret |

If any is missing the hub stays locked and says "Hub not set up".

## Source contract (proposal; nothing is wired)

Defined in `hub/src/contract.ts`.

**Item**: `id`, `label`, `body`, `status` (To do, Waiting on someone, In progress, Stuck, Scheduled),
`source { label, url?, record_ref }`, `source_updated_at`, `checked_at`, `freshness`.

**Freshness rule**: `max_age` (hours since the source record changed) or `daily_by` (must be updated today,
Chicago time, once a given hour has passed). Stale items are marked "Out of date" and are never shown as current.

**Feeds**: each source returns `{ ok: true, checked_at, written_for_date?, items }` or
`{ ok: false, checked_at, reason }`. The hub distinguishes:

| State | Meaning | Screen |
| --- | --- | --- |
| `ok` | source answered for today | items |
| `empty` | source answered, nothing today | "Nothing on the list today." |
| `not_updated` | daily write for today has not landed | says so; yesterday's list is not shown |
| `unavailable` | source unreachable, not connected or unreadable | says which |

Rules:

- Today is computed in **America/Chicago, on the server**.
- **Calendar is independent**: a missing or failed daily write never hides it.
- **Order is the source's order.** No ranking or recommendations in this stage.
- **Morning message** is passed through verbatim from the same canonical object that produces the morning
  message, shown only when `for_date` is today. The hub never rewrites it.
- **Job applications**: no counts until a verified source feed exists. Nothing hand-copied.
- **No BreakerOps scorecard** until its exact metric and refresh match the existing weekly report.
- **Not wired**: the proposed `hub_cards` REST endpoint (read access has not passed validation). No grant,
  RLS or service-credential changes.

### Stage 1B (after review)

Choose the auth route above (or another), create least-privilege server-side read access per source,
and agree a refresh contract per source: owner, time (CT), and what happens when it fails or is late.
Then wire a small set of real sources with provenance. Gmail, finance and automated actions stay out.

## Flags

"Flag as wrong" opens a sheet and copies a note to the clipboard. **It does not send anything**, and the
sheet says so. Routing flags somewhere is a stage 1B decision.

## Run it locally (synthetic data)

```
npx vitest run tests/hub-*.test.ts
npx tsx hub/scripts/preview.ts /some/out/dir /path/to/chrome
```

The preview runs the real Worker handler behind a local server with a throwaway signing key standing in
for Access, then saves screenshots and `report.json`. Results from this PR are in `hub/docs/`.

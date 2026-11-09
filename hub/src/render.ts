/**
 * Server-rendered hub pages. Every source value goes through esc(); only https links are rendered.
 *
 * Glance surface: title, morning message and calendar (the hero), ONE next thing with a quiet count,
 * then five domain cards. No buttons on the glance surface; tasks and the flag sheet live one tap
 * behind, on each domain page.
 */
import { ctDayShort, ctTime, ctTitleDate, wallTimeLabel } from "./chicago";
import { countText, stateText, type DomainView, type SectionState, type TaskView, type TodayView } from "./contract";

export const LOGOUT_PATH = "/cdn-cgi/access/logout";
export const PUBLIC_CSS_PATH = "/hub-public.css";

export function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeUrl(u: string | undefined): string | null {
  if (!u) return null;
  try {
    const url = new URL(u);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function shell(title: string, body: string, css: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<title>${esc(title)}</title>
<link rel="stylesheet" href="${css}">
</head>
<body>
${body}
</body>
</html>`;
}

/** "checked 7:00 AM", or "checked Sun Nov 8, 7:00 AM" when not today. */
function when(isoStr: string | undefined, today: string, verb: string): string {
  if (!isoStr) return "";
  const d = new Date(isoStr);
  if (Number.isNaN(d.getTime())) return "";
  const sameDay = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(d) === today;
  return `${verb} ${sameDay ? "" : `${ctDayShort(d)}, `}${ctTime(d)}`;
}

function prov(parts: string[]): string {
  const p = parts.filter(Boolean);
  return p.length ? `<p class="prov">${esc(p.join(" · "))}</p>` : "";
}

function stateBlock(state: SectionState, source: string, quiet: string): string {
  return `<p class="state state-${esc(state.kind)}">${esc(stateText(state, source, quiet))}</p>`;
}

const banner = (view: TodayView) => (view.example ? `<p class="example">Example data. Everything here is invented.</p>` : "");

function domainCard(d: DomainView, view: TodayView): string {
  let main: string;
  let extra = "";
  if (d.id === "today") {
    main = d.state.kind === "ok" ? countText(view.counts) : stateText(d.state, d.sourceName, "Nothing open.", true);
  } else if (d.state.kind === "ok" && d.fact) {
    main = d.fact.fresh ? d.fact.text : `Last known: ${d.fact.text}`;
    if (!d.fact.fresh) extra = `<span class="card-warn">May be out of date. Last changed ${esc(when(d.fact.source_updated_at, view.today, "").trim())}.</span>`;
  } else {
    main = stateText(d.state, d.sourceName, "Quiet.", true);
  }
  const okish = d.state.kind === "ok" || d.state.kind === "quiet";
  const lastChecked = d.state.kind === "late" || d.state.kind === "unreachable" ? d.state.last_checked_at : undefined;
  const p = okish ? when(d.checked_at, view.today, "checked") : lastChecked ? when(lastChecked, view.today, "last checked") : "";
  return `<li><a class="card card-${esc(d.state.kind)}" href="/d/${esc(d.id)}">
<span class="card-name">${esc(d.name)}</span>
<span class="card-fact">${esc(main)}</span>${extra}
${p ? `<span class="card-prov">${esc(p)}</span>` : ""}
</a></li>`;
}

export function renderGlance(view: TodayView, email: string): string {
  const now = new Date(view.generated_at);
  const today = view.today;

  const m = view.morning;
  const morning =
    m.state.kind === "ok" && m.message
      ? `<p class="morning-text">${esc(m.message.text)}</p>${prov([m.message.source.label, when(m.message.generated_at, today, "written")])}`
      : stateBlock(m.state, "the morning message", "No morning message today.");

  const c = view.calendar;
  const cal =
    c.state.kind === "ok"
      ? `<ul class="cal">${c.entries.map((e) => `<li><span class="cal-time">${esc(wallTimeLabel(e.due_time))}</span><span class="cal-title">${esc(e.title)}</span></li>`).join("")}</ul>${prov(["Calendar", when(c.checked_at, today, "checked")])}`
      : `${stateBlock(c.state, "the calendar", "Nothing on the calendar today.")}${c.state.kind === "quiet" ? prov(["Calendar", when(c.checked_at, today, "checked")]) : ""}`;

  let next: string;
  const t = view.tasks;
  if (t.state.kind !== "ok" && t.state.kind !== "quiet") next = stateBlock(t.state, "the task list", "");
  else if (view.next) {
    const n = view.next;
    next = `<p class="next-label">${esc(n.label)}</p><p class="next-body">${esc(n.body)}</p>${prov([n.source.label, when(n.source_updated_at, today, "changed"), when(t.checked_at, today, "checked")])}`;
  } else next = `<p class="next-label quiet">Nothing needs you right now.</p>`;
  const more = view.counts.total - (view.next ? 1 : 0);
  const countLine = t.state.kind === "ok" ? `<p class="count">${esc(countText(view.counts))}${more > 0 ? ` <a href="/d/today">${more} more in Task list</a>` : ""}</p>` : "";

  const body = `<main class="wrap">
${banner(view)}
<h1>Today - ${esc(ctTitleDate(now))}</h1>
<section class="hero" aria-label="Morning message and calendar">
<div class="morning">${morning}</div>
<div class="cal-wrap"><h2>Calendar</h2>${cal}</div>
</section>
<section class="next" aria-labelledby="next-h">
<h2 id="next-h">Next</h2>
${next}
${countLine}
</section>
<section aria-labelledby="areas-h">
<h2 id="areas-h" class="visually-hidden">Areas</h2>
<ul class="cards">${view.domains.map((d) => domainCard(d, view)).join("\n")}</ul>
</section>
<footer class="foot"><p>Signed in as ${esc(email)}. <a href="${LOGOUT_PATH}">Sign out</a></p><p>Updated ${esc(ctTime(now))}</p></footer>
</main>`;
  return shell(`Today - ${ctTitleDate(now)}`, body, "/hub.css");
}

function taskHtml(t: TaskView, today: string): string {
  const url = safeUrl(t.source.url);
  return `<li class="task${t.fresh ? "" : " is-stale"}">
<p class="task-label">${esc(t.label)}</p>
<p class="task-body">${esc(t.body)}</p>
<p class="task-status">${esc(t.status_text)}</p>
${t.fresh ? "" : `<p class="stale">Out of date. Check ${esc(t.source.label)} before acting.</p>`}
${prov([`From ${t.source.label}`, when(t.source_updated_at, today, "changed"), when(t.checked_at, today, "checked")])}
<div class="actions">${url ? `<a class="open" href="${esc(url)}" rel="noreferrer">Open in ${esc(t.source.label)}</a>` : ""}<button type="button" class="flag" data-id="${esc(t.id)}" data-label="${esc(t.label)}" data-ref="${esc(t.source.record_ref)}">Flag as wrong</button></div>
</li>`;
}

export function renderDomain(view: TodayView, id: string, email: string): string | null {
  const d = view.domains.find((x) => x.id === id);
  if (!d) return null;
  const today = view.today;
  const title = d.id === "today" ? "Task list" : d.name;
  let factHtml = "";
  if (d.id !== "today") {
    if (d.state.kind === "ok" && d.fact) {
      factHtml = `<div class="fact"><p class="fact-text">${esc(d.fact.fresh ? d.fact.text : `Last known: ${d.fact.text}`)}</p>${d.fact.fresh ? "" : `<p class="stale">May be out of date.</p>`}${prov([`From ${d.fact.source.label}`, when(d.fact.source_updated_at, today, "changed"), when(d.checked_at, today, "checked")])}</div>`;
    } else factHtml = `<div class="fact">${stateBlock(d.state, d.sourceName, "Quiet. Nothing new.")}${d.state.kind === "quiet" ? prov([cap(d.sourceName), when(d.checked_at, today, "checked")]) : ""}</div>`;
  }
  const t = view.tasks;
  let tasks: string;
  if (t.state.kind !== "ok" && t.state.kind !== "quiet") tasks = stateBlock(t.state, "the task list", "");
  else if (!d.tasks.length) tasks = `<p class="state">No open tasks here.</p>`;
  else tasks = `<ol class="tasks">${d.tasks.map((x) => taskHtml(x, today)).join("\n")}</ol>`;

  const body = `<main class="wrap">
${banner(view)}
<p class="back"><a href="/">Back to Today</a></p>
<h1>${esc(title)}</h1>
${factHtml}
<section aria-labelledby="tasks-h"><h2 id="tasks-h">${d.id === "today" ? "Open" : "Tasks"}</h2>${tasks}</section>
<footer class="foot"><p>Signed in as ${esc(email)}. <a href="${LOGOUT_PATH}">Sign out</a></p></footer>
</main>
<dialog id="flag-sheet" aria-labelledby="flag-h">
<form method="dialog" class="sheet">
<h2 id="flag-h">Flag as wrong</h2>
<p class="sheet-item" id="flag-item"></p>
<fieldset>
<legend>What is wrong?</legend>
<label><input type="radio" name="what" value="already done" checked> Already done</label>
<label><input type="radio" name="what" value="wrong details"> Wrong details</label>
<label><input type="radio" name="what" value="should not be here"> Should not be here</label>
</fieldset>
<label class="note-label" for="flag-note">Note (optional)</label>
<textarea id="flag-note" maxlength="500" rows="3"></textarea>
<p class="sheet-warn"><strong>Flags are not sent anywhere yet.</strong> Copy the note and paste it where you track fixes.</p>
<p class="sheet-status" id="flag-status" role="status" aria-live="polite"></p>
<div class="sheet-actions">
<button type="button" id="flag-copy" class="primary">Copy note</button>
<button value="close" class="secondary">Close</button>
</div>
</form>
</dialog>
<script src="/hub.js" defer></script>`;
  return shell(title, body, "/hub.css");
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export type ErrorKind = "signed_out" | "expired" | "forbidden" | "auth_down" | "not_configured" | "rate_limited" | "not_found" | "data_down";

const ERRORS: Record<ErrorKind, { status: number; title: string; text: string; action?: string }> = {
  signed_out: { status: 401, title: "Please sign in", text: "You are not signed in.", action: `<a class="button" href="/">Sign in</a>` },
  expired: { status: 401, title: "Please sign in again", text: "Your sign-in has expired.", action: `<a class="button" href="/">Sign in again</a>` },
  forbidden: { status: 403, title: "Not your hub", text: "This account cannot open this hub.", action: `<a class="button" href="${LOGOUT_PATH}">Sign out and switch account</a>` },
  auth_down: { status: 503, title: "Sign-in check is down", text: "The hub could not check your sign-in just now. Nothing is wrong with your account. Try again in a few minutes." },
  not_configured: { status: 503, title: "Hub not set up", text: "Sign-in has not been set up for this hub yet, so it stays locked." },
  rate_limited: { status: 429, title: "Slow down", text: "Too many requests. Wait a minute and try again." },
  not_found: { status: 404, title: "Not found", text: "There is nothing at this address.", action: `<a class="button" href="/">Back to Today</a>` },
  data_down: { status: 500, title: "Something broke", text: "The hub hit an error building this page. Your sources were not changed." },
};

export function errorInfo(kind: ErrorKind) {
  return ERRORS[kind];
}

/** Error pages use only the public stylesheet, so they render styled even when signed out. */
export function renderError(kind: ErrorKind): string {
  const e = ERRORS[kind];
  return shell(e.title, `<main class="lock"><p class="lock-mark" aria-hidden="true">Private hub</p><h1>${esc(e.title)}</h1><p>${esc(e.text)}</p>${e.action ?? ""}</main>`, PUBLIC_CSS_PATH);
}

/** Public, generic styles for error pages only. Contains nothing private. */
export const PUBLIC_CSS = `:root{--bg:#f6f7f9;--ink:#16181d;--muted:#5d6470;--blue:#007aff}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:18px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;min-width:320px}
.lock{max-width:440px;margin:0 auto;padding:22vh 20px 40px;text-align:center}
.lock-mark{font-size:14px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);margin:0 0 8px}
h1{font-size:26px;line-height:1.2;margin:0 0 8px}
p{margin:0 0 12px}
.button{display:inline-block;margin-top:8px;min-height:48px;line-height:48px;padding:0 20px;border-radius:12px;background:var(--blue);color:#fff;text-decoration:none;font-weight:600}
.button:focus-visible{outline:3px solid var(--blue);outline-offset:3px}
`;

export const HUB_CSS = `:root{--bg:#f6f7f9;--card:#fff;--ink:#16181d;--muted:#5d6470;--faint:#8a909b;--line:#e3e6eb;--blue:#007aff;--warn:#8a5a00;--warn-bg:#fff6e0}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:17px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;min-width:320px}
.wrap{max-width:620px;margin:0 auto;padding:12px 16px 40px}
.example{font-size:13px;color:var(--muted);background:#eef1f5;border-radius:8px;padding:4px 10px;margin:0 0 8px}
h1{font-size:28px;line-height:1.15;margin:4px 0 12px;letter-spacing:-.015em}
h2{font-size:13px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);margin:0 0 8px}
.hero{background:var(--card);border-radius:18px;padding:14px 16px;box-shadow:0 1px 2px rgba(0,0,0,.04)}
.morning-text{font-size:19px;line-height:1.35;margin:0}
.cal-wrap{margin-top:12px;padding-top:10px;border-top:1px solid var(--line)}
.cal{list-style:none;margin:0;padding:0}
.cal li{display:flex;gap:12px;padding:2px 0}
.cal-time{flex:none;width:72px;color:var(--muted);font-variant-numeric:tabular-nums}
.prov{font-size:13px;color:var(--faint);margin:6px 0 0}
.state{margin:0;color:var(--muted)}
.state-late,.state-unreachable,.state-bad_data{color:var(--warn)}
.next{margin-top:18px;padding:2px 0 2px 14px;border-left:3px solid var(--blue)}
.next-label{font-size:20px;font-weight:600;line-height:1.3;margin:0}
.next-label.quiet{font-weight:500;color:var(--muted)}
.next-body{margin:4px 0 0}
.count{font-size:15px;color:var(--muted);margin:6px 0 0}
.count a{color:var(--blue);text-decoration:none;font-weight:600;display:inline-block;min-height:44px;line-height:44px}
.cards{list-style:none;margin:14px 0 0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px}
.card{display:flex;flex-direction:column;gap:2px;min-height:84px;height:100%;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px 14px;color:inherit;text-decoration:none}
.card-name{font-size:14px;font-weight:600;color:var(--muted)}
.card-fact{font-size:16px;line-height:1.35}
.card-prov{margin-top:auto;font-size:12px;color:var(--faint)}
.card-warn{font-size:13px;color:var(--warn)}
.card-quiet .card-fact{color:var(--muted)}
.card-late,.card-unreachable,.card-bad_data{background:#fffdf7;border-color:#f0dca8}
.card-late .card-fact,.card-unreachable .card-fact,.card-bad_data .card-fact{font-size:14px;color:var(--warn)}
.card-not_connected .card-fact{font-size:14px;color:var(--muted)}
.foot{margin-top:28px;font-size:14px;color:var(--muted)}
.foot p{margin:0}
.foot a{color:var(--blue);display:inline-block;min-height:44px;line-height:44px}
.back{margin:0}
.back a{color:var(--blue);text-decoration:none;font-weight:600;display:inline-block;min-height:44px;line-height:44px}
.fact{background:var(--card);border-radius:14px;padding:14px 16px;margin-bottom:20px}
.fact-text{font-size:19px;margin:0}
.tasks{list-style:none;margin:0;padding:0;display:grid;gap:10px}
.task{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 16px}
.task-label{font-size:18px;font-weight:600;margin:0}
.task-body{margin:4px 0 0}
.task-status{font-size:14px;color:var(--muted);margin:6px 0 0}
.is-stale{border-style:dashed}
.is-stale .task-label,.is-stale .task-body{color:var(--muted)}
.stale{margin:8px 0 0;font-size:14px;color:var(--warn);background:var(--warn-bg);border-radius:8px;padding:6px 10px}
.actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.flag,.open{min-height:44px;padding:0 14px;border-radius:10px;border:1px solid var(--line);background:#fff;color:var(--ink);font:inherit;font-size:15px;cursor:pointer;display:inline-flex;align-items:center;text-decoration:none}
.open{color:var(--blue);font-weight:600}
a:focus-visible,button:focus-visible,textarea:focus-visible,input:focus-visible{outline:3px solid var(--blue);outline-offset:2px}
.visually-hidden{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
dialog{border:0;border-radius:16px;padding:0;width:min(520px,calc(100% - 24px));max-height:calc(100% - 24px)}
dialog::backdrop{background:rgba(0,0,0,.35)}
.sheet{padding:18px}
.sheet h2{font-size:20px;text-transform:none;letter-spacing:0;color:var(--ink);margin:0 0 4px}
.sheet-item{color:var(--muted);margin:0 0 10px}
fieldset{border:0;padding:0;margin:0 0 10px}
legend{font-weight:600;margin-bottom:4px}
fieldset label{display:flex;align-items:center;gap:10px;min-height:44px}
input[type=radio]{width:22px;height:22px}
.note-label{font-weight:600;display:block;margin-bottom:4px}
textarea{width:100%;font:inherit;font-size:16px;border:1px solid var(--line);border-radius:10px;padding:8px}
.sheet-warn{font-size:15px;color:var(--warn);background:var(--warn-bg);border-radius:8px;padding:8px 10px}
.sheet-status{min-height:1.4em;font-size:15px;margin:4px 0}
.sheet-actions{display:flex;gap:10px;flex-wrap:wrap}
.sheet-actions button{flex:1 1 140px;min-height:48px;border-radius:12px;font:inherit;font-weight:600;cursor:pointer}
.primary{background:var(--blue);color:#fff;border:0}
.secondary{background:#fff;border:1px solid var(--line);color:var(--ink)}
@media (max-width:359px){.cards{grid-template-columns:1fr}}
`;

export const HUB_JS = `(function(){
var d=document.getElementById("flag-sheet");if(!d)return;
var item=document.getElementById("flag-item"),note=document.getElementById("flag-note"),status=document.getElementById("flag-status"),copy=document.getElementById("flag-copy");
var current=null,opener=null;
document.addEventListener("click",function(e){var b=e.target.closest&&e.target.closest("button.flag");if(!b)return;
current={id:b.getAttribute("data-id"),label:b.getAttribute("data-label"),ref:b.getAttribute("data-ref")};opener=b;
item.textContent=current.label;note.value="";status.textContent="";
if(d.showModal)d.showModal();else d.setAttribute("open","");});
d.addEventListener("close",function(){if(opener)opener.focus();});
copy.addEventListener("click",function(){if(!current)return;
var what=(d.querySelector("input[name=what]:checked")||{}).value||"wrong";
var text="Hub flag: \\""+current.label+"\\" ("+current.ref+") is "+what+"."+(note.value.trim()?" Note: "+note.value.trim().slice(0,500):"");
function done(ok){status.textContent=ok?"Copied. Not sent anywhere. Paste it where you track fixes.":"Could not copy. Select and copy this: "+text;}
if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(text).then(function(){done(true)},function(){done(false)});}else{done(false);}
});
})();
`;

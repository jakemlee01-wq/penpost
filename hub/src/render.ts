/**
 * Server-rendered hub page. Every value from a source goes through esc(); only https links are
 * rendered as links. The page works without JavaScript; the script only runs the flag sheet.
 */
import { ctDayLong, ctTime, wallTimeLabel } from "./chicago";
import { stateMessage, type ItemView, type TodayView } from "./contract";

export const VISIBLE_ITEMS = 5;
export const LOGOUT_PATH = "/cdn-cgi/access/logout";

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

function shell(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<title>${esc(title)}</title>
<link rel="stylesheet" href="/hub.css">
</head>
<body>
${body}
</body>
</html>`;
}

function itemHtml(it: ItemView): string {
  const url = safeUrl(it.source.url);
  const checked = ctTime(new Date(it.checked_at));
  const stale = it.fresh
    ? ""
    : `<p class="stale">Out of date. Last changed ${esc(ctTime(new Date(it.source_updated_at)))} on ${esc(new Date(it.source_updated_at).toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric" }))}. Check the source before acting.</p>`;
  return `<li class="item${it.fresh ? "" : " is-stale"}">
  <div class="item-top"><h3 class="item-label">${esc(it.label)}</h3><span class="status status-${esc(it.status)}">${esc(it.status_label)}</span></div>
  <p class="item-body">${esc(it.body)}</p>
  ${stale}
  <p class="meta">From ${esc(it.source.label)} · checked ${esc(checked)}</p>
  <div class="actions">${url ? `<a class="open" href="${esc(url)}" rel="noreferrer">Open in ${esc(it.source.label)}</a>` : ""}<button type="button" class="flag" data-id="${esc(it.id)}" data-label="${esc(it.label)}" data-ref="${esc(it.source.record_ref)}">Flag as wrong</button></div>
</li>`;
}

export function renderPage(view: TodayView, email: string): string {
  const now = new Date(view.generated_at);
  const next = view.next;
  let list = "";
  if (next.state.kind === "ok") {
    const first = next.items.slice(0, VISIBLE_ITEMS).map(itemHtml).join("\n");
    const rest = next.items.slice(VISIBLE_ITEMS);
    list = `<ol class="items">${first}</ol>`;
    if (rest.length) {
      list += `<details class="more"><summary>Show ${rest.length} more</summary><ol class="items" start="${VISIBLE_ITEMS + 1}">${rest.map(itemHtml).join("\n")}</ol></details>`;
    }
  } else {
    list = `<p class="notice notice-${esc(next.state.kind)}">${esc(stateMessage(next.state, "list"))}</p>`;
  }

  const cal = view.calendar;
  let calHtml = "";
  if (cal.state.kind === "ok") {
    calHtml = `<ul class="cal">${cal.entries.map((e) => `<li><span class="cal-time">${esc(wallTimeLabel(e.due_time))}</span><span class="cal-title">${esc(e.title)}</span></li>`).join("")}</ul>`;
  } else {
    calHtml = `<p class="notice notice-${esc(cal.state.kind)}">${esc(stateMessage(cal.state, "calendar"))}</p>`;
  }

  const morning = view.morning ? `<p class="morning">${esc(view.morning.text)}</p>` : "";

  const body = `<main class="wrap">
<header class="top">
<h1>What needs me next?</h1>
<p class="date">${esc(ctDayLong(now))} · updated ${esc(ctTime(now))}</p>
${morning}
</header>
<section aria-labelledby="list-h">
<h2 id="list-h" class="visually-hidden">Next items</h2>
${list}
</section>
<section aria-labelledby="cal-h" class="cal-section">
<h2 id="cal-h">Today's calendar</h2>
${calHtml}
</section>
<footer class="foot">
<p>Signed in as ${esc(email)}. <a href="${LOGOUT_PATH}">Sign out</a></p>
</footer>
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
  return shell("What needs me next?", body);
}

export type ErrorKind = "signed_out" | "expired" | "forbidden" | "auth_down" | "not_configured" | "rate_limited" | "not_found" | "data_down";

const ERRORS: Record<ErrorKind, { status: number; title: string; text: string; action?: string }> = {
  signed_out: { status: 401, title: "Please sign in", text: "You are not signed in.", action: `<a class="button" href="/">Sign in</a>` },
  expired: { status: 401, title: "Please sign in again", text: "Your sign-in has expired.", action: `<a class="button" href="/">Sign in again</a>` },
  forbidden: { status: 403, title: "Not your hub", text: "This account cannot open this hub.", action: `<a class="button" href="${LOGOUT_PATH}">Sign out and switch account</a>` },
  auth_down: { status: 503, title: "Sign-in check is down", text: "The hub could not check your sign-in just now. Nothing is wrong with your account. Try again in a few minutes." },
  not_configured: { status: 503, title: "Hub not set up", text: "Sign-in has not been set up for this hub yet, so it stays locked." },
  rate_limited: { status: 429, title: "Slow down", text: "Too many requests. Wait a minute and try again." },
  not_found: { status: 404, title: "Not found", text: "There is nothing at this address." },
  data_down: { status: 500, title: "Something broke", text: "The hub hit an error building this page. Your sources were not changed." },
};

export function errorInfo(kind: ErrorKind) {
  return ERRORS[kind];
}

export function renderError(kind: ErrorKind): string {
  const e = ERRORS[kind];
  return shell(e.title, `<main class="wrap lock"><h1>${esc(e.title)}</h1><p>${esc(e.text)}</p>${e.action ?? ""}</main>`);
}

export const HUB_CSS = `:root{--bg:#f6f7f9;--card:#fff;--ink:#16181d;--muted:#5d6470;--line:#e3e6eb;--blue:#007aff;--warn:#8a5a00;--warn-bg:#fff6e0;--stuck:#b3261e}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:18px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;min-width:320px}
.wrap{max-width:560px;margin:0 auto;padding:20px 16px 40px}
h1{font-size:28px;line-height:1.2;margin:8px 0 4px;letter-spacing:-.01em}
h2{font-size:20px;margin:0 0 10px}
.date{color:var(--muted);font-size:15px;margin:0 0 12px}
.morning{background:var(--card);border-left:4px solid var(--blue);border-radius:10px;padding:12px 14px;margin:0 0 16px}
.items{list-style:none;margin:0;padding:0;display:grid;gap:12px}
.item{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 16px}
.item-top{display:flex;gap:10px;align-items:flex-start;justify-content:space-between}
.item-label{font-size:19px;line-height:1.3;margin:0}
.item-body{margin:6px 0 0;color:var(--ink)}
.status{flex:none;font-size:14px;font-weight:600;padding:3px 9px;border-radius:999px;background:#eef1f5;color:var(--muted);white-space:nowrap}
.status-todo{background:#e8f1ff;color:#0057b8}
.status-blocked{background:#fdecea;color:var(--stuck)}
.meta{font-size:14px;color:var(--muted);margin:8px 0 0}
.is-stale{border-style:dashed;background:#fbfbfc}
.is-stale .item-label,.is-stale .item-body{color:var(--muted)}
.stale{margin:8px 0 0;font-size:15px;color:var(--warn);background:var(--warn-bg);border-radius:8px;padding:6px 10px}
.actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.flag,.open{min-height:44px;padding:0 14px;border-radius:10px;border:1px solid var(--line);background:#fff;color:var(--ink);font:inherit;font-size:15px;cursor:pointer;display:inline-flex;align-items:center;text-decoration:none}
.open{color:var(--blue);font-weight:600}
.more{margin-top:12px}
.more summary{min-height:44px;display:flex;align-items:center;color:var(--blue);font-weight:600;cursor:pointer}
.more .items{margin-top:8px}
.notice{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 16px;margin:0}
.notice-not_updated,.notice-unavailable{background:var(--warn-bg);border-color:#f0dca8;color:var(--warn)}
.cal-section{margin-top:28px}
.cal{list-style:none;margin:0;padding:0;background:var(--card);border:1px solid var(--line);border-radius:14px}
.cal li{display:flex;gap:14px;padding:12px 16px;border-top:1px solid var(--line)}
.cal li:first-child{border-top:0}
.cal-time{flex:none;width:84px;font-weight:600;color:var(--muted);font-variant-numeric:tabular-nums}
.foot{margin-top:32px;font-size:14px;color:var(--muted)}
.foot a{color:var(--blue);display:inline-block;min-height:44px;line-height:44px}
a:focus-visible,button:focus-visible,summary:focus-visible,textarea:focus-visible,input:focus-visible{outline:3px solid var(--blue);outline-offset:2px}
.visually-hidden{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.lock{text-align:center;padding-top:20vh}
.button{display:inline-block;margin-top:12px;min-height:44px;line-height:44px;padding:0 18px;border-radius:12px;background:var(--blue);color:#fff;text-decoration:none;font-weight:600}
dialog{border:0;border-radius:16px;padding:0;width:min(520px,calc(100% - 24px));max-height:calc(100% - 24px)}
dialog::backdrop{background:rgba(0,0,0,.35)}
.sheet{padding:18px}
.sheet h2{margin:0 0 4px}
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

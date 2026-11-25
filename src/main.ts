/**
 * Bare-bones front end: problem screen, confirm screen (with the free preview), progress screen.
 * Talks to the penpost-solver Worker. No API keys here; only the shared access code, kept in
 * this browser, while payments are out of scope.
 */
import type { ProjectView, StepView } from "../worker/src/types";

const API = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/+$/, "") ?? "";
const app = document.getElementById("app")!;
const ACTIVE = new Set(["intake", "planning", "plan_review", "solving", "final_check"]);
let timer: number | undefined;

// ------------------------------------------------------------------ helpers

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const usd = (n: number) => `$${n.toFixed(n > 0 && n < 0.1 ? 3 : 2)}`;
const mins = (ms: number) => (ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${Math.round(ms / 60_000)} min`);
const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });

function code(): string | null {
  try {
    return localStorage.getItem("penpost.code");
  } catch {
    return null;
  }
}
function saveCode(v: string | null) {
  try {
    if (v) localStorage.setItem("penpost.code", v);
    else localStorage.removeItem("penpost.code");
  } catch {
    /* private mode: ask again next time */
  }
}

async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}/api/projects${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", "x-access-code": code() ?? "" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (res.status === 401) {
    saveCode(null);
    route();
    throw new Error("That access code didn't work.");
  }
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data;
}

function bindAction(sel: string, fn: (btn: HTMLButtonElement) => Promise<void>) {
  const btn = app.querySelector<HTMLButtonElement>(sel);
  if (!btn) return;
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    const err = app.querySelector<HTMLElement>(".action-error");
    if (err) err.textContent = "";
    try {
      await fn(btn);
    } catch (e) {
      if (err) err.textContent = (e as Error).message;
    } finally {
      btn.disabled = false;
    }
  });
}

// ------------------------------------------------------------------ screens

function accessScreen() {
  app.innerHTML = `
    <h1>Enter your access code</h1>
    <p class="muted">The solver is invite-only while it's being tested.</p>
    <input type="password" id="code" autocomplete="current-password" aria-label="Access code" />
    <div class="row"><button id="go">Continue</button><span class="action-error error"></span></div>`;
  const input = app.querySelector<HTMLInputElement>("#code")!;
  input.focus();
  const go = () => {
    if (!input.value.trim()) return;
    saveCode(input.value.trim());
    route();
  };
  input.addEventListener("keydown", (e) => e.key === "Enter" && go());
  app.querySelector("#go")!.addEventListener("click", go);
}

function problemScreen() {
  app.innerHTML = `
    <h1>What problem do you want solved?</h1>
    <p class="muted">Describe the problem and the solution you want, in your own words. You'll get a free
      feasibility, cost and time preview before any paid work starts.</p>
    <textarea id="req" maxlength="8000" placeholder="Example: Every week I copy sales numbers from three CSV exports into one spreadsheet by hand. I want a script that merges them and flags any store whose sales dropped more than 10%."></textarea>
    <div class="row"><button id="submit">Get my free preview</button><span class="action-error error"></span></div>`;
  bindAction("#submit", async () => {
    const request = app.querySelector<HTMLTextAreaElement>("#req")!.value;
    const { id } = await api<{ id: string }>("", { request });
    location.hash = `#/p/${id}`;
  });
}

async function projectScreen(id: string) {
  clearTimeout(timer);
  let p: ProjectView;
  try {
    p = await api<ProjectView>(`/${encodeURIComponent(id)}`);
  } catch (e) {
    app.innerHTML = `<p class="error">${esc((e as Error).message)}</p><p><a href="#/">Start over</a></p>`;
    return;
  }
  if (location.hash !== `#/p/${id}`) return; // navigated away while loading

  // Keep open <details> and typed text across refreshes.
  const open = new Set([...app.querySelectorAll("details[open]")].map((d) => d.id));
  const typed = Object.fromEntries([...app.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("[data-keep]")].map((i) => [i.id, i.value]));

  app.innerHTML = render(p);
  open.forEach((d) => document.getElementById(d)?.setAttribute("open", ""));
  Object.entries(typed).forEach(([k, v]) => {
    const el = document.getElementById(k) as HTMLInputElement | null;
    if (el) el.value = v;
  });

  const reload = () => projectScreen(id);
  bindAction("#approve", async () => {
    await api(`/${id}/approve`, {});
    await reload();
  });
  bindAction("#revise", async () => {
    const note = (document.getElementById("note") as HTMLTextAreaElement).value;
    await api(`/${id}/revise`, { note });
    (document.getElementById("note") as HTMLTextAreaElement).value = "";
    await reload();
  });
  bindAction("#start", async () => {
    const box = document.getElementById("confirm") as HTMLInputElement | null;
    await api(`/${id}/start`, { confirmed: box ? box.checked : true });
    await reload();
  });
  bindAction("#resume", async () => {
    const cap = (document.getElementById("cap") as HTMLInputElement).value;
    await api(`/${id}/resume`, cap ? { capUsd: Number(cap) } : {});
    (document.getElementById("cap") as HTMLInputElement).value = "";
    await reload();
  });

  if (ACTIVE.has(p.status)) timer = window.setTimeout(reload, 4000);
}

const STATUS_TEXT: Record<string, string> = {
  intake: "Turning your description into a clear brief…",
  awaiting_approval: "Check the brief below.",
  planning: "Model A is planning the work…",
  plan_review: "Model B is reviewing the plan…",
  awaiting_start: "Your free preview is ready.",
  solving: "Solving: Model A and Model B are working through the steps.",
  final_check: "All steps passed. Running the final acceptance check…",
  done: "Done.",
  escalated: "Paused for Jake.",
  failed: "Stopped after an error.",
};

function render(p: ProjectView): string {
  const preStart = ["intake", "awaiting_approval", "planning", "plan_review", "awaiting_start"].includes(p.status);
  const parts: string[] = [];
  const bannerKind = p.status === "done" ? "done" : p.status === "failed" || p.status === "escalated" ? "fail" : "";
  parts.push(`<div class="card banner ${bannerKind}"><b>${esc(STATUS_TEXT[p.status] ?? p.status)}</b>
    ${p.escalation ? `<p>${esc(p.escalation)}</p>` : ""}
    ${p.summary ? `<p>${esc(p.summary)}</p>` : ""}</div>`);

  if (p.status === "escalated" || p.status === "failed") {
    parts.push(`<div class="card"><b>Resume</b><p class="small muted">Clears the pause and gives the stuck step fresh tries. Optionally raise the dollar cap (now ${usd(p.capUsd)}).</p>
      <div class="row"><input type="number" id="cap" data-keep min="0" step="0.5" placeholder="New cap in $ (optional)" style="max-width:220px" />
      <button id="resume">Resume</button><span class="action-error error"></span></div></div>`);
  }

  if (p.problem) {
    parts.push(`<h2>Problem</h2><p>${esc(p.problem)}</p><h2>Solution</h2><p>${esc(p.solution)}</p>
      <h2>Done means</h2><ol>${p.acceptance.map((c) => `<li>${esc(c)}</li>`).join("")}</ol>`);
  } else {
    parts.push(`<h2>You wrote</h2><p class="muted">${esc(p.request)}</p>`);
  }

  if (p.status === "awaiting_approval") {
    parts.push(`<div class="row"><button id="approve">Looks right</button></div>
      <details id="d-revise"><summary>Something's off</summary>
        <textarea id="note" data-keep placeholder="What should change?" style="min-height:90px"></textarea>
        <div class="row"><button class="secondary" id="revise">Redo the brief</button></div></details>
      <p class="action-error error"></p>`);
  }

  if (p.estimate && preStart) {
    const e = p.estimate;
    const userItems = p.checklist;
    parts.push(`<h2>Free preview</h2>
      <div class="stats">
        <div class="stat"><b>${userItems.some((c) => c.bucket === "blocker") ? "Needs you" : "Feasible"}</b><span>${e.modelSteps} step${e.modelSteps === 1 ? "" : "s"} the models can do</span></div>
        <div class="stat"><b>${usd(e.costLowUsd)} to ${usd(e.costHighUsd)}</b><span>estimated cost</span></div>
        <div class="stat"><b>${e.minutesLow} to ${e.minutesHigh} min</b><span>estimated time</span></div>
      </div>
      ${
        userItems.length
          ? `<h2>Before we start</h2><p class="small muted">The models can't do these. You need to handle them${userItems.some((c) => c.bucket === "blocker") ? ", and some need a real person (legal, tax or registration)" : ""}.</p>
             <ul>${userItems.map((c) => `<li><b>${esc(c.title)}</b>${c.bucket === "blocker" ? ' <span class="pill fail">needs a person</span>' : ""}<br><span class="small muted">${esc(c.detail)}</span></li>`).join("")}</ul>
             <label class="row small"><input type="checkbox" id="confirm" /> I've done these, or will do them myself.</label>`
          : ""
      }
      ${p.status === "awaiting_start" ? `<div class="row"><button id="start">Start solving</button><span class="muted small">Cap: ${usd(p.capUsd)}. Payments come later.</span></div><p class="action-error error"></p>` : ""}`);
  }

  if (!preStart) parts.push(progress(p));
  return parts.join("\n");
}

function progress(p: ProjectView): string {
  const modelSteps = p.steps.filter((s) => s.bucket === "model");
  const passed = modelSteps.filter((s) => s.status === "passed").length;
  const feed = p.events
    .filter((e) => ["make", "check", "final_check", "plan", "plan_review", "intake", "queue_empty", "escalate", "error", "start", "resume"].includes(e.action))
    .slice()
    .reverse();
  return `
    <h2>Progress</h2>
    <div class="stats">
      <div class="stat"><b>${passed} / ${modelSteps.length}</b><span>steps passed</span></div>
      <div class="stat"><b>${usd(p.spentUsd)}</b><span>cost so far (cap ${usd(p.capUsd)})</span></div>
      <div class="stat"><b>${mins(p.idle.A)} / ${mins(p.idle.B)}</b><span>idle time, Model A / B</span></div>
    </div>
    <h2>Steps</h2>
    ${p.steps.map(stepCard).join("")}
    <h2>Activity</h2>
    <ul class="feed">${feed
      .map(
        (e) => `<li><time>${clock(e.startedAt)}</time>
          <span>${esc(describe(e.actor, e.action, e.stepIdx))}${e.outcome && e.outcome !== "ok" ? ` <span class="pill ${esc(e.outcome)}">${esc(e.outcome)}</span>` : ""}${e.note ? `<br><span class="small muted">${esc(e.note)}</span>` : ""}</span>
          <span class="cost">${e.costUsd ? usd(e.costUsd) : ""}</span></li>`,
      )
      .join("")}</ul>`;
}

function describe(actor: string, action: string, step: number | null): string {
  const who = actor === "A" || actor === "B" ? `Model ${actor}` : actor === "user" ? "You" : "System";
  const s = step ? ` step ${step}` : "";
  const verbs: Record<string, string> = {
    make: `made${s}`,
    check: `checked${s}`,
    final_check: "ran the final acceptance check",
    plan: "wrote the plan",
    plan_review: "reviewed the plan",
    intake: "drafted the brief",
    queue_empty: "has nothing to do",
    escalate: "paused for Jake",
    error: "hit an error",
    start: "started solving",
    resume: "resumed",
  };
  return `${who} ${verbs[action] ?? action}`;
}

function stepCard(s: StepView): string {
  const label = s.bucket === "model" ? s.status : s.bucket === "blocker" ? "needs a person" : "yours";
  return `<div class="card step">
    <div class="step-head"><b>${s.idx}. ${esc(s.title)}</b><span class="pill ${esc(s.status)}">${esc(label)}</span></div>
    <span class="small muted">${s.bucket === "model" ? `${esc(s.maker)} makes, ${esc(s.checker)} checks` : "You handle this"}${s.rounds ? ` · ${s.rounds} failed check${s.rounds === 1 ? "" : "s"}` : ""}</span>
    <span class="small"><b>Check:</b> ${esc(s.check)}</span>
    ${s.checkerNotes && s.status !== "passed" ? `<span class="small error">Checker: ${esc(s.checkerNotes)}</span>` : ""}
    ${s.artifact ? `<details id="art-${s.idx}"><summary>Show the work</summary><pre>${esc(s.artifact)}</pre>${s.evidence ? `<p class="small muted">Evidence: ${esc(s.evidence)}</p>` : ""}</details>` : ""}
  </div>`;
}

// ------------------------------------------------------------------ routing

function route() {
  clearTimeout(timer);
  if (!code()) return accessScreen();
  const m = location.hash.match(/^#\/p\/([\w-]+)$/);
  if (m) {
    app.innerHTML = `<p class="muted">Loading…</p>`;
    void projectScreen(m[1]);
  } else problemScreen();
}

window.addEventListener("hashchange", route);
route();

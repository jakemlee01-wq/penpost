/**
 * PenPost Problem Solver API (Cloudflare Worker).
 *
 *   POST /api/projects                 {request}          -> {id}
 *   GET  /api/projects/:id                                 -> ProjectView
 *   POST /api/projects/:id/approve                         (accept the intake draft)
 *   POST /api/projects/:id/revise      {note}             (redo the intake draft)
 *   POST /api/projects/:id/start       {confirmed}        (start the paid solve)
 *   POST /api/projects/:id/resume      {capUsd?}          (Jake clears an escalation)
 *
 * Every request must carry the x-access-code header while payments are out of scope.
 * The cron advances every active project by one step a minute; user actions also kick
 * the next step straight away.
 */
import { approveIntake, createProject, projectView, resume, reviseIntake, runOne, startSolve, tick, UserError, type Deps } from "./engine";
import type { Env } from "./env";
import { liveCaller } from "./models";

const DEFAULT_ORIGINS = "https://penpost.co,https://www.penpost.co,http://localhost:5173";

function cors(origin: string): Record<string, string> {
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type, x-access-code",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}

function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

/** Constant-time string comparison for the access code. */
function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function handle(req: Request, env: Env, ctx: Pick<ExecutionContext, "waitUntil">, deps?: Deps): Promise<Response> {
  const d: Deps = deps ?? { env, callModel: liveCaller(env) };
  const url = new URL(req.url);
  const origin = req.headers.get("origin") ?? "";
  const allowed = (env.ALLOWED_ORIGINS || DEFAULT_ORIGINS).split(",").map((s) => s.trim());
  const headers = allowed.includes(origin) ? cors(origin) : {};

  if (req.method === "OPTIONS") return new Response(null, { status: allowed.includes(origin) ? 204 : 403, headers });
  if (origin && !allowed.includes(origin)) return json({ error: "origin not allowed" }, 403, {});
  if (!env.ACCESS_CODE) return json({ error: "server not configured" }, 503, headers);
  if (!same(req.headers.get("x-access-code") ?? "", env.ACCESS_CODE)) return json({ error: "wrong access code" }, 401, headers);

  const parts = url.pathname.replace(/\/+$/, "").split("/").filter(Boolean); // ["api","projects",id?,action?]
  if (parts[0] !== "api" || parts[1] !== "projects" || parts.length > 4) return json({ error: "not found" }, 404, headers);
  const [, , id, action] = parts;

  const body = async (): Promise<Record<string, unknown>> => {
    try {
      const b = await req.json();
      return b && typeof b === "object" ? (b as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  };
  const kick = (pid: string) => ctx.waitUntil(runOne(d, pid).catch((err) => console.error("kick failed", pid, err)));

  try {
    if (!id && req.method === "POST") {
      const b = await body();
      const newId = await createProject(d, typeof b.request === "string" ? b.request : "");
      kick(newId);
      return json({ id: newId }, 201, headers);
    }
    if (id && !action && req.method === "GET") return json(await projectView(d, id), 200, headers);
    if (id && action && req.method === "POST") {
      const b = await body();
      if (action === "approve") await approveIntake(d, id);
      else if (action === "revise") await reviseIntake(d, id, typeof b.note === "string" ? b.note : "");
      else if (action === "start") await startSolve(d, id, b.confirmed === true);
      else if (action === "resume") await resume(d, id, b.capUsd === undefined ? undefined : Number(b.capUsd));
      else return json({ error: "not found" }, 404, headers);
      kick(id);
      return json({ ok: true }, 200, headers);
    }
    return json({ error: "method not allowed" }, 405, headers);
  } catch (err) {
    if (err instanceof UserError) return json({ error: err.message }, err.status, headers);
    console.error(err);
    return json({ error: "server error" }, 500, headers);
  }
}

export default {
  fetch(req: Request, env: Env, ctx: ExecutionContext) {
    return handle(req, env, ctx);
  },
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(tick({ env, callModel: liveCaller(env) }));
  },
} satisfies ExportedHandler<Env>;

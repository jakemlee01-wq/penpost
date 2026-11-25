/**
 * A minimal D1 stand-in over Node's built-in SQLite, enough for the engine's queries.
 * Runs the real migration so tests use the production schema.
 */
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import type { DatabaseSync as DB } from "node:sqlite";

// Loaded via require: Vite 5 does not know the node:sqlite builtin.
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
type DatabaseSync = DB;

type Value = string | number | null;

class Stmt {
  constructor(
    private db: DatabaseSync,
    private sql: string,
    private params: Value[] = [],
  ) {}
  bind(...params: unknown[]) {
    return new Stmt(this.db, this.sql, params.map((p) => (p === undefined ? null : (p as Value))));
  }
  async first<T>(): Promise<T | null> {
    return (this.db.prepare(this.sql).get(...this.params) as T) ?? null;
  }
  async all<T>(): Promise<{ results: T[] }> {
    return { results: this.db.prepare(this.sql).all(...this.params) as T[] };
  }
  async run() {
    const r = this.db.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: Number(r.changes) } };
  }
  runSync() {
    this.db.prepare(this.sql).run(...this.params);
  }
}

export function makeD1() {
  const db = new DatabaseSync(":memory:");
  const dir = new URL("../worker/migrations/", import.meta.url);
  for (const f of readdirSync(dir).sort()) db.exec(readFileSync(new URL(f, dir), "utf8"));
  return {
    raw: db,
    prepare: (sql: string) => new Stmt(db, sql),
    batch: async (stmts: Stmt[]) => {
      db.exec("BEGIN");
      try {
        for (const s of stmts) s.runSync();
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
      return [];
    },
  } as unknown as D1Database & { raw: DatabaseSync };
}

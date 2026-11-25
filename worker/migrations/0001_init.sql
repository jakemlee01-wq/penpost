-- PenPost Problem Solver schema. Times are Unix milliseconds. Money is US dollars.

CREATE TABLE projects (
  id              TEXT PRIMARY KEY,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  status          TEXT NOT NULL,          -- see ProjectStatus in worker/src/types.ts
  resume_status   TEXT,                   -- where to pick up after an escalation is cleared
  request         TEXT NOT NULL,          -- the user's own words
  revision_note   TEXT,                   -- user's correction to the intake draft
  problem         TEXT,
  solution        TEXT,
  acceptance_json TEXT,                   -- string[] of pass/fail acceptance checks
  plan_notes      TEXT,                   -- reviewer notes for the next plan attempt
  plan_rounds     INTEGER NOT NULL DEFAULT 0,
  checklist_json  TEXT,                   -- before-we-start checklist (buckets 2 and 3)
  estimate_json   TEXT,
  cap_usd         REAL NOT NULL,
  preview_cap_usd REAL NOT NULL,
  spent_usd       REAL NOT NULL DEFAULT 0,
  summary         TEXT,
  escalation      TEXT,                   -- why the project is waiting on Jake
  lease_until     INTEGER,                -- simple lock so two runs never advance one project
  solve_started_at  INTEGER,
  finished_at     INTEGER
);
CREATE INDEX projects_status ON projects(status);

CREATE TABLE steps (
  id             TEXT PRIMARY KEY,
  project_id     TEXT NOT NULL REFERENCES projects(id),
  idx            INTEGER NOT NULL,
  title          TEXT NOT NULL,
  detail         TEXT NOT NULL,
  check_text     TEXT NOT NULL,           -- the step's own pass/fail check
  kind           TEXT NOT NULL,           -- build | write | research
  bucket         TEXT NOT NULL,           -- model | user | blocker
  depends_json   TEXT NOT NULL DEFAULT '[]',
  est_tokens     INTEGER NOT NULL DEFAULT 2000,
  status         TEXT NOT NULL,           -- pending | made | passed | failed | external
  rounds         INTEGER NOT NULL DEFAULT 0,
  artifact       TEXT,                    -- the maker's work product (all the checker sees)
  maker_notes    TEXT,                    -- the maker's explanation (never shown to the checker)
  checker_notes  TEXT,
  evidence       TEXT,
  started_at     INTEGER,
  finished_at    INTEGER,
  UNIQUE (project_id, idx)
);
CREATE INDEX steps_project ON steps(project_id);

-- One row per model call or notable system event. This is the audit log.
CREATE TABLE events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  TEXT NOT NULL REFERENCES projects(id),
  step_id     TEXT,
  actor       TEXT NOT NULL,              -- A | B | system | user
  provider    TEXT,
  model       TEXT,
  action      TEXT NOT NULL,              -- intake | plan | plan_review | make | check | final_check | queue_empty | escalate | error | approve | start | resume | revise
  started_at  INTEGER NOT NULL,
  finished_at INTEGER,
  tokens_in   INTEGER NOT NULL DEFAULT 0,
  tokens_out  INTEGER NOT NULL DEFAULT 0,
  cost_usd    REAL NOT NULL DEFAULT 0,
  outcome     TEXT,                       -- pass | fail | ok | error
  note        TEXT
);
CREATE INDEX events_project ON events(project_id, id);

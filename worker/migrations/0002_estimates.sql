-- Estimate vs. actual per project, for calibrating the estimator later.
-- One row per project, written when the free preview is ready and updated when the project stops.
CREATE TABLE estimates (
  project_id       TEXT PRIMARY KEY REFERENCES projects(id),
  estimated_at     INTEGER NOT NULL,
  model_steps      INTEGER NOT NULL,
  math_heavy       INTEGER NOT NULL DEFAULT 0,
  est_low_usd      REAL NOT NULL,
  est_high_usd     REAL NOT NULL,
  est_minutes_low  INTEGER NOT NULL,
  est_minutes_high INTEGER NOT NULL,
  preview_usd      REAL NOT NULL,   -- spent on brief, plan and review when the estimate was made
  outcome          TEXT,            -- done | escalated | failed (latest)
  recorded_at      INTEGER,
  actual_solve_usd REAL,            -- spent after solving started (what the estimate covers)
  actual_total_usd REAL,
  actual_solve_minutes REAL,
  model_calls      INTEGER,
  retries          INTEGER          -- calls retried after hitting the output limit
);

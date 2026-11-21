-- Schema v1 exactly as shipped in commit 0eae2fc (single workspace, rows tagged workspace_id = 'demo').
-- Used by tests/workspaces.test.mts to verify the v1 -> v2 migration.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS hires (
  id                TEXT PRIMARY KEY,
  workspace_id      TEXT NOT NULL,
  profile_id        TEXT NOT NULL,
  role              TEXT NOT NULL,
  skills            TEXT NOT NULL,           -- JSON array of SkillId, snapshot at hire time
  hourly_rate_cents INTEGER,                 -- rate snapshot; NULL for unbilled staff
  source            TEXT NOT NULL CHECK (source IN ('staff', 'marketplace')),
  desk              TEXT NOT NULL,
  hired_at          INTEGER NOT NULL,
  UNIQUE (workspace_id, profile_id),
  UNIQUE (workspace_id, desk)
);

CREATE TABLE IF NOT EXISTS jobs (
  id                     TEXT PRIMARY KEY,
  workspace_id           TEXT NOT NULL,
  client_request_id      TEXT NOT NULL,
  type                   TEXT NOT NULL,
  title                  TEXT NOT NULL,
  input                  TEXT NOT NULL,      -- JSON
  required_skill         TEXT NOT NULL,
  status                 TEXT NOT NULL CHECK (status IN ('needs_worker', 'queued', 'working', 'completed', 'failed')),
  hire_id                TEXT REFERENCES hires(id),
  recommended_profile_id TEXT,
  created_at             INTEGER NOT NULL,
  assigned_at            INTEGER,
  started_at             INTEGER,
  finished_at            INTEGER,
  error                  TEXT,               -- JSON {code, message}
  UNIQUE (workspace_id, client_request_id)
);
CREATE INDEX IF NOT EXISTS jobs_by_workspace ON jobs (workspace_id, created_at);

CREATE TABLE IF NOT EXISTS job_events (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  at     INTEGER NOT NULL,
  actor  TEXT NOT NULL,
  text   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS job_events_by_job ON job_events (job_id, id);

-- Simulator-side settings. Workers never read these directly; the simulated
-- station turns them into observations.
CREATE TABLE IF NOT EXISTS simulator_settings (
  workspace_id TEXT PRIMARY KEY,
  camera_fault TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reports (
  id                TEXT PRIMARY KEY,
  job_id            TEXT NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,
  hire_id           TEXT NOT NULL REFERENCES hires(id),
  mode              TEXT NOT NULL CHECK (mode IN ('live', 'sample', 'simulated')),
  outcome           TEXT NOT NULL,
  summary           TEXT NOT NULL,
  body              TEXT NOT NULL,           -- JSON: LookupResult or camera Incident
  runtime_ms        INTEGER NOT NULL,
  hourly_rate_cents INTEGER,
  demo_cost_cents   INTEGER,
  created_at        INTEGER NOT NULL
);

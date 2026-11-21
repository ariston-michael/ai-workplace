CREATE TABLE workspaces (
  id         TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 64 AND id NOT GLOB '*[^a-z0-9-]*'),
  name       TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  created_at INTEGER NOT NULL
, owner_sub TEXT CHECK (owner_sub IS NULL OR length(owner_sub) BETWEEN 1 AND 255));
INSERT INTO workspaces VALUES('default','Default office',1795269372461,NULL);
CREATE TABLE hires (
  id                TEXT PRIMARY KEY,
  workspace_id      TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  profile_id        TEXT NOT NULL,
  role              TEXT NOT NULL,
  skills            TEXT NOT NULL,           -- JSON array of SkillId, snapshot at hire time
  hourly_rate_cents INTEGER,                 -- rate snapshot; NULL for unbilled staff
  source            TEXT NOT NULL CHECK (source IN ('staff', 'marketplace')),
  desk              TEXT NOT NULL,
  hired_at          INTEGER NOT NULL, character_name TEXT, sprite TEXT, listing_kind TEXT CHECK (listing_kind IS NULL OR listing_kind IN ('official', 'community')), publisher_name TEXT,
  UNIQUE (workspace_id, profile_id),
  UNIQUE (workspace_id, desk),
  UNIQUE (workspace_id, id)
);
CREATE TABLE jobs (
  id                     TEXT PRIMARY KEY,
  workspace_id           TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  client_request_id      TEXT NOT NULL,
  type                   TEXT NOT NULL,
  title                  TEXT NOT NULL,
  input                  TEXT NOT NULL,      -- JSON
  required_skill         TEXT NOT NULL,
  status                 TEXT NOT NULL CHECK (status IN ('needs_worker', 'queued', 'working', 'completed', 'failed')),
  hire_id                TEXT,
  recommended_profile_id TEXT,
  created_at             INTEGER NOT NULL,
  assigned_at            INTEGER,
  started_at             INTEGER,
  finished_at            INTEGER,
  error                  TEXT,               -- JSON {code, message}
  UNIQUE (workspace_id, client_request_id),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, hire_id) REFERENCES hires (workspace_id, id)
);
CREATE TABLE job_events (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  at     INTEGER NOT NULL,
  actor  TEXT NOT NULL,
  text   TEXT NOT NULL
);
CREATE TABLE simulator_settings (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  camera_fault TEXT NOT NULL
);
CREATE TABLE reports (
  id                TEXT PRIMARY KEY,
  workspace_id      TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  job_id            TEXT NOT NULL UNIQUE,
  hire_id           TEXT NOT NULL,
  mode              TEXT NOT NULL CHECK (mode IN ('live', 'sample', 'simulated')),
  outcome           TEXT NOT NULL,
  summary           TEXT NOT NULL,
  body              TEXT NOT NULL,           -- JSON: LookupResult or camera Incident
  runtime_ms        INTEGER NOT NULL,
  hourly_rate_cents INTEGER,
  demo_cost_cents   INTEGER,
  created_at        INTEGER NOT NULL,
  FOREIGN KEY (workspace_id, job_id) REFERENCES jobs (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, hire_id) REFERENCES hires (workspace_id, id)
);
CREATE TABLE marketplace_listings (
      id                TEXT PRIMARY KEY CHECK (id GLOB 'community-*'),
      owner_sub         TEXT NOT NULL CHECK (length(owner_sub) BETWEEN 1 AND 255),
      client_request_id TEXT NOT NULL,
      publisher_name    TEXT NOT NULL,
      character_name    TEXT NOT NULL,
      role              TEXT NOT NULL,
      specialty         TEXT NOT NULL,
      greeting          TEXT NOT NULL,
      skills            TEXT NOT NULL,           -- JSON array of SkillId
      hourly_rate_cents INTEGER NOT NULL CHECK (hourly_rate_cents BETWEEN 100 AND 5000),
      sample_work       TEXT NOT NULL,
      sprite            TEXT NOT NULL,           -- JSON CustomSprite
      published_at      INTEGER NOT NULL,
      UNIQUE (owner_sub, client_request_id)
    );
CREATE INDEX jobs_by_workspace ON jobs (workspace_id, created_at);
CREATE INDEX job_events_by_job ON job_events (job_id, id);
CREATE INDEX workspaces_by_owner ON workspaces (owner_sub, created_at);
CREATE INDEX listings_by_published ON marketplace_listings (published_at);

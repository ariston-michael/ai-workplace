CREATE TABLE workspaces (
  id         TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 64 AND id NOT GLOB '*[^a-z0-9-]*'),
  name       TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  created_at INTEGER NOT NULL
, owner_sub TEXT CHECK (owner_sub IS NULL OR length(owner_sub) BETWEEN 1 AND 255));
INSERT INTO workspaces VALUES('default','Default office',1795269372546,NULL);
CREATE TABLE hires (
  id                TEXT PRIMARY KEY,
  workspace_id      TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  profile_id        TEXT NOT NULL,
  role              TEXT NOT NULL,
  skills            TEXT NOT NULL,           -- JSON array of SkillId, snapshot at hire time
  hourly_rate_cents INTEGER,                 -- rate snapshot; NULL for unbilled staff
  source            TEXT NOT NULL CHECK (source IN ('staff', 'marketplace')),
  desk              TEXT NOT NULL,
  hired_at          INTEGER NOT NULL, listing_snapshot TEXT,
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
CREATE TABLE marketplace_listings (
    id TEXT PRIMARY KEY,
    creator_sub TEXT,
    creator_name TEXT NOT NULL,
    publisher_kind TEXT NOT NULL CHECK (publisher_kind IN ('company','community')),
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    avatar_id TEXT NOT NULL,
    skills TEXT NOT NULL,
    hourly_rate_cents INTEGER NOT NULL CHECK (hourly_rate_cents BETWEEN 0 AND 100000),
    permissions TEXT NOT NULL,
    action_id TEXT NOT NULL,
    action_config TEXT,
    created_at INTEGER NOT NULL,
    client_request_id TEXT NOT NULL,
    CHECK ((publisher_kind = 'company' AND creator_sub IS NULL) OR (publisher_kind = 'community' AND creator_sub IS NOT NULL)),
    UNIQUE (creator_sub, client_request_id)
  );
INSERT INTO marketplace_listings VALUES('catalog_assistant',NULL,'AI Workplace','company','Catalog Assistant','Find the right part in your internal records.','catalog_assistant','["catalog_search"]',400,'["Reads internal catalog records"]','catalog_search',NULL,1795269372546,'catalog_assistant');
INSERT INTO marketplace_listings VALUES('procurement_researcher',NULL,'AI Workplace','company','Procurement Researcher','Research replacement parts across public supplier websites.','procurement_researcher','["supplier_research"]',600,'["Browses approved public supplier sites via TinyFish","Cannot log in, add to cart or purchase"]','supplier_lookup',NULL,1795269372546,'procurement_researcher');
CREATE TABLE IF NOT EXISTS "reports" (
  id                TEXT PRIMARY KEY,
  workspace_id      TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  job_id            TEXT NOT NULL UNIQUE,
  hire_id           TEXT NOT NULL,
  mode              TEXT NOT NULL CHECK (mode IN ('live', 'sample', 'simulated', 'local')),
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
CREATE INDEX jobs_by_workspace ON jobs (workspace_id, created_at);
CREATE INDEX job_events_by_job ON job_events (job_id, id);
CREATE INDEX workspaces_by_owner ON workspaces (owner_sub, created_at);

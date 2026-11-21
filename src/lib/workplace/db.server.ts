// SQLite persistence for workspaces and their hires, jobs, job events, reports
// and simulator settings. Uses Node's built-in node:sqlite (no native addon).
// All SQL lives in this file and service.server.ts so a later move to Prisma stays contained.
//
// Schema versions (PRAGMA user_version):
//   1  single workspace: rows tagged workspace_id = 'demo', no workspaces table
//   2  workspaces table; every row belongs to a workspace via foreign keys.
//      Composite keys stop a job, report or assignment pointing at another
//      workspace's hire or job.
//   3  workspaces.owner_sub: the Auth0 user (sub) who owns the office.
//      NULL = unowned (data from before sign-in existed); hidden until claimed.
//   4  marketplace_listings: community agents published by users (global, not
//      per workspace). hires gain a snapshot of the listing's character name,
//      sprite, kind and publisher, so the hired character never changes.

import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

export type Db = DatabaseSync;

export const SCHEMA_VERSION = 4;
export const DEFAULT_WORKSPACE_ID = "default";
export const DEFAULT_WORKSPACE_NAME = "Default office";
/** workspace_id used by schema v1 for all rows. */
const LEGACY_WORKSPACE_ID = "demo";

const TABLES_V2 = `
CREATE TABLE workspaces (
  id         TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 64 AND id NOT GLOB '*[^a-z0-9-]*'),
  name       TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  created_at INTEGER NOT NULL
);

CREATE TABLE hires (
  id                TEXT PRIMARY KEY,
  workspace_id      TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  profile_id        TEXT NOT NULL,
  role              TEXT NOT NULL,
  skills            TEXT NOT NULL,           -- JSON array of SkillId, snapshot at hire time
  hourly_rate_cents INTEGER,                 -- rate snapshot; NULL for unbilled staff
  source            TEXT NOT NULL CHECK (source IN ('staff', 'marketplace')),
  desk              TEXT NOT NULL,
  hired_at          INTEGER NOT NULL,
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
CREATE INDEX jobs_by_workspace ON jobs (workspace_id, created_at);

CREATE TABLE job_events (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  at     INTEGER NOT NULL,
  actor  TEXT NOT NULL,
  text   TEXT NOT NULL
);
CREATE INDEX job_events_by_job ON job_events (job_id, id);

-- Simulator-side settings. Workers never read these directly; the simulated
-- station turns them into observations.
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
`;

function tableExists(db: Db, name: string): boolean {
  return db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !== undefined;
}

function userVersion(db: Db): number {
  return (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
}

/** v1 → v2: copy every table into the v2 shape; legacy 'demo' rows move to the default workspace. */
function migrateV1toV2(db: Db, now: number) {
  const ws = `CASE WHEN workspace_id = '${LEGACY_WORKSPACE_ID}' THEN '${DEFAULT_WORKSPACE_ID}' ELSE workspace_id END`;
  for (const t of ["hires", "jobs", "job_events", "reports"]) db.exec(`ALTER TABLE ${t} RENAME TO ${t}_v1`);
  const hadSettings = tableExists(db, "simulator_settings");
  if (hadSettings) db.exec("ALTER TABLE simulator_settings RENAME TO simulator_settings_v1");
  db.exec("DROP INDEX IF EXISTS jobs_by_workspace; DROP INDEX IF EXISTS job_events_by_job;");
  db.exec(TABLES_V2);

  db.prepare("INSERT INTO workspaces (id, name, created_at) VALUES (?, ?, ?)").run(DEFAULT_WORKSPACE_ID, DEFAULT_WORKSPACE_NAME, now);
  // Any other workspace ids found in v1 data become their own workspaces.
  const others = db
    .prepare(
      `SELECT DISTINCT ${ws} AS id FROM (SELECT workspace_id FROM hires_v1 UNION SELECT workspace_id FROM jobs_v1)
       WHERE ${ws} <> ?`,
    )
    .all(DEFAULT_WORKSPACE_ID) as { id: string }[];
  for (const { id } of others) {
    const slug = id.toLowerCase().replace(/[^a-z0-9-]+/g, "-").slice(0, 64) || "imported";
    if (slug !== id) throw new Error(`Cannot migrate workspace id "${id}": not a valid slug.`);
    db.prepare("INSERT INTO workspaces (id, name, created_at) VALUES (?, ?, ?)").run(id, id, now);
  }

  db.exec(`
    INSERT INTO hires SELECT id, ${ws}, profile_id, role, skills, hourly_rate_cents, source, desk, hired_at FROM hires_v1;
    INSERT INTO jobs SELECT id, ${ws}, client_request_id, type, title, input, required_skill, status, hire_id,
      recommended_profile_id, created_at, assigned_at, started_at, finished_at, error FROM jobs_v1;
    INSERT INTO job_events SELECT id, job_id, at, actor, text FROM job_events_v1;
    INSERT INTO reports SELECT r.id, CASE WHEN j.workspace_id = '${LEGACY_WORKSPACE_ID}' THEN '${DEFAULT_WORKSPACE_ID}' ELSE j.workspace_id END,
      r.job_id, r.hire_id, r.mode, r.outcome, r.summary, r.body, r.runtime_ms, r.hourly_rate_cents, r.demo_cost_cents, r.created_at
      FROM reports_v1 r JOIN jobs_v1 j ON j.id = r.job_id;
  `);
  if (hadSettings) db.exec(`INSERT INTO simulator_settings SELECT ${ws}, camera_fault FROM simulator_settings_v1;`);

  const counts = (t: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
  for (const t of ["hires", "jobs", "job_events", "reports"]) {
    if (counts(t) !== counts(`${t}_v1`)) throw new Error(`Migration lost rows in ${t}.`);
  }
  for (const t of ["hires", "jobs", "job_events", "reports"]) db.exec(`DROP TABLE ${t}_v1`);
  if (hadSettings) db.exec("DROP TABLE simulator_settings_v1");
}

/** v2 → v3: workspace ownership. Additive; existing offices stay unowned until claimed. */
function migrateV2toV3(db: Db) {
  db.exec(`
    ALTER TABLE workspaces ADD COLUMN owner_sub TEXT CHECK (owner_sub IS NULL OR length(owner_sub) BETWEEN 1 AND 255);
    CREATE INDEX workspaces_by_owner ON workspaces (owner_sub, created_at);
  `);
}

/** v3 → v4: community listings and the hire's character snapshot. Additive. */
function migrateV3toV4(db: Db) {
  db.exec(`
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
    CREATE INDEX listings_by_published ON marketplace_listings (published_at);
    ALTER TABLE hires ADD COLUMN character_name TEXT;
    ALTER TABLE hires ADD COLUMN sprite TEXT;   -- JSON SpriteSpec snapshot at hire time
    ALTER TABLE hires ADD COLUMN listing_kind TEXT CHECK (listing_kind IS NULL OR listing_kind IN ('official', 'community'));
    ALTER TABLE hires ADD COLUMN publisher_name TEXT;
    UPDATE hires SET listing_kind = 'official' WHERE source = 'marketplace';
  `);
  // Existing hires keep the cast character they already showed.
  const cast: Record<string, string> = { quality_inspector: "Inez", procurement_researcher: "Ro", catalog_assistant: "Kit" };
  for (const [profileId, name] of Object.entries(cast)) {
    db.prepare("UPDATE hires SET character_name = ?, sprite = ? WHERE profile_id = ?").run(name, JSON.stringify({ kind: "cast", id: profileId }), profileId);
  }
}

/** Bring any database up to SCHEMA_VERSION, one version at a time. Exported for tests. */
export function migrate(db: Db, file: string, now = Date.now()) {
  let version = userVersion(db);
  if (version > SCHEMA_VERSION) throw new Error(`Database schema v${version} is newer than this app (v${SCHEMA_VERSION}).`);
  if (version === SCHEMA_VERSION) return;

  const legacy = version === 0 && tableExists(db, "hires");
  const existing = legacy || version > 0;
  if (existing && file !== ":memory:") {
    // Keep a copy of the file before touching it.
    const backup = `${file}.v${legacy ? 1 : version}-backup-${now}`;
    db.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
  }

  // Foreign keys must be off while tables are rebuilt; checked again before commit.
  db.exec("PRAGMA foreign_keys = OFF");
  db.exec("BEGIN IMMEDIATE");
  try {
    if (version === 0) {
      if (legacy) migrateV1toV2(db, now);
      else db.exec(TABLES_V2);
      version = 2;
    }
    if (version === 2) {
      migrateV2toV3(db);
      version = 3;
    }
    if (version === 3) {
      migrateV3toV4(db);
      version = 4;
    }
    db.prepare("INSERT OR IGNORE INTO workspaces (id, name, created_at) VALUES (?, ?, ?)").run(
      DEFAULT_WORKSPACE_ID,
      DEFAULT_WORKSPACE_NAME,
      now,
    );
    const problems = db.prepare("PRAGMA foreign_key_check").all();
    if (problems.length) throw new Error(`Migration left ${problems.length} foreign key problems.`);
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }
}

export function openDb(file: string): Db {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  if (file !== ":memory:") db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA busy_timeout = 5000;");
  migrate(db, file);
  db.exec("PRAGMA foreign_keys = ON;");
  return db;
}

export function defaultDbPath(): string {
  return process.env.WORKPLACE_DB_PATH?.trim() || path.join(process.cwd(), "data", "workplace.db");
}

const globalForDb = globalThis as unknown as { __workplaceDb?: { file: string; db: Db } };

/** One connection per server process (survives dev hot reloads). */
export function getDb(): Db {
  const file = defaultDbPath();
  if (globalForDb.__workplaceDb?.file !== file) {
    globalForDb.__workplaceDb = { file, db: openDb(file) };
  }
  return globalForDb.__workplaceDb.db;
}

/** Run fn inside BEGIN IMMEDIATE … COMMIT; rolls back on throw. */
export function transaction<T>(db: Db, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

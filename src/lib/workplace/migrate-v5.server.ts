// Schema v4 → v5. Two different v4 schemas exist: the `marketplace` branch
// (custom sprites, hire columns) and Codex's `marketplace-publishing` branch
// (company/community listings, inventory action, hires.listing_snapshot).
// v5 is the union plus hire retention, instructions, departures and history.
// The variant is detected from the columns, so either kind of v4 file upgrades.

import type { DatabaseSync } from "node:sqlite";
import { characterId } from "./characters.ts";
import { OFFICIAL_LISTINGS, permissionsFor, snapshotOf, staffSnapshot, type HireSnapshot } from "./marketplace.ts";
import { castSprite, readSprite } from "./sprites.ts";
import type { SkillId } from "./catalog.ts";

type Db = DatabaseSync;

export const LISTINGS_V5 = `
CREATE TABLE marketplace_listings (
  id                TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 80),
  creator_sub       TEXT NOT NULL CHECK (length(creator_sub) BETWEEN 1 AND 255),
  client_request_id TEXT NOT NULL,
  creator_name      TEXT NOT NULL,
  character_name    TEXT NOT NULL,
  role              TEXT NOT NULL,
  description       TEXT NOT NULL,
  greeting          TEXT NOT NULL,
  sample_work       TEXT NOT NULL,
  skills            TEXT NOT NULL,            -- JSON SkillId[]
  hourly_rate_cents INTEGER NOT NULL CHECK (hourly_rate_cents BETWEEN 0 AND 100000),
  action_config     TEXT,                     -- JSON InventoryConfig when skills include inventory_audit
  sprite            TEXT NOT NULL,            -- JSON CustomSprite
  published_at      INTEGER NOT NULL,
  UNIQUE (creator_sub, client_request_id)
);
CREATE INDEX listings_by_published ON marketplace_listings (published_at);`;

const HIRES_V5 = `
CREATE TABLE hires_v5 (
  id                TEXT PRIMARY KEY,
  workspace_id      TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  profile_id        TEXT NOT NULL,
  role              TEXT NOT NULL,
  skills            TEXT NOT NULL,
  hourly_rate_cents INTEGER,
  source            TEXT NOT NULL CHECK (source IN ('staff', 'marketplace')),
  desk              TEXT NOT NULL,
  hired_at          INTEGER NOT NULL,
  snapshot          TEXT NOT NULL,            -- JSON HireSnapshot: the listing as hired, never rewritten
  retention         TEXT NOT NULL CHECK (retention IN ('team', 'job')),
  job_id            TEXT,                     -- the job a hire was brought in for
  instructions      TEXT NOT NULL DEFAULT '' CHECK (length(instructions) <= 1000),
  departed_at       INTEGER,                  -- set when a job-only or released worker leaves
  CHECK (retention = 'team' OR job_id IS NOT NULL OR departed_at IS NOT NULL),
  CHECK (source = 'marketplace' OR (retention = 'team' AND departed_at IS NULL)),
  UNIQUE (workspace_id, id)
);`;

export const HIRE_INDEXES_V5 = `
CREATE UNIQUE INDEX hires_active_desk ON hires (workspace_id, desk) WHERE departed_at IS NULL;
CREATE UNIQUE INDEX hires_active_retained ON hires (workspace_id, profile_id) WHERE departed_at IS NULL AND retention = 'team';
CREATE TABLE hire_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL,
  hire_id      TEXT NOT NULL,
  job_id       TEXT,
  at           INTEGER NOT NULL,
  kind         TEXT NOT NULL,
  text         TEXT NOT NULL,
  FOREIGN KEY (workspace_id, hire_id) REFERENCES hires (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX hire_events_by_hire ON hire_events (workspace_id, hire_id, id);`;

const columns = (db: Db, table: string) => (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
const json = <T,>(s: unknown, fallback: T): T => { try { return typeof s === "string" ? JSON.parse(s) as T : fallback; } catch { return fallback; } };

type Row = Record<string, unknown>;

function snapshotForOldHire(h: Row, listings: Map<string, HireSnapshot>, variant: "mine" | "codex"): HireSnapshot {
  const profileId = String(h.profile_id);
  const skills = json<SkillId[]>(h.skills, []);
  if (h.source === "staff") return staffSnapshot();
  const official = OFFICIAL_LISTINGS.find((l) => l.id === profileId);
  if (official) return snapshotOf(official);
  const known = listings.get(profileId);
  if (variant === "codex") {
    const old = json<Row | null>(h.listing_snapshot, null);
    const listing = (old?.listing ?? {}) as Row;
    const avatar = characterId(String(old?.avatarId ?? listing.avatarId ?? "catalog_assistant"));
    return {
      listingId: profileId, kind: "community", characterName: String(old?.role ?? h.role), role: String(h.role),
      specialty: String(old?.specialty ?? ""), greeting: known?.greeting ?? "Give me an inventory CSV. I’ll find the low stock.",
      sampleWork: String(old?.sampleWork ?? ""), skills, hourlyRateCents: (h.hourly_rate_cents as number | null) ?? 0,
      permissions: Array.isArray(old?.permissions) ? (old!.permissions as string[]) : permissionsFor(skills),
      sprite: castSprite(avatar), publisherName: String(listing.creatorName ?? known?.publisherName ?? "Community creator"),
      actionConfig: (listing.configuration as HireSnapshot["actionConfig"]) ?? known?.actionConfig ?? null,
    };
  }
  return {
    listingId: profileId, kind: "community", characterName: String(h.character_name ?? known?.characterName ?? h.role), role: String(h.role),
    specialty: known?.specialty ?? "", greeting: known?.greeting ?? "", sampleWork: known?.sampleWork ?? "", skills,
    hourlyRateCents: (h.hourly_rate_cents as number | null) ?? 0, permissions: permissionsFor(skills),
    sprite: readSprite(h.sprite as string | null, profileId), publisherName: String(h.publisher_name ?? known?.publisherName ?? "Community creator"),
    actionConfig: null,
  };
}

export function migrateV4toV5(db: Db) {
  const variant = columns(db, "marketplace_listings").includes("publisher_kind") ? "codex" : "mine";

  // 1. Listings: community rows only. Official listings are defined in code, never stored.
  const oldListings = db.prepare("SELECT * FROM marketplace_listings").all() as Row[];
  db.exec("ALTER TABLE marketplace_listings RENAME TO marketplace_listings_v4; DROP INDEX IF EXISTS listings_by_published;");
  db.exec(LISTINGS_V5);
  const insertListing = db.prepare(`INSERT INTO marketplace_listings (id, creator_sub, client_request_id, creator_name, character_name, role,
    description, greeting, sample_work, skills, hourly_rate_cents, action_config, sprite, published_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const listingSnapshots = new Map<string, HireSnapshot>();
  for (const l of oldListings) {
    if (variant === "codex" && l.publisher_kind !== "community") continue;
    const skills = json<SkillId[]>(l.skills, []);
    const row = variant === "codex"
      ? [l.id, l.creator_sub, l.client_request_id, l.creator_name, l.name, l.name, l.description,
        "Give me an inventory CSV. I’ll find the low stock and calculate the restock.", "Runs an inventory audit on the CSV you submit.",
        l.skills, l.hourly_rate_cents, l.action_config ?? null, JSON.stringify(castSprite(characterId(String(l.avatar_id)))), l.created_at]
      : [l.id, l.owner_sub, l.client_request_id, l.publisher_name, l.character_name, l.role, l.specialty, l.greeting, l.sample_work,
        l.skills, l.hourly_rate_cents, null, l.sprite, l.published_at];
    insertListing.run(...(row as (string | number | null)[]));
    listingSnapshots.set(String(l.id), {
      listingId: String(l.id), kind: "community", characterName: String(row[4]), role: String(row[5]), specialty: String(row[6]),
      greeting: String(row[7]), sampleWork: String(row[8]), skills, hourlyRateCents: Number(row[10]), permissions: permissionsFor(skills),
      sprite: readSprite(String(row[12]), String(l.id)), publisherName: String(row[3]), actionConfig: json(row[11], null),
    });
  }
  db.exec("DROP TABLE marketplace_listings_v4");

  // 2. Hires: rebuilt for retention, departures and a single JSON snapshot.
  const oldHires = db.prepare("SELECT * FROM hires").all() as Row[];
  db.exec(HIRES_V5);
  const insertHire = db.prepare(`INSERT INTO hires_v5 (id, workspace_id, profile_id, role, skills, hourly_rate_cents, source, desk, hired_at,
    snapshot, retention, job_id, instructions, departed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'team', NULL, '', NULL)`);
  for (const h of oldHires) {
    insertHire.run(h.id as string, h.workspace_id as string, h.profile_id as string, h.role as string, h.skills as string,
      (h.hourly_rate_cents as number | null) ?? null, h.source as string, h.desk as string, h.hired_at as number,
      JSON.stringify(snapshotForOldHire(h, listingSnapshots, variant)));
  }
  db.exec("DROP TABLE hires; ALTER TABLE hires_v5 RENAME TO hires;");
  db.exec(HIRE_INDEXES_V5);
  const joined = db.prepare("INSERT INTO hire_events (workspace_id, hire_id, at, kind, text) VALUES (?, ?, ?, 'hired', ?)");
  for (const h of oldHires) joined.run(h.workspace_id as string, h.id as string, h.hired_at as number, h.source === "staff" ? "Built-in staff at Workstation 01." : "Joined the team (kept on team).");

  // 3. Reports gain the "local" mode (inventory audits) if this v4 did not have it.
  const reportsSql = (db.prepare("SELECT sql FROM sqlite_master WHERE name = 'reports'").get() as { sql: string }).sql;
  if (!reportsSql.includes("'local'")) {
    db.exec(reportsSql.replace(/CREATE TABLE "?reports"? \(/, "CREATE TABLE reports_v5 (").replace("('live', 'sample', 'simulated')", "('live', 'sample', 'simulated', 'local')"));
    db.exec("INSERT INTO reports_v5 SELECT * FROM reports; DROP TABLE reports; ALTER TABLE reports_v5 RENAME TO reports;");
  }
}

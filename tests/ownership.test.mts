import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DEFAULT_WORKSPACE_ID, SCHEMA_VERSION, openDb, type Db } from "../src/lib/workplace/db.server.ts";
import {
  claimUnownedWorkspaces,
  createWorkspace,
  ensurePersonalWorkspace,
  getOwnedWorkspace,
  getState,
  listWorkspaces,
  primaryWorkspaceId,
  submitRequest,
  type ServiceDeps,
  type Viewer,
} from "../src/lib/workplace/service.server.ts";

const realFetch = globalThis.fetch;
globalThis.fetch = (() => {
  throw new Error("Network call attempted during tests");
}) as typeof fetch;
after(() => {
  globalThis.fetch = realFetch;
});

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ownership-test-"));
const V1_SCHEMA = fs.readFileSync(new URL("./fixtures/schema-v1.sql", import.meta.url), "utf8");
let db: Db;
let seq = 0;
const deps: ServiceDeps = {
  now: () => Date.UTC(2026, 10, 21, 18) + seq,
  newId: (p) => `${p}_${(++seq).toString(36).padStart(6, "0")}`,
  lookup: async () => ({ ok: false, error: { code: "PROVIDER_ERROR", message: "unused" } }),
};

const alice: Viewer = { sub: "auth0|alice", name: "Alice Example", email: "alice@example.com", emailVerified: true };
const bob: Viewer = { sub: "auth0|bob", name: "Bob Example", email: "bob@example.com", emailVerified: true };

beforeEach(() => {
  db = openDb(path.join(tmp, `o-${Date.now()}-${Math.random()}.db`));
});

test("first sign-in creates one personal office per user; repeat calls reuse it", () => {
  const a1 = ensurePersonalWorkspace(db, deps, alice);
  const a2 = ensurePersonalWorkspace(db, deps, alice);
  const b1 = ensurePersonalWorkspace(db, deps, bob);
  assert.equal(a1, a2);
  assert.notEqual(a1, b1);
  assert.deepEqual(listWorkspaces(db, alice.sub).map((w) => w.name), ["Alice’s office"]);
  assert.deepEqual(listWorkspaces(db, bob.sub).map((w) => w.name), ["Bob’s office"]);
  assert.deepEqual(getState(db, a1, "sample", 0)!.team.map((h) => h.role), ["Quality Inspector"]);
});

test("workspace list is scoped to the owner", () => {
  ensurePersonalWorkspace(db, deps, alice);
  ensurePersonalWorkspace(db, deps, bob);
  const r = createWorkspace(db, deps, { name: "Alice Warehouse", ownerSub: alice.sub });
  assert.ok(r.ok);
  assert.deepEqual(listWorkspaces(db, alice.sub).map((w) => w.name).sort(), ["Alice Warehouse", "Alice’s office"]);
  assert.deepEqual(listWorkspaces(db, bob.sub).map((w) => w.name), ["Bob’s office"]);
  assert.ok(!listWorkspaces(db, bob.sub).some((w) => w.id === DEFAULT_WORKSPACE_ID), "unowned demo office hidden");
});

test("getOwnedWorkspace only answers for the owner", () => {
  const a = ensurePersonalWorkspace(db, deps, alice);
  assert.ok(getOwnedWorkspace(db, a, alice.sub));
  assert.equal(getOwnedWorkspace(db, a, bob.sub), undefined);
  assert.equal(getOwnedWorkspace(db, DEFAULT_WORKSPACE_ID, alice.sub), undefined, "unowned is nobody's");
  assert.equal(getOwnedWorkspace(db, "no-such", alice.sub), undefined);
});

test("unowned demo offices go only to the configured verified email", () => {
  assert.equal(claimUnownedWorkspaces(db, bob, "alice@example.com"), 0, "wrong user");
  assert.equal(claimUnownedWorkspaces(db, { ...alice, emailVerified: false }, "alice@example.com"), 0, "unverified email");
  assert.equal(claimUnownedWorkspaces(db, alice, undefined), 0, "not configured");
  assert.equal(claimUnownedWorkspaces(db, alice, " ALICE@example.com "), 1);
  assert.equal(getOwnedWorkspace(db, DEFAULT_WORKSPACE_ID, alice.sub)?.id, DEFAULT_WORKSPACE_ID);
  assert.equal(claimUnownedWorkspaces(db, alice, "alice@example.com"), 0, "already claimed");
  assert.equal(primaryWorkspaceId(db, alice.sub), DEFAULT_WORKSPACE_ID, "demo office becomes the primary");
});

test("a claimed office is never re-assigned to another user", () => {
  claimUnownedWorkspaces(db, alice, "alice@example.com");
  const impostor: Viewer = { sub: "google-oauth2|eve", email: "alice@example.com", emailVerified: true };
  assert.equal(claimUnownedWorkspaces(db, impostor, "alice@example.com"), 0);
  assert.equal(getOwnedWorkspace(db, DEFAULT_WORKSPACE_ID, alice.sub)?.id, DEFAULT_WORKSPACE_ID);
});

test("primary office: oldest owned office when the user has no demo office", () => {
  const first = ensurePersonalWorkspace(db, deps, bob);
  createWorkspace(db, deps, { name: "Second", ownerSub: bob.sub });
  assert.equal(primaryWorkspaceId(db, bob.sub), first);
  assert.equal(primaryWorkspaceId(db, "auth0|nobody"), undefined);
});

test("jobs submitted to the owned office stay there", () => {
  const a = ensurePersonalWorkspace(db, deps, alice);
  const b = ensurePersonalWorkspace(db, deps, bob);
  const r = submitRequest(db, deps, a, { clientRequestId: "req-own-12345", request: "Find a Raspberry Pi 5 4GB on Adafruit" });
  assert.ok(r.ok && r.kind === "job");
  assert.equal(getState(db, a, "sample", 0)!.jobs.length, 1);
  assert.equal(getState(db, b, "sample", 0)!.jobs.length, 0);
});

// --- migration from older versions to the current one --------------------------

const fixture = (name: string) => fs.readFileSync(new URL(`./fixtures/schema-${name}.sql`, import.meta.url), "utf8");

test("fresh database is the current schema with an unowned default office", () => {
  assert.equal(SCHEMA_VERSION, 6);
  assert.equal((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version, SCHEMA_VERSION);
  assert.equal((db.prepare("SELECT owner_sub FROM workspaces WHERE id = 'default'").get() as { owner_sub: string | null }).owner_sub, null);
});

test("a v1 database is upgraded in one go and keeps its jobs", () => {
  const file = path.join(tmp, `v1-${Math.random()}.db`);
  const v1 = new DatabaseSync(file);
  v1.exec(V1_SCHEMA);
  v1.exec(`INSERT INTO hires VALUES ('staff_quality_inspector','demo','quality_inspector','Quality Inspector','["camera_diagnostics"]',NULL,'staff','workstation-01',1);
           INSERT INTO jobs VALUES ('job_a','demo','req-aaaaaaaa','camera_incident','t','{"station":"Packing Station 1"}','camera_diagnostics','completed','staff_quality_inspector',NULL,1,1,1,2,NULL);`);
  v1.close();
  db = openDb(file); // v1 -> v2 -> v3 -> v4 -> v5
  assert.equal((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version, SCHEMA_VERSION);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE workspace_id = 'default'").get() as { n: number }).n, 1);
  assert.equal(fs.readdirSync(tmp).filter((f) => f.startsWith(path.basename(file) + ".v1-backup-")).length, 1);
});

test("a real v2 database keeps all its data, gains an owner, and is backed up", () => {
  const file = path.join(tmp, `v2-${Math.random()}.db`);
  const raw = new DatabaseSync(file);
  raw.exec(fixture("v2")); // schema and seed written by the v2 release (commit 51c3ceb)
  raw.exec(`INSERT INTO hires VALUES ('staff_quality_inspector','default','quality_inspector','Quality Inspector','["camera_diagnostics"]',NULL,'staff','workstation-01',1);
            INSERT INTO jobs VALUES ('job_a','default','req-aaaaaaaa','camera_incident','t','{"station":"Packing Station 1"}','camera_diagnostics','completed','staff_quality_inspector',NULL,1,1,1,2,NULL);
            PRAGMA user_version = 2;`);
  raw.close();
  db = openDb(file);
  assert.equal((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version, SCHEMA_VERSION);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM jobs").get() as { n: number }).n, 1);
  assert.equal(getOwnedWorkspace(db, DEFAULT_WORKSPACE_ID, alice.sub), undefined, "still unowned after migration");
  assert.equal(fs.readdirSync(tmp).filter((f) => f.startsWith(path.basename(file) + ".v2-backup-")).length, 1);
  claimUnownedWorkspaces(db, alice, "alice@example.com");
  assert.equal(getState(db, DEFAULT_WORKSPACE_ID, "sample", 0)!.jobs.length, 1, "demo data kept and usable by its owner");
});

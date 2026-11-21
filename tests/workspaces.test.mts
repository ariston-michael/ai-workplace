import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DEFAULT_WORKSPACE_ID, SCHEMA_VERSION, openDb, type Db } from "../src/lib/workplace/db.server.ts";
import {
  approveHire,
  createWorkspace,
  getState,
  listWorkspaces,
  resetWorkspace,
  runJob,
  setCameraFault,
  submitJob,
  submitRequest,
  type ServiceDeps,
} from "../src/lib/workplace/service.server.ts";
import { lookupPart } from "../src/lib/procurement-provider.server.ts";

const realFetch = globalThis.fetch;
globalThis.fetch = (() => {
  throw new Error("Network call attempted during tests");
}) as typeof fetch;
process.env.PROCUREMENT_FIXTURE_DELAY_MS = "0";
after(() => {
  globalThis.fetch = realFetch;
});

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "workspaces-test-"));
const V1_SCHEMA = fs.readFileSync(new URL("./fixtures/schema-v1.sql", import.meta.url), "utf8");
let db: Db;
let file: string;
let clock: number;
let seq: number;
const deps: ServiceDeps = {
  now: () => clock,
  newId: (prefix) => `${prefix}_${(++seq).toString(36).padStart(6, "0")}`,
  lookup: (partName, supplier) => lookupPart(partName, supplier, "sample"),
};
let n = 0;
const rid = () => `req-${++n}-abcdefgh`;
const state = (ws: string) => getState(db, ws, "sample", clock)!;
const count = (sql: string, ...args: (string | number)[]) => (db.prepare(sql).get(...args) as { n: number }).n;

beforeEach(() => {
  file = path.join(tmp, `ws-${Date.now()}-${Math.random()}.db`);
  db = openDb(file);
  clock = Date.UTC(2026, 10, 21, 15);
  seq = 0;
});

function office(name: string) {
  const r = createWorkspace(db, deps, { name });
  assert.ok(r.ok, JSON.stringify(r));
  return r.workspace.id;
}

async function hireProcurementVia(ws: string, part = "Raspberry Pi 5 4GB") {
  const j = submitRequest(db, deps, ws, { clientRequestId: rid(), request: `Find a ${part} on Adafruit` });
  assert.ok(j.ok && j.kind === "job", JSON.stringify(j));
  const h = approveHire(db, deps, ws, { profileId: "procurement_researcher", jobId: j.jobId, retention: "team" });
  assert.ok(h.ok);
  for (const id of h.runJobIds) await runJob(db, deps, id);
  return { jobId: j.jobId, hireId: h.hireId };
}

/** Snapshot every row that belongs to a workspace, for "untouched" comparisons. */
function snapshot(ws: string) {
  const rows = (sql: string) => db.prepare(sql).all(ws);
  return JSON.stringify({
    workspace: rows("SELECT * FROM workspaces WHERE id = ?"),
    hires: rows("SELECT * FROM hires WHERE workspace_id = ? ORDER BY id"),
    jobs: rows("SELECT * FROM jobs WHERE workspace_id = ? ORDER BY id"),
    events: rows("SELECT e.* FROM job_events e JOIN jobs j ON j.id = e.job_id WHERE j.workspace_id = ? ORDER BY e.id"),
    reports: rows("SELECT * FROM reports WHERE workspace_id = ? ORDER BY id"),
    simulator: rows("SELECT * FROM simulator_settings WHERE workspace_id = ?"),
  });
}

// --- fresh database ---------------------------------------------------------

test("a fresh database is schema v2 with the default workspace", () => {
  assert.equal((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version, SCHEMA_VERSION);
  assert.deepEqual(listWorkspaces(db).map((w) => [w.id, w.name]), [[DEFAULT_WORKSPACE_ID, "Default office"]]);
  assert.deepEqual(state(DEFAULT_WORKSPACE_ID).team.map((h) => h.role), ["Quality Inspector"]);
});

// --- migration ----------------------------------------------------------------

function buildV1(target: string) {
  const v1 = new DatabaseSync(target);
  v1.exec(V1_SCHEMA);
  const t = Date.UTC(2026, 10, 21, 10);
  v1.exec(`
    INSERT INTO hires VALUES ('staff_quality_inspector','demo','quality_inspector','Quality Inspector','["camera_diagnostics","visual_inspection"]',NULL,'staff','workstation-01',${t});
    INSERT INTO hires VALUES ('hire_old','demo','procurement_researcher','Procurement Researcher','["supplier_research"]',600,'marketplace','desk-02',${t + 1});
    INSERT INTO jobs VALUES ('job_old1','demo','req-old-1','supplier_lookup','Find “Pi” on Adafruit','{"partName":"Pi 5","supplierId":"adafruit","supplierName":"Adafruit"}','supplier_research','completed','hire_old',NULL,${t},${t},${t},${t + 5},NULL);
    INSERT INTO jobs VALUES ('job_old2','demo','req-old-2','supplier_lookup','Find “X” on SparkFun','{"partName":"X1","supplierId":"sparkfun","supplierName":"SparkFun Electronics"}','supplier_research','needs_worker',NULL,'procurement_researcher',${t + 9},NULL,NULL,NULL,NULL);
    INSERT INTO job_events (job_id, at, actor, text) VALUES ('job_old1', ${t}, 'You', 'Submitted'), ('job_old1', ${t + 5}, 'Procurement Researcher', 'Returned'), ('job_old2', ${t + 9}, 'You', 'Submitted');
    INSERT INTO reports VALUES ('rpt_old','job_old1','hire_old','sample','found','Pi 5: In stock','{"type":"supplier_lookup"}',5000,600,1,${t + 5});
    INSERT INTO simulator_settings VALUES ('demo','camera-missing');
  `);
  v1.close();
}

test("v1 data migrates into the default workspace with a backup", () => {
  const legacy = path.join(tmp, `legacy-${Math.random()}.db`);
  buildV1(legacy);
  const migrated = openDb(legacy);
  db = migrated;

  assert.equal((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version, SCHEMA_VERSION);
  assert.deepEqual(listWorkspaces(db).map((w) => w.id), [DEFAULT_WORKSPACE_ID]);
  assert.equal(count("SELECT COUNT(*) AS n FROM hires WHERE workspace_id = 'default'"), 2);
  assert.equal(count("SELECT COUNT(*) AS n FROM jobs WHERE workspace_id = 'default'"), 2);
  assert.equal(count("SELECT COUNT(*) AS n FROM job_events"), 3);
  assert.equal(count("SELECT COUNT(*) AS n FROM reports WHERE workspace_id = 'default'"), 1);
  assert.equal(count("SELECT COUNT(*) AS n FROM jobs WHERE workspace_id = 'demo'"), 0);

  const s = state(DEFAULT_WORKSPACE_ID);
  assert.equal(s.simulator.cameraFault, "camera-missing");
  assert.ok(s.team.some((h) => h.id === "hire_old" && h.desk === "desk-02" && h.completedJobs === 1));
  assert.equal(s.jobs.find((j) => j.id === "job_old1")?.report?.summary, "Pi 5: In stock");
  assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);

  const backups = fs.readdirSync(path.dirname(legacy)).filter((f) => f.startsWith(path.basename(legacy) + ".v1-backup-"));
  assert.equal(backups.length, 1, "v1 file backed up before migrating");
  const backup = new DatabaseSync(path.join(path.dirname(legacy), backups[0]));
  assert.equal((backup.prepare("SELECT COUNT(*) AS n FROM jobs WHERE workspace_id = 'demo'").get() as { n: number }).n, 2);
  backup.close();
});

test("migrated data keeps working: old hire is reused and the waiting job can resume", async () => {
  const legacy = path.join(tmp, `legacy-${Math.random()}.db`);
  buildV1(legacy);
  db = openDb(legacy);
  const j = submitRequest(db, deps, DEFAULT_WORKSPACE_ID, { clientRequestId: rid(), request: "Find a Qwiic cable on SparkFun" });
  assert.ok(j.ok && j.kind === "job");
  assert.deepEqual(j.runJobIds, [j.jobId]);
  assert.equal(state(DEFAULT_WORKSPACE_ID).jobs.find((x) => x.id === j.jobId)?.hireId, "hire_old");
  await runJob(db, deps, j.jobId);
  assert.equal(state(DEFAULT_WORKSPACE_ID).jobs.find((x) => x.id === j.jobId)?.status, "completed");
});

test("reopening a migrated database does not migrate twice", () => {
  const legacy = path.join(tmp, `legacy-${Math.random()}.db`);
  buildV1(legacy);
  openDb(legacy).close();
  db = openDb(legacy);
  assert.equal(count("SELECT COUNT(*) AS n FROM jobs"), 2);
  const backups = fs.readdirSync(path.dirname(legacy)).filter((f) => f.startsWith(path.basename(legacy) + ".v1-backup-"));
  assert.equal(backups.length, 1);
});

test("an empty v1 database migrates cleanly", () => {
  const legacy = path.join(tmp, `legacy-empty-${Math.random()}.db`);
  const v1 = new DatabaseSync(legacy);
  v1.exec(V1_SCHEMA);
  v1.close();
  db = openDb(legacy);
  assert.deepEqual(state(DEFAULT_WORKSPACE_ID).team.map((h) => h.role), ["Quality Inspector"]);
});

// --- creating offices ---------------------------------------------------------

test("create office: validates the name, makes a unique slug, seeds staff", () => {
  assert.equal(createWorkspace(db, deps, { name: "" }).ok, false);
  assert.equal(createWorkspace(db, deps, { name: "x".repeat(61) }).ok, false);
  const a = office("Toronto Plant");
  const b = office("Toronto Plant");
  assert.equal(a, "toronto-plant");
  assert.match(b, /^toronto-plant-[a-z0-9]+$/);
  assert.notEqual(a, b);
  assert.equal(office("!!!").startsWith("office"), true);
  assert.deepEqual(state(a).team.map((h) => h.role), ["Quality Inspector"]);
  assert.notEqual(state(a).team[0].id, state(b).team[0].id, "staff hire ids are unique per office");
  assert.equal(listWorkspaces(db).find((w) => w.id === a)?.teamSize, 1);
});

// --- isolation ------------------------------------------------------------------

test("hiring a worker in one office leaves the other office untouched", async () => {
  const north = office("North");
  const south = office("South");
  setCameraFault(db, south, "camera-missing");
  const southBefore = snapshot(south);
  const defaultBefore = snapshot(DEFAULT_WORKSPACE_ID);

  const { hireId } = await hireProcurementVia(north);

  assert.equal(snapshot(south), southBefore);
  assert.equal(snapshot(DEFAULT_WORKSPACE_ID), defaultBefore);
  assert.ok(state(north).team.some((h) => h.id === hireId));
  assert.ok(!state(south).team.some((h) => h.profileId === "procurement_researcher"));

  // South still lacks the skill: its own job waits for its own hire.
  const s = submitRequest(db, deps, south, { clientRequestId: rid(), request: "Find a Raspberry Pi 5 4GB on Adafruit" });
  assert.ok(s.ok && s.kind === "job");
  const sj = state(south).jobs.find((j) => j.id === s.jobId)!;
  assert.equal(sj.status, "needs_worker");
  assert.equal(sj.recommendedProfileId, "procurement_researcher");

  const sh = approveHire(db, deps, south, { profileId: "procurement_researcher", jobId: s.jobId, retention: "team" });
  assert.ok(sh.ok && sh.created);
  assert.notEqual(sh.hireId, hireId, "each office gets its own hire");
  assert.equal(state(south).team.find((h) => h.id === sh.hireId)?.desk, "desk-02", "desks are per office");
});

test("resetting one office leaves the other office untouched", async () => {
  const north = office("North");
  const south = office("South");
  await hireProcurementVia(north);
  await hireProcurementVia(south, "Qwiic cable");
  setCameraFault(db, north, "service-stopped-no-frame");
  setCameraFault(db, south, "camera-missing");
  const cam = submitRequest(db, deps, south, { clientRequestId: rid(), request: "The camera feed stopped" });
  assert.ok(cam.ok && cam.kind === "job");
  await runJob(db, deps, cam.jobId);

  const southBefore = snapshot(south);
  const defaultBefore = snapshot(DEFAULT_WORKSPACE_ID);
  const r = resetWorkspace(db, north, clock);
  assert.ok(r.ok);

  assert.equal(snapshot(south), southBefore, "South: hires, jobs, events, reports, simulator unchanged");
  assert.equal(snapshot(DEFAULT_WORKSPACE_ID), defaultBefore);
  const n2 = state(north);
  assert.deepEqual(n2.team.map((h) => h.role), ["Quality Inspector"]);
  assert.equal(n2.jobs.length, 0);
  assert.equal(n2.simulator.cameraFault, "service-stopped-recovers");
  assert.equal(count("SELECT COUNT(*) AS n FROM reports WHERE workspace_id = ?", north), 0);
  assert.equal(count("SELECT COUNT(*) AS n FROM reports WHERE workspace_id = ?", south), 2);
});

test("simulator settings are per office", () => {
  const a = office("A office");
  const b = office("B office");
  assert.ok(setCameraFault(db, a, "camera-missing").ok);
  assert.equal(state(a).simulator.cameraFault, "camera-missing");
  assert.equal(state(b).simulator.cameraFault, "service-stopped-recovers");
});

test("camera jobs read their own office's simulator fault", async () => {
  const a = office("A office");
  const b = office("B office");
  setCameraFault(db, a, "service-stopped-no-frame");
  setCameraFault(db, b, "service-stopped-recovers");
  const ja = submitRequest(db, deps, a, { clientRequestId: rid(), request: "camera is down" });
  const jb = submitRequest(db, deps, b, { clientRequestId: rid(), request: "camera is down" });
  assert.ok(ja.ok && ja.kind === "job" && jb.ok && jb.kind === "job");
  await runJob(db, deps, ja.jobId);
  await runJob(db, deps, jb.jobId);
  assert.equal(state(a).jobs[0].report?.outcome, "incident_open");
  assert.equal(state(b).jobs[0].report?.outcome, "resolved");
});

test("a job from one office cannot be approved from another", () => {
  const a = office("A office");
  const b = office("B office");
  const j = submitRequest(db, deps, a, { clientRequestId: rid(), request: "Find a Raspberry Pi 5 4GB on Adafruit" });
  assert.ok(j.ok && j.kind === "job");
  const r = approveHire(db, deps, b, { profileId: "procurement_researcher", jobId: j.jobId, retention: "team" });
  assert.equal(!r.ok && r.error.code, "JOB_NOT_FOUND");
  assert.equal(state(b).team.length, 1, "no hire created in B");
  assert.equal(state(a).jobs[0].status, "needs_worker", "A's job untouched");
});

test("the same clientRequestId in two offices creates two separate jobs", () => {
  const a = office("A office");
  const b = office("B office");
  const ra = submitRequest(db, deps, a, { clientRequestId: "shared-request-1", request: "camera is down" });
  const rb = submitRequest(db, deps, b, { clientRequestId: "shared-request-1", request: "camera is down" });
  assert.ok(ra.ok && ra.kind === "job" && rb.ok && rb.kind === "job");
  assert.notEqual(ra.jobId, rb.jobId);
});

test("a job only resumes for a hire in its own office", async () => {
  const a = office("A office");
  const b = office("B office");
  const ja = submitRequest(db, deps, a, { clientRequestId: rid(), request: "Find a Raspberry Pi 5 4GB on Adafruit" });
  assert.ok(ja.ok && ja.kind === "job");
  const hb = approveHire(db, deps, b, { profileId: "procurement_researcher" });
  assert.ok(hb.ok);
  assert.deepEqual(hb.runJobIds, [], "B's hire does not pick up A's waiting job");
  assert.equal(state(a).jobs[0].status, "needs_worker");
});

test("unknown offices are rejected everywhere", async () => {
  const ghost = "no-such-office";
  assert.equal(getState(db, ghost, "sample", clock), null);
  const results = [
    submitRequest(db, deps, ghost, { clientRequestId: rid(), request: "camera is down" }),
    submitJob(db, deps, ghost, { clientRequestId: rid(), type: "camera_incident", input: {} }),
    approveHire(db, deps, ghost, { profileId: "procurement_researcher" }),
    setCameraFault(db, ghost, "camera-missing"),
    resetWorkspace(db, ghost, clock),
  ];
  for (const r of results) assert.equal(!r.ok && r.error.code, "WORKSPACE_NOT_FOUND", JSON.stringify(r));
  assert.equal(getState(db, "../etc", "sample", clock), null);
  assert.equal(count("SELECT COUNT(*) AS n FROM workspaces"), 1);
});

// --- database-level guards ----------------------------------------------------

test("the database rejects cross-office references", async () => {
  const a = office("A office");
  const b = office("B office");
  const { jobId, hireId } = await hireProcurementVia(a);
  assert.throws(
    () =>
      db.prepare(
        "INSERT INTO jobs (id, workspace_id, client_request_id, type, title, input, required_skill, status, hire_id, created_at) VALUES ('x', ?, 'req-x-123456', 'supplier_lookup', 't', '{}', 'supplier_research', 'queued', ?, 0)",
      ).run(b, hireId),
    /FOREIGN KEY/,
    "a job cannot be assigned to another office's hire",
  );
  assert.throws(
    () =>
      db.prepare(
        "INSERT INTO reports (id, workspace_id, job_id, hire_id, mode, outcome, summary, body, runtime_ms, created_at) VALUES ('r', ?, ?, ?, 'sample', 'found', 's', '{}', 0, 0)",
      ).run(b, jobId, hireId),
    /FOREIGN KEY|UNIQUE/,
    "a report cannot be filed under another office",
  );
  assert.throws(
    () => db.prepare("INSERT INTO hires (id, workspace_id, profile_id, role, skills, source, desk, hired_at, snapshot, retention) VALUES ('h', 'nowhere', 'p', 'r', '[]', 'staff', 'd', 0, '{}', 'team')").run(),
    /FOREIGN KEY/,
  );
});

test("office data survives reopening the file", async () => {
  const a = office("Persisted office");
  await hireProcurementVia(a);
  db.close();
  db = openDb(file);
  assert.ok(listWorkspaces(db).some((w) => w.id === a && w.name === "Persisted office" && w.teamSize === 2 && w.totalJobs === 1));
});

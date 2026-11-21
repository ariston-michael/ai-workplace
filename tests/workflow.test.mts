import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openDb, DEFAULT_WORKSPACE_ID } from "../src/lib/workplace/db.server.ts";
import { readSavedJobs } from "../src/lib/workflow/read-jobs.server.ts";
import { submitJob, approveHire, runJob, getState, setCameraFault, createWorkspace, type ServiceDeps } from "../src/lib/workplace/service.server.ts";
import { lookupPart } from "../src/lib/procurement-provider.server.ts";

process.env.PROCUREMENT_FIXTURE_DELAY_MS = "0";

function setup() {
  const dir = mkdtempSync(path.join(tmpdir(), "workflow-read-test-"));
  const file = path.join(dir, "saved.db");
  const db = openDb(file);
  let sequence = 0;
  const deps: ServiceDeps = {
    now: () => Date.UTC(2026, 10, 21, 12), newId: prefix => `${prefix}_${++sequence}`,
    lookup: (part, supplier) => lookupPart(part, supplier, "sample"),
  };
  return { db, file, deps, close: () => { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test("workflow read does not create an absent database or seed an empty one", () => {
  const fixture = setup();
  try {
    const absent = path.join(path.dirname(fixture.file), "missing.db");
    assert.deepEqual(readSavedJobs(absent), []);
    assert.equal(existsSync(absent), false);
    assert.deepEqual(readSavedJobs(fixture.file), []);
    assert.equal(fixture.db.prepare("SELECT COUNT(*) AS n FROM hires").get()?.n, 0);
  } finally { fixture.close(); }
});

test("workflow returns saved routing and fixture reports without recomputing them", async () => {
  const fixture = setup();
  const { db, deps, file } = fixture;
  try {
    const request = submitJob(db, deps, DEFAULT_WORKSPACE_ID, { clientRequestId: "workflow-part-request", type: "supplier_lookup", input: { partName: "Raspberry Pi 5 4GB", supplierId: "adafruit" } });
    assert.ok(request.ok);
    const waiting = readSavedJobs(file)[0];
    assert.equal(waiting.status, "needs_worker");
    assert.equal(waiting.report, null);
    assert.match(waiting.events.filter(event => event.actor === "Dispatcher").map(event => event.text).join(" "), /Recommending Procurement Researcher/);
    const hire = approveHire(db, deps, DEFAULT_WORKSPACE_ID, { profileId: "procurement_researcher", jobId: request.jobId });
    assert.ok(hire.ok);
    await runJob(db, deps, request.jobId);
    assert.deepEqual(readSavedJobs(file), getState(db, DEFAULT_WORKSPACE_ID, "sample", deps.now())!.jobs);
    assert.equal(readSavedJobs(file)[0].report?.mode, "sample");
  } finally { fixture.close(); }
});

test("workflow preserves report completion separately from the unresolved camera incident", async () => {
  const fixture = setup();
  const { db, deps, file } = fixture;
  try {
    setCameraFault(db, DEFAULT_WORKSPACE_ID, "service-stopped-no-frame");
    const request = submitJob(db, deps, DEFAULT_WORKSPACE_ID, { clientRequestId: "workflow-camera-open", type: "camera_incident", input: { scenarioId: "service-stopped-no-frame" } });
    assert.ok(request.ok);
    await runJob(db, deps, request.jobId);
    const job = readSavedJobs(file)[0];
    assert.equal(job.status, "completed");
    assert.equal(job.report?.mode, "simulated");
    assert.equal(job.report?.outcome, "incident_open");
    assert.equal(job.report?.body.type, "camera_incident");
    if (job.report?.body.type === "camera_incident") {
      assert.equal(job.report.body.incident.status, "open");
      assert.equal(job.report.body.incident.resolvedAt, null);
    }
  } finally { fixture.close(); }
});

test("workflow cannot recover or run queued/stale jobs, and does not read other workspaces", () => {
  const fixture = setup();
  const { db, deps, file } = fixture;
  try {
    assert.ok(createWorkspace(db, deps, { name: "another-workspace" }).ok);
    for (const ws of [DEFAULT_WORKSPACE_ID, "another-workspace"]) {
      const request = submitJob(db, deps, ws, { clientRequestId: `workflow-${ws}-camera`, type: "camera_incident", input: { scenarioId: "camera-missing" } });
      assert.ok(request.ok);
    }
    const before = db.prepare("SELECT * FROM jobs ORDER BY id").all();
    const events = db.prepare("SELECT * FROM job_events ORDER BY id").all();
    const jobs = readSavedJobs(file);
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].status, "queued");
    assert.equal(jobs[0].report, null);
    assert.deepEqual(db.prepare("SELECT * FROM jobs ORDER BY id").all(), before);
    assert.deepEqual(db.prepare("SELECT * FROM job_events ORDER BY id").all(), events);
    db.prepare("UPDATE jobs SET status = 'working', started_at = 0 WHERE workspace_id = 'default'").run();
    assert.equal(readSavedJobs(file)[0].status, "working");
    assert.equal(db.prepare("SELECT status FROM jobs WHERE workspace_id = 'default'").get()?.status, "working");
  } finally { fixture.close(); }
});

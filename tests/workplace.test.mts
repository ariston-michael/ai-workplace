import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_WORKSPACE_ID, openDb, type Db } from "../src/lib/workplace/db.server.ts";
import {
  approveHire,
  getState,
  recoverJobs,
  resetWorkspace,
  runJob,
  setCameraFault,
  submitJob,
  submitRequest,
  STALE_WORKING_MS,
  type ServiceDeps,
} from "../src/lib/workplace/service.server.ts";
import { routeJob } from "../src/lib/workplace/dispatcher.ts";
import { demoCostCents } from "../src/lib/workplace/catalog.ts";
import { lookupPart } from "../src/lib/procurement-provider.server.ts";

// Any network call fails the suite: the fixture must use zero TinyFish credits.
const realFetch = globalThis.fetch;
globalThis.fetch = (() => {
  throw new Error("Network call attempted during tests");
}) as typeof fetch;
process.env.PROCUREMENT_FIXTURE_DELAY_MS = "0";
after(() => {
  globalThis.fetch = realFetch;
});

const WS = DEFAULT_WORKSPACE_ID;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "workplace-test-"));
let db: Db;
let dbFile: string;
let clock: number;
let seq: number;
let lookups: string[];

const deps: ServiceDeps = {
  now: () => clock,
  newId: (prefix) => `${prefix}_${++seq}`,
  lookup: async (partName, supplier) => {
    lookups.push(`${supplier.id}:${partName}`);
    clock += 90_000; // pretend the lookup took 90 seconds
    return lookupPart(partName, supplier, "sample");
  },
};

let requestCounter = 0;
const rid = () => `req-${++requestCounter}-abcdef`;
const state = () => getState(db, WS, "sample", clock)!;
const job = (id: string) => state().jobs.find((j) => j.id === id)!;

beforeEach(() => {
  dbFile = path.join(tmp, `w-${Date.now()}-${Math.random()}.db`);
  db = openDb(dbFile);
  clock = Date.UTC(2026, 10, 21, 12);
  seq = 0;
  lookups = [];
});

function submitPart(partName = "Raspberry Pi 5 4GB", supplierId = "adafruit", clientRequestId = rid()) {
  const r = submitJob(db, deps, WS, { clientRequestId, type: "supplier_lookup", input: { partName, supplierId } });
  assert.ok(r.ok, JSON.stringify(r));
  return r;
}

test("new workspace has the Quality Inspector only", () => {
  const s = state();
  assert.deepEqual(s.team.map((h) => h.role), ["Quality Inspector"]);
  assert.ok(s.marketplace.every((p) => !p.hired));
});

test("missing skill: Dispatcher recommends a qualified marketplace worker and waits", () => {
  const r = submitPart();
  assert.deepEqual(r.runJobIds, []);
  const j = job(r.jobId);
  assert.equal(j.status, "needs_worker");
  assert.equal(j.requiredSkill, "supplier_research");
  assert.equal(j.recommendedProfileId, "procurement_researcher");
  assert.equal(j.hireId, null);
  assert.ok(j.events.some((e) => e.actor === "Dispatcher" && /Nobody on the team has Supplier research/.test(e.text)));
  assert.ok(j.events.some((e) => /\$6\.00 \/ hour/.test(e.text)));
  assert.equal(lookups.length, 0, "nothing runs before the hire is approved");
});

test("approving the hire resumes the original job automatically and produces a SAMPLE report", async () => {
  const { jobId } = submitPart();
  const hire = approveHire(db, deps, WS, { profileId: "procurement_researcher", jobId, retention: "team" });
  assert.ok(hire.ok);
  assert.equal(hire.created, true);
  assert.deepEqual(hire.runJobIds, [jobId]);
  assert.equal(job(jobId).status, "queued");
  assert.ok(job(jobId).events.some((e) => /Resumed the original job automatically/.test(e.text)));

  for (const id of hire.runJobIds) await runJob(db, deps, id);
  const done = job(jobId);
  assert.equal(done.status, "completed");
  assert.equal(done.hireRole, "Procurement Researcher");
  assert.equal(done.report?.mode, "sample");
  assert.equal(done.report?.outcome, "found");
  assert.equal(done.report?.runtimeMs, 90_000);
  assert.equal(done.report?.demoCostCents, 15, "$6/hour for 90 s = $0.15");
  assert.deepEqual(lookups, ["adafruit:Raspberry Pi 5 4GB"]);
  const body = done.report!.body;
  assert.equal(body.type, "supplier_lookup");
  if (body.type === "supplier_lookup") {
    assert.equal(body.result.mode, "sample");
    assert.ok(body.result.uncertainties[0].startsWith("SAMPLE fixture data"));
    assert.match(body.result.sourceUrl, /^https:\/\/www\.adafruit\.com\//);
  }
});

test("a second procurement job reuses the hired worker without another hire", async () => {
  const first = submitPart();
  const hire = approveHire(db, deps, WS, { profileId: "procurement_researcher", jobId: first.jobId, retention: "team" });
  assert.ok(hire.ok);
  for (const id of hire.runJobIds) await runJob(db, deps, id);

  const second = submitPart("SparkFun Qwiic cable", "sparkfun");
  assert.deepEqual(second.runJobIds, [second.jobId], "assigned immediately");
  const queued = job(second.jobId);
  assert.equal(queued.status, "queued");
  assert.equal(queued.hireId, hire.hireId);
  assert.equal(queued.recommendedProfileId, null);
  assert.ok(queued.events.some((e) => /Procurement Researcher is already on the team/.test(e.text)));

  await runJob(db, deps, second.jobId);
  const s = state();
  assert.equal(s.team.filter((h) => h.profileId === "procurement_researcher").length, 1);
  assert.equal(s.team.find((h) => h.id === hire.hireId)?.completedJobs, 2);
  assert.equal(job(second.jobId).status, "completed");
});

test("repeated hire clicks produce a single hire and a single run", async () => {
  const { jobId } = submitPart();
  const a = approveHire(db, deps, WS, { profileId: "procurement_researcher", jobId, retention: "team" });
  const b = approveHire(db, deps, WS, { profileId: "procurement_researcher", jobId, retention: "team" });
  assert.ok(a.ok && b.ok);
  assert.equal(a.hireId, b.hireId);
  assert.equal(b.created, false);
  assert.deepEqual(b.runJobIds, []);
  await Promise.all([runJob(db, deps, jobId), runJob(db, deps, jobId)]);
  assert.equal(lookups.length, 1);
  const reports = db.prepare("SELECT COUNT(*) AS n FROM reports WHERE job_id = ?").get(jobId) as { n: number };
  assert.equal(reports.n, 1);
});

test("resubmitting with the same clientRequestId returns the original job", () => {
  const a = submitPart("Raspberry Pi 5 4GB", "adafruit", "same-request-id");
  const b = submitPart("Raspberry Pi 5 4GB", "adafruit", "same-request-id");
  assert.equal(a.jobId, b.jobId);
  assert.equal(state().jobs.length, 1);
});

test("hiring for one job also resumes other jobs waiting on the same skill", () => {
  const a = submitPart("Part A1");
  const b = submitPart("Part B1", "sparkfun");
  const hire = approveHire(db, deps, WS, { profileId: "procurement_researcher", jobId: a.jobId, retention: "team" });
  assert.ok(hire.ok);
  assert.deepEqual(hire.runJobIds, [a.jobId, b.jobId]);
});

test("an unqualified worker cannot be hired for the job", () => {
  const { jobId } = submitPart();
  const r = approveHire(db, deps, WS, { profileId: "catalog_assistant", jobId, retention: "team" });
  assert.equal(!r.ok && r.error.code, "NOT_QUALIFIED");
  assert.equal(state().team.length, 1);
});

test("marketplace hire without a job, then a matching job is assigned immediately", () => {
  const h = approveHire(db, deps, WS, { profileId: "procurement_researcher" });
  assert.ok(h.ok);
  const r = submitPart();
  assert.deepEqual(r.runJobIds, [r.jobId]);
});

test("both marketplace hires get separate desks", () => {
  const a = approveHire(db, deps, WS, { profileId: "procurement_researcher" });
  const b = approveHire(db, deps, WS, { profileId: "catalog_assistant" });
  assert.ok(a.ok && b.ok);
  assert.deepEqual(
    state().team.map((h) => h.desk).sort(),
    ["desk-02", "desk-03", "workstation-01"],
  );
});

test("camera job goes straight to the Quality Inspector with a SIMULATED report", async () => {
  assert.ok(setCameraFault(db, WS, "service-stopped-recovers").ok);
  const r = submitJob(db, deps, WS, { clientRequestId: rid(), type: "camera_incident", input: {} });
  assert.ok(r.ok);
  assert.deepEqual(r.runJobIds, [r.jobId]);
  await runJob(db, deps, r.jobId);
  const j = job(r.jobId);
  assert.equal(j.hireRole, "Quality Inspector");
  assert.equal(j.report?.mode, "simulated");
  assert.equal(j.report?.outcome, "resolved");
  assert.equal(j.report?.demoCostCents, null, "staff are not billed");
  assert.match(j.title, /SIMULATED/);
  assert.deepEqual(Object.keys(j.input).sort(), ["station"], "the job carries no simulated fault");
});

test("camera case 1b: restart succeeds, no frame -> report says incident still open", async () => {
  assert.ok(setCameraFault(db, WS, "service-stopped-no-frame").ok);
  const r = submitJob(db, deps, WS, { clientRequestId: rid(), type: "camera_incident", input: {} });
  assert.ok(r.ok);
  await runJob(db, deps, r.jobId);
  const j = job(r.jobId);
  assert.equal(j.report?.outcome, "incident_open");
  const body = j.report!.body;
  assert.ok(body.type === "camera_incident" && body.incident.status === "open");
});

test("camera case 2: camera missing -> technician cable task, no restart", async () => {
  assert.ok(setCameraFault(db, WS, "camera-missing").ok);
  const r = submitJob(db, deps, WS, { clientRequestId: rid(), type: "camera_incident", input: {} });
  assert.ok(r.ok);
  await runJob(db, deps, r.jobId);
  const body = job(r.jobId).report!.body;
  assert.ok(body.type === "camera_incident");
  if (body.type === "camera_incident") {
    assert.ok(body.incident.actions.some((a) => a.kind === "technician_check_cable"));
    assert.ok(!body.incident.actions.some((a) => a.kind === "restart_camera_service"));
  }
});

test("invalid input is rejected and creates no job", () => {
  const cases = [
    { clientRequestId: rid(), type: "supplier_lookup", input: { partName: "Pi 5", supplierId: "https://evil.example" } },
    { clientRequestId: rid(), type: "supplier_lookup", input: { partName: "x", supplierId: "adafruit" } },
    { clientRequestId: rid(), type: "camera_incident", input: { station: "Packing Station 9" } },
    { clientRequestId: rid(), type: "launch_rockets", input: {} },
    { clientRequestId: "bad id!", type: "supplier_lookup", input: { partName: "Pi 5", supplierId: "adafruit" } },
  ];
  for (const c of cases) assert.equal(submitJob(db, deps, WS, c).ok, false, JSON.stringify(c));
  assert.equal(state().jobs.length, 0);
});

test("provider errors mark the job failed with the error code", async () => {
  const failing: ServiceDeps = {
    ...deps,
    lookup: async () => ({ ok: false, error: { code: "PROVIDER_ERROR", message: "boom" } }),
  };
  const { jobId } = submitPart();
  approveHire(db, failing, WS, { profileId: "procurement_researcher", jobId, retention: "team" });
  await runJob(db, failing, jobId);
  const j = job(jobId);
  assert.equal(j.status, "failed");
  assert.equal(j.error?.code, "PROVIDER_ERROR");
  assert.equal(j.report, null);
});

test("team, jobs and reports survive reopening the database file", async () => {
  const { jobId } = submitPart();
  const hire = approveHire(db, deps, WS, { profileId: "procurement_researcher", jobId, retention: "team" });
  assert.ok(hire.ok);
  await runJob(db, deps, jobId);
  db.close();

  db = openDb(dbFile);
  const s = state();
  assert.ok(s.team.some((h) => h.id === hire.hireId && h.desk === "desk-02"));
  assert.equal(job(jobId).status, "completed");
  assert.equal(job(jobId).report?.mode, "sample");
  const second = submitPart("Raspberry Pi 5 8GB");
  assert.equal(job(second.jobId).hireId, hire.hireId);
});

test("stale working jobs are failed; queued jobs are returned for rescheduling", () => {
  const h = approveHire(db, deps, WS, { profileId: "procurement_researcher" });
  assert.ok(h.ok);
  const a = submitPart("Part stale");
  const b = submitPart("Part queued");
  db.prepare("UPDATE jobs SET status = 'working', started_at = ? WHERE id = ?").run(clock, a.jobId);
  clock += STALE_WORKING_MS + 1;
  assert.deepEqual(recoverJobs(db, WS, clock), [b.jobId]);
  assert.equal(job(a.jobId).error?.code, "INTERRUPTED");
});

test("reset clears hires, jobs and reports and reseeds staff", async () => {
  const { jobId } = submitPart();
  approveHire(db, deps, WS, { profileId: "procurement_researcher", jobId, retention: "team" });
  await runJob(db, deps, jobId);
  resetWorkspace(db, WS, clock);
  const s = state();
  assert.equal(s.jobs.length, 0);
  assert.deepEqual(s.team.map((h) => h.role), ["Quality Inspector"]);
});

test("routeJob prefers the earliest qualified hire", () => {
  const d = routeJob("supplier_lookup", [
    { id: "b", profileId: "x", role: "B", skills: ["supplier_research"], hiredAt: 2 },
    { id: "a", profileId: "y", role: "A", skills: ["supplier_research"], hiredAt: 1 },
  ]);
  assert.ok(d.kind === "assign" && d.hire.id === "a");
});

test("demo cost bills by the second", () => {
  assert.equal(demoCostCents(600, 90_000), 15);
  assert.equal(demoCostCents(600, 1), 0);
  assert.equal(demoCostCents(null, 90_000), null);
});

// --- "What do you need help with?" ------------------------------------------

function ask(request: string, pending?: unknown, clientRequestId = rid()) {
  const r = submitRequest(db, deps, WS, { clientRequestId, request, pending });
  assert.ok(r.ok, JSON.stringify(r));
  return r;
}

test("clear request: matched to supplier research, recommends a hire, approving resumes it", async () => {
  const r = ask("Find a Raspberry Pi 5 4GB on Adafruit");
  assert.equal(r.kind, "job");
  if (r.kind !== "job") return;
  const j = job(r.jobId);
  assert.equal(j.status, "needs_worker");
  assert.equal(j.recommendedProfileId, "procurement_researcher");
  assert.equal(j.input.request, "Find a Raspberry Pi 5 4GB on Adafruit");
  assert.ok(j.events.some((e) => e.actor === "You" && e.text === "Find a Raspberry Pi 5 4GB on Adafruit"));
  assert.ok(j.events.some((e) => /Understood \(built-in rules\) as Supplier research: find “Raspberry Pi 5 4GB” on Adafruit/.test(e.text)));

  const h = approveHire(db, deps, WS, { profileId: "procurement_researcher", jobId: r.jobId, retention: "team" });
  assert.ok(h.ok);
  for (const id of h.runJobIds) await runJob(db, deps, id);
  assert.equal(job(r.jobId).report?.mode, "sample");

  const second = ask("Is the Qwiic cable 100mm in stock at SparkFun?");
  assert.ok(second.kind === "job");
  if (second.kind === "job") {
    assert.deepEqual(second.runJobIds, [second.jobId], "reused hire: runs immediately");
    assert.equal(job(second.jobId).hireId, h.hireId);
  }
  assert.equal(state().team.filter((t) => t.profileId === "procurement_researcher").length, 1);
});

test("vague request: follow-up first, no job until details arrive", () => {
  const f = ask("I need a replacement part");
  assert.equal(f.kind, "follow_up");
  assert.equal(state().jobs.length, 0);
  if (f.kind !== "follow_up") return;
  assert.match(f.question, /Which part do you need, and which supplier/);

  const done = ask("Raspberry Pi 5 4GB on Adafruit", f.pending);
  assert.equal(done.kind, "job");
  if (done.kind !== "job") return;
  const j = job(done.jobId);
  assert.equal(j.title, "Find “Raspberry Pi 5 4GB” on Adafruit");
  assert.equal(j.input.request, "I need a replacement part");
  const texts = j.events.map((e) => `${e.actor}: ${e.text}`);
  assert.ok(texts.includes("You: I need a replacement part"));
  assert.ok(texts.some((t) => t.startsWith("Dispatcher: I can have a Procurement Researcher check a supplier.")));
  assert.ok(texts.includes("You: Raspberry Pi 5 4GB on Adafruit"));
});

test("unsupported request: explained, no job created", () => {
  const u = ask("Write a marketing email for our spring launch");
  assert.equal(u.kind, "unsupported");
  if (u.kind === "unsupported") assert.match(u.message, /No worker on your team or in the marketplace can handle/);
  assert.equal(state().jobs.length, 0);
  assert.equal(state().team.length, 1);
});

test("camera request: the Inspector gets observations from the simulator-controlled fault only", async () => {
  assert.ok(setCameraFault(db, WS, "service-stopped-no-frame").ok);
  const r = ask("The camera feed at Packing Station 1 stopped");
  assert.ok(r.kind === "job");
  if (r.kind !== "job") return;
  assert.deepEqual(r.runJobIds, [r.jobId], "Quality Inspector already on the team");
  const queued = job(r.jobId);
  assert.ok(!JSON.stringify(queued.input).includes("service-stopped"), "fault is not in the job input");
  assert.ok(!queued.title.includes("1b"));
  await runJob(db, deps, r.jobId);
  const done = job(r.jobId);
  assert.equal(done.report?.outcome, "incident_open");
  assert.ok(done.report?.body.type === "camera_incident" && done.report.body.simulatorFault === "service-stopped-no-frame");
});

test("simulator fault setting persists, rejects unknown faults, resets with the demo", () => {
  assert.equal(state().simulator.cameraFault, "service-stopped-recovers");
  assert.ok(setCameraFault(db, WS, "camera-missing").ok);
  assert.equal(state().simulator.cameraFault, "camera-missing");
  assert.equal(setCameraFault(db, WS, "meteor-strike").ok, false);
  resetWorkspace(db, WS, clock);
  assert.equal(state().simulator.cameraFault, "service-stopped-recovers");
});

test("the same request id after a follow-up still creates only one job", () => {
  const id = "conversation-0001";
  const f = ask("Find a Raspberry Pi 5 4GB", undefined, id);
  assert.ok(f.kind === "follow_up");
  if (f.kind !== "follow_up") return;
  const a = ask("Adafruit", f.pending, id);
  const b = ask("Adafruit", f.pending, id);
  assert.ok(a.kind === "job" && b.kind === "job" && a.jobId === b.jobId);
  assert.equal(state().jobs.length, 1);
});

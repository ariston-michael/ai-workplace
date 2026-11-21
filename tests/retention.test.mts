// Hire retention: "For this job" (default when approving a Dispatcher recommendation)
// versus "Keep on team", plus departures, instructions and per-hire history.
import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb, type Db } from "../src/lib/workplace/db.server.ts";
import {
  approveHire,
  createWorkspace,
  ensurePersonalWorkspace,
  getState,
  listWorkspaces,
  runJob,
  submitRequest,
  updateHire,
  type ServiceDeps,
  type Viewer,
} from "../src/lib/workplace/service.server.ts";
import { readSavedJobs } from "../src/lib/workflow/read-jobs.server.ts";
import { lookupPart } from "../src/lib/procurement-provider.server.ts";

const realFetch = globalThis.fetch;
globalThis.fetch = (() => {
  throw new Error("Network call attempted during tests");
}) as typeof fetch;
process.env.PROCUREMENT_FIXTURE_DELAY_MS = "0";
after(() => {
  globalThis.fetch = realFetch;
});

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "retention-test-"));
let db: Db;
let file: string;
let clock: number;
let seq: number;
const deps: ServiceDeps = {
  now: () => clock,
  newId: (p) => `${p}_${(++seq).toString(36).padStart(6, "0")}`,
  lookup: (partName, supplier) => lookupPart(partName, supplier, "sample"), // fixture: zero credits
};
const alice: Viewer = { sub: "auth0|alice", name: "Alice Example" };
let ws: string;

beforeEach(() => {
  file = path.join(tmp, `r-${Date.now()}-${Math.random()}.db`);
  db = openDb(file);
  clock = Date.UTC(2026, 10, 21, 18);
  seq = 0;
  ws = ensurePersonalWorkspace(db, deps, alice);
});

const state = () => getState(db, ws, "sample", clock)!;
let n = 0;
function ask(request: string) {
  const r = submitRequest(db, deps, ws, { clientRequestId: `req-${++n}-xxxxxx`, request });
  assert.ok(r.ok && r.kind === "job", JSON.stringify(r));
  return r as Extract<typeof r, { kind: "job" }>;
}
async function run(ids: string[], ms = 4000) {
  for (const id of ids) {
    const started = clock;
    const p = runJob(db, { ...deps, now: () => (clock === started ? started : clock) }, id);
    clock += ms; // the meter runs while the job executes
    await p;
  }
}

test("approving a recommendation defaults to For this job: report saved, meter stopped, worker returns and leaves", async () => {
  const job = ask("Find a Raspberry Pi 5 4GB on Adafruit");
  const hire = approveHire(db, deps, ws, { profileId: "procurement_researcher", jobId: job.jobId });
  assert.ok(hire.ok && hire.created);
  const ro = state().team.find((h) => h.id === hire.hireId)!;
  assert.equal(ro.retention, "job");
  assert.equal(ro.jobId, job.jobId);
  assert.equal(ro.desk, "desk-02");

  clock += 1000;
  await runJob(db, { ...deps, now: () => (clock += 2000) }, job.jobId);

  const s = state();
  const j = s.jobs.find((x) => x.id === job.jobId)!;
  assert.equal(j.status, "completed");
  assert.ok(j.report);
  assert.equal(j.report!.demoCostCents, 0);
  const texts = j.events.map((e) => e.text);
  const meter = texts.findIndex((t) => /Demo meter stopped at \$0\.00 \(2\.0 s at \$6\.00 \/ hour\)\. Report saved\./.test(t));
  const back = texts.findIndex((t) => /^Returned with a SAMPLE report/.test(t));
  const left = texts.findIndex((t) => t === "Left the office (hired for this job only).");
  assert.ok(meter >= 0 && back > meter && left > back, texts.join("\n"));

  assert.equal(s.team.find((h) => h.id === hire.hireId), undefined, "job-only worker left");
  assert.equal(s.team.length, 1, "only the Quality Inspector remains");
  const former = s.formerHires.find((h) => h.id === hire.hireId)!;
  assert.ok(former.departedAt);
  assert.deepEqual(former.history.map((e) => e.kind), ["hired", "assigned", "returned", "departed"]);
  assert.equal(listWorkspaces(db, alice.sub)[0].teamSize, 1);

  // The report stays reachable from workflow history after the worker left.
  const history = readSavedJobs(file, ws, alice.sub)!;
  assert.equal(history[0].report?.id, j.report!.id);
  assert.equal(history[0].hireRole, "Procurement Researcher");
  assert.equal(history[0].hireName, "Ro");

  // Its desk is free again, and a later request needs a new hire.
  const next = ask("Is the Qwiic cable 100mm in stock at SparkFun?");
  assert.deepEqual(next.runJobIds, []);
  assert.equal(state().jobs.find((x) => x.id === next.jobId)!.status, "needs_worker");
});

test("Keep on team at approval: the worker goes back to its desk and is reused first", async () => {
  const first = ask("Find a Raspberry Pi 5 4GB on Adafruit");
  const hire = approveHire(db, deps, ws, { profileId: "procurement_researcher", jobId: first.jobId, retention: "team" });
  assert.ok(hire.ok);
  await run(hire.runJobIds);
  const ro = state().team.find((h) => h.id === hire.hireId)!;
  assert.equal(ro.retention, "team");
  assert.deepEqual(ro.history.map((e) => e.kind), ["hired", "assigned", "returned", "at_desk"]);
  assert.match(ro.history.at(-1)!.text, /Back at Desk 02/);

  const second = ask("Is the Qwiic cable 100mm in stock at SparkFun?");
  assert.deepEqual(second.runJobIds, [second.jobId], "reused immediately, no recommendation");
  assert.equal(state().jobs.find((j) => j.id === second.jobId)!.hireId, hire.hireId);
});

test("Keep on team while the job runs converts a job-only hire", async () => {
  const job = ask("Find a Raspberry Pi 5 4GB on Adafruit");
  const hire = approveHire(db, deps, ws, { profileId: "procurement_researcher", jobId: job.jobId });
  assert.ok(hire.ok);
  db.prepare("UPDATE jobs SET status = 'working', started_at = ? WHERE id = ?").run(clock, job.jobId); // mid-run
  const kept = updateHire(db, deps, ws, hire.hireId, { retention: "team" });
  assert.ok(kept.ok);
  db.prepare("UPDATE jobs SET status = 'queued' WHERE id = ?").run(job.jobId);
  await run([job.jobId]);
  const s = state();
  assert.ok(s.team.some((h) => h.id === hire.hireId), "kept workers do not leave");
  assert.ok(s.jobs.find((j) => j.id === job.jobId)!.events.some((e) => e.text === "Kept Procurement Researcher on the team after this job."));
  assert.deepEqual(ask("Find a C270 webcam on SparkFun").runJobIds.length, 1, "reused");
});

test("a job-only worker is not reused for a second job while it works on its own", () => {
  const a = ask("Find a Raspberry Pi 5 4GB on Adafruit");
  const hire = approveHire(db, deps, ws, { profileId: "procurement_researcher", jobId: a.jobId });
  assert.ok(hire.ok);
  const b = ask("Find a C270 webcam on SparkFun");
  const jb = state().jobs.find((j) => j.id === b.jobId)!;
  assert.equal(jb.status, "needs_worker");
  assert.equal(jb.recommendedProfileId, "procurement_researcher");
  // Approving B as job-only too: a second Ro takes Desk 03; the first keeps only its own job.
  const second = approveHire(db, deps, ws, { profileId: "procurement_researcher", jobId: b.jobId });
  assert.ok(second.ok && second.created && second.hireId !== hire.hireId);
  assert.deepEqual(second.runJobIds, [b.jobId]);
  assert.deepEqual(state().team.map((h) => h.desk).sort(), ["desk-02", "desk-03", "workstation-01"]);
  // Approving again (double click) returns the same worker and starts nothing new.
  const again = approveHire(db, deps, ws, { profileId: "procurement_researcher", jobId: b.jobId });
  assert.ok(again.ok && !again.created && again.hireId === second.hireId && again.runJobIds.length === 0);
  // Two of the same listing cannot both be kept on the team.
  assert.ok(updateHire(db, deps, ws, hire.hireId, { retention: "team" }).ok);
  const clash = updateHire(db, deps, ws, second.hireId, { retention: "team" });
  assert.ok(!clash.ok && clash.error.code === "ALREADY_ON_TEAM");
});

test("a failed job-only run stops the meter, bills nothing and the worker still leaves", async () => {
  const job = ask("Find a Raspberry Pi 5 4GB on Adafruit");
  const failing: ServiceDeps = { ...deps, lookup: async () => ({ ok: false, error: { code: "PROVIDER_TIMEOUT", message: "Timed out." } }) };
  const hire = approveHire(db, deps, ws, { profileId: "procurement_researcher", jobId: job.jobId });
  assert.ok(hire.ok);
  await runJob(db, failing, job.jobId);
  const s = state();
  const j = s.jobs.find((x) => x.id === job.jobId)!;
  assert.equal(j.status, "failed");
  assert.equal(j.report, null);
  assert.ok(j.events.some((e) => /Demo meter stopped; nothing is billed/.test(e.text)));
  assert.ok(s.formerHires.some((h) => h.id === hire.hireId));
});

test("releasing a kept worker: leaves now when idle, after the current report when busy", async () => {
  const idle = approveHire(db, deps, ws, { profileId: "catalog_assistant" });
  assert.ok(idle.ok);
  assert.equal(state().team.find((h) => h.id === idle.hireId)!.retention, "team", "desk hires are kept by default");
  assert.ok(updateHire(db, deps, ws, idle.hireId, { retention: "job" }).ok);
  assert.ok(state().formerHires.some((h) => h.id === idle.hireId && h.history.at(-1)!.kind === "departed"));

  const job = ask("Find a Raspberry Pi 5 4GB on Adafruit");
  const busy = approveHire(db, deps, ws, { profileId: "procurement_researcher", jobId: job.jobId, retention: "team" });
  assert.ok(busy.ok);
  assert.ok(updateHire(db, deps, ws, busy.hireId, { retention: "job" }).ok);
  assert.ok(state().team.some((h) => h.id === busy.hireId), "stays until its job is done");
  await run([job.jobId]);
  assert.ok(state().formerHires.some((h) => h.id === busy.hireId));
  const gone = updateHire(db, deps, ws, busy.hireId, { retention: "team" });
  assert.ok(!gone.ok && gone.error.code === "HIRE_DEPARTED");
  const staff = updateHire(db, deps, ws, state().team[0].id, { retention: "job" });
  assert.ok(!staff.ok && staff.error.code === "STAFF_RETAINED");
});

test("instructions are saved with the hire, added to each brief, and kept in its own workspace", async () => {
  const job = ask("Find a Raspberry Pi 5 4GB on Adafruit");
  const hire = approveHire(db, deps, ws, { profileId: "procurement_researcher", jobId: job.jobId, retention: "team", instructions: "Prefer in-stock listings; note the price." });
  assert.ok(hire.ok);
  const ro = () => state().team.find((h) => h.id === hire.hireId)!;
  assert.equal(ro().instructions, "Prefer in-stock listings; note the price.");
  assert.ok(state().jobs[0].events.some((e) => /Brief includes Procurement Researcher’s saved instructions: “Prefer in-stock listings; note the price\.”/.test(e.text)));
  assert.ok(updateHire(db, deps, ws, hire.hireId, { instructions: "Only Adafruit." }).ok);
  assert.deepEqual(ro().history.filter((e) => e.kind === "instructions").map((e) => e.text), ["Instructions saved: “Prefer in-stock listings; note the price.”", "Instructions saved: “Only Adafruit.”"]);
  await run([job.jobId]);
  const later = ask("Find a C270 webcam on SparkFun");
  assert.ok(state().jobs.find((j) => j.id === later.jobId)!.events.some((e) => /saved instructions: “Only Adafruit\.”/.test(e.text)));

  const tooLong = updateHire(db, deps, ws, hire.hireId, { instructions: "x".repeat(1001) });
  assert.ok(!tooLong.ok && tooLong.error.code === "INVALID_INSTRUCTIONS");

  // Another office cannot read or change this hire.
  const other = createWorkspace(db, deps, { name: "Other office", ownerSub: alice.sub });
  assert.ok(other.ok);
  const cross = updateHire(db, deps, other.workspace.id, hire.hireId, { instructions: "hijack" });
  assert.ok(!cross.ok && cross.error.code === "HIRE_NOT_FOUND");
  assert.equal(getState(db, other.workspace.id, "sample", clock)!.team.some((h) => h.history.some((e) => /Only Adafruit/.test(e.text))), false);
  assert.equal(ro().instructions, "Only Adafruit.");
});

test("a job-only worker frees its desk for the next hire", async () => {
  const a = ask("Find a Raspberry Pi 5 4GB on Adafruit");
  approveHire(db, deps, ws, { profileId: "procurement_researcher", jobId: a.jobId });
  approveHire(db, deps, ws, { profileId: "catalog_assistant" });
  const b = ask("Find a C270 webcam on SparkFun");
  const full = approveHire(db, deps, ws, { profileId: "procurement_researcher", jobId: b.jobId });
  assert.ok(!full.ok && full.error.code === "NO_OPEN_DESK");
  await run([a.jobId]);
  const now = approveHire(db, deps, ws, { profileId: "procurement_researcher", jobId: b.jobId });
  assert.ok(now.ok && now.created);
  assert.equal(state().team.find((h) => h.id === now.hireId)!.desk, "desk-02");
});

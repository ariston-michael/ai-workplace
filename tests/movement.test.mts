import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb, DEFAULT_WORKSPACE_ID } from "../src/lib/workplace/db.server.ts";
import { submitJob, approveHire, getState, runJob, type ServiceDeps } from "../src/lib/workplace/service.server.ts";
import { workerMovement } from "../src/lib/workplace/movement.ts";
import { lookupPart } from "../src/lib/procurement-provider.server.ts";
import type { LookupResponse } from "../src/lib/procurement.ts";

process.env.PROCUREMENT_FIXTURE_DELAY_MS = "0";

test("worker movement follows saved departure and return events; saved assignment sends a worker to its workstation", async () => {
  const db = openDb(":memory:");
  let id = 0, clock = 1000;
  let finish!: (result: LookupResponse) => void;
  const deps: ServiceDeps = {
    now: () => ++clock, newId: prefix => `${prefix}_${++id}`,
    lookup: () => new Promise(resolve => { finish = resolve; }),
  };
  try {
    const submitted = submitJob(db, deps, DEFAULT_WORKSPACE_ID, { clientRequestId: "movement-request-001", type: "supplier_lookup", input: { partName: "Raspberry Pi 5 4GB", supplierId: "adafruit" } });
    assert.ok(submitted.ok);
    const hired = approveHire(db, deps, DEFAULT_WORKSPACE_ID, { profileId: "procurement_researcher", jobId: submitted.jobId });
    assert.ok(hired.ok);
    let state = getState(db, DEFAULT_WORKSPACE_ID, "sample", clock)!;
    let hire = state.team.find(item => item.id === hired.hireId)!;
    assert.equal(workerMovement(hire, state.jobs).kind, "assigned");
    const running = runJob(db, deps, submitted.jobId);
    state = getState(db, DEFAULT_WORKSPACE_ID, "sample", clock)!;
    hire = state.team.find(item => item.id === hired.hireId)!;
    assert.equal(state.jobs[0].status, "working");
    assert.equal(workerMovement(hire, state.jobs).kind, "working");
    const queued = { ...state.jobs[0], id: "later-queued", status: "queued" as const, events: [] };
    assert.equal(workerMovement({ ...hire, activeJobId: queued.id }, [queued, ...state.jobs]).kind, "working");
    assert.equal(workerMovement(hire, state.jobs.map(job => ({ ...job, events: [] }))).kind, "at_desk");
    const { findSupplier } = await import("../src/lib/procurement.ts");
    finish(await lookupPart("Raspberry Pi 5 4GB", findSupplier("adafruit")!, "sample"));
    await running;
    state = getState(db, DEFAULT_WORKSPACE_ID, "sample", clock)!;
    hire = state.team.find(item => item.id === hired.hireId)!;
    const movement = workerMovement(hire, state.jobs);
    assert.equal(movement.kind, "returned");
    assert.ok(movement.eventKey?.includes("Returned with a SAMPLE report"));
    assert.equal(movement.jobId, submitted.jobId);
  } finally { db.close(); }
});

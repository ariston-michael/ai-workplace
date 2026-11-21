import { test } from "node:test";
import assert from "node:assert/strict";
import { CHARACTERS, characterVoice, characterTask, walkFacing } from "../src/lib/workplace/characters.ts";
import { openDb, DEFAULT_WORKSPACE_ID } from "../src/lib/workplace/db.server.ts";
import { setCameraFault, submitJob, runJob, getState, type ServiceDeps } from "../src/lib/workplace/service.server.ts";

test("characters have distinct names, accents and silhouettes", () => {
  for (const field of ["name", "accent", "detail"] as const) assert.equal(new Set(Object.values(CHARACTERS).map(c => c[field])).size, 4);
});

test("route segments select all four facings without guessing from job status", () => {
  const origin = { x: 10, y: 10 };
  for (const [point, direction] of [[{ x: 10, y: 0 }, "north"], [{ x: 10, y: 20 }, "south"], [{ x: 0, y: 10 }, "west"], [{ x: 20, y: 10 }, "east"]] as const) assert.equal(walkFacing(origin, point), direction);
});

test("Inspector speaks about a fresh frame only when the saved incident is awaiting one", async () => {
  const db = openDb(":memory:");
  let seq = 0;
  const deps: ServiceDeps = { now: () => 1800000000000, newId: prefix => `${prefix}_${++seq}`, lookup: async () => { throw new Error("No provider calls allowed"); } };
  try {
    for (const scenarioId of ["service-stopped-recovers", "service-stopped-no-frame", "camera-missing"]) {
      setCameraFault(db, DEFAULT_WORKSPACE_ID, scenarioId);
      const submitted = submitJob(db, deps, DEFAULT_WORKSPACE_ID, { type: "camera_incident", clientRequestId: `voice-${scenarioId}`, input: {} });
      assert.ok(submitted.ok);
      const queued = getState(db, DEFAULT_WORKSPACE_ID, "sample", deps.now())!.jobs.find(j => j.id === submitted.jobId)!;
      assert.doesNotMatch(characterVoice("quality_inspector", queued), /waiting for a fresh frame/);
      await runJob(db, deps, submitted.jobId);
      const job = getState(db, DEFAULT_WORKSPACE_ID, "sample", deps.now())!.jobs.find(j => j.id === submitted.jobId)!;
      const voice = characterVoice("quality_inspector", job);
      if (scenarioId === "service-stopped-no-frame") { assert.match(voice, /waiting for a fresh frame before I call this fixed/); assert.match(characterTask(job), /report ready, incident still open/); }
      else { assert.doesNotMatch(voice, /waiting for a fresh frame/); assert.match(voice, /recorded the recovery/); }
    }
  } finally { db.close(); }
});

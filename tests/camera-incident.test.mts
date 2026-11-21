import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SCENARIOS,
  applyObservation,
  decideNextStep,
  openIncident,
  runScenario,
  type Incident,
  type Observation,
} from "../src/lib/camera-incident.ts";

const T0 = Date.UTC(2026, 10, 21, 12, 0, 0);
const scenario = (id: string) => SCENARIOS.find((s) => s.id === id)!;

function play(observations: Observation[]): Incident {
  let incident = openIncident({ type: "feed_stopped", source: "simulated", at: T0 }, { id: "t", station: "PS1" });
  observations.forEach((o, i) => {
    incident = applyObservation(incident, { ...o, source: "simulated", at: T0 + (i + 1) * 1000 });
  });
  return incident;
}

test("decision table", () => {
  assert.equal(decideNextStep(true, false).kind, "restart_camera_service");
  assert.equal(decideNextStep(false, false).kind, "technician_check_cable");
  assert.equal(decideNextStep(false, true).kind, "technician_check_cable");
  assert.equal(decideNextStep(true, true).kind, "technician_inspect_camera");
});

test("feed stopped opens an incident with no action until both observations arrive", () => {
  const inc = play([{ type: "usb_camera", detected: true }]);
  assert.equal(inc.status, "open");
  assert.equal(inc.phase, "awaiting_observations");
  assert.equal(inc.actions.length, 0);
});

test("only feed_stopped can open an incident", () => {
  assert.throws(() => openIncident({ type: "usb_camera", detected: true, source: "simulated", at: T0 }, { id: "x", station: "PS1" }));
});

test("observation order does not matter", () => {
  const a = play([{ type: "usb_camera", detected: true }, { type: "camera_service", running: false }]);
  const b = play([{ type: "camera_service", running: false }, { type: "usb_camera", detected: true }]);
  assert.deepEqual(a.actions.map((x) => x.kind), ["restart_camera_service"]);
  assert.deepEqual(b.actions.map((x) => x.kind), ["restart_camera_service"]);
});

test("Case 1a: camera present + service stopped → restart → fresh frame resolves", () => {
  const s = scenario("service-stopped-recovers");
  const beforeRestart = runScenario(s, 3, T0)!;
  assert.equal(beforeRestart.phase, "awaiting_restart");
  assert.deepEqual(beforeRestart.actions.map((a) => [a.kind, a.status]), [["restart_camera_service", "requested"]]);

  const done = runScenario(s, s.steps.length, T0)!;
  assert.equal(done.status, "resolved");
  assert.equal(done.actions[0].status, "succeeded");
  assert.ok(!done.actions.some((a) => a.kind === "technician_check_cable"));
});

test("Case 1b: restart succeeds but no frame → incident stays open", () => {
  const s = scenario("service-stopped-no-frame");
  const inc = runScenario(s, s.steps.length, T0)!;
  assert.equal(inc.status, "open");
  assert.equal(inc.phase, "awaiting_frame");
  assert.equal(inc.resolvedAt, null);
  assert.deepEqual(inc.actions.map((a) => [a.kind, a.status]), [["restart_camera_service", "succeeded"]]);
});

test("Case 2: camera missing → technician cable task, no restart; fresh frame resolves", () => {
  const s = scenario("camera-missing");
  const tasked = runScenario(s, 3, T0)!;
  assert.equal(tasked.phase, "awaiting_technician");
  assert.deepEqual(tasked.actions.map((a) => a.kind), ["technician_check_cable"]);

  const afterTech = runScenario(s, 4, T0)!;
  assert.equal(afterTech.status, "open", "technician report alone must not close the incident");
  assert.equal(afterTech.phase, "awaiting_frame");

  const done = runScenario(s, s.steps.length, T0)!;
  assert.equal(done.status, "resolved");
  assert.ok(!done.actions.some((a) => a.kind === "restart_camera_service"));
});

test("a stale frame (captured before the feed stopped) does not close the incident", () => {
  const inc = play([
    { type: "usb_camera", detected: true },
    { type: "camera_service", running: false },
    { type: "restart_result", succeeded: true },
    { type: "frame", capturedAt: T0 - 1 },
  ]);
  assert.equal(inc.status, "open");
  assert.ok(inc.timeline.some((t) => t.text.includes("stale")));
});

test("repeated identical observations do not create duplicate requests", () => {
  const inc = play([
    { type: "usb_camera", detected: true },
    { type: "camera_service", running: false },
    { type: "camera_service", running: false },
    { type: "usb_camera", detected: true },
    { type: "feed_stopped" },
  ]);
  assert.equal(inc.actions.length, 1);
});

test("changed observations supersede the earlier request", () => {
  const inc = play([
    { type: "usb_camera", detected: true },
    { type: "camera_service", running: false },
    { type: "usb_camera", detected: false },
  ]);
  assert.deepEqual(inc.actions.map((a) => [a.kind, a.status]), [
    ["restart_camera_service", "superseded"],
    ["technician_check_cable", "requested"],
  ]);
});

test("a failed restart escalates to a technician and stays open", () => {
  const inc = play([
    { type: "usb_camera", detected: true },
    { type: "camera_service", running: false },
    { type: "restart_result", succeeded: false },
  ]);
  assert.equal(inc.status, "open");
  assert.deepEqual(inc.actions.map((a) => [a.kind, a.status]), [
    ["restart_camera_service", "failed"],
    ["technician_inspect_camera", "requested"],
  ]);
});

test("every simulator observation is labeled simulated", () => {
  for (const s of SCENARIOS) {
    const inc = runScenario(s, s.steps.length, T0)!;
    const obs = inc.timeline.filter((t) => t.kind === "observation");
    assert.ok(obs.length > 0);
    assert.ok(obs.every((t) => t.source === "simulated"), s.id);
    if (inc.usbCamera) assert.equal(inc.usbCamera.source, "simulated");
    if (inc.cameraService) assert.equal(inc.cameraService.source, "simulated");
  }
});

test("the simulator module makes no network calls", () => {
  const original = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error("network call attempted");
  };
  try {
    for (const s of SCENARIOS) runScenario(s, s.steps.length, T0);
  } finally {
    globalThis.fetch = original;
  }
});

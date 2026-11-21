import { test } from "node:test";
import assert from "node:assert/strict";
import { SCENARIOS, runScenario } from "../src/lib/camera-incident.ts";
import { cameraReport } from "../src/lib/office-camera-report.ts";

const start = Date.UTC(2026, 10, 21, 12);
const scenario = (id: string) => SCENARIOS.find(item => item.id === id)!;

test("office does not report repair completion on restart success without a fresh frame", () => {
  const selected = scenario("service-stopped-no-frame");
  const incident = runScenario(selected, selected.steps.length, start)!;
  const report = cameraReport(incident);
  assert.equal(incident.status, "open");
  assert.equal(report.heading, "Waiting for a fresh frame");
  assert.match(report.uncertainty, /incident remains open/);
  assert.equal(report.actions[0].status, "succeeded");
  assert.equal(report.actions[0].kind, "restart_camera_service");
  assert.match(report.visit, /No technician visit has been requested/);
});

test("office shows the cable visit decision without inventing a restart", () => {
  const incident = runScenario(scenario("camera-missing"), 3, start)!;
  const report = cameraReport(incident);
  assert.match(report.visit, /^Yes/);
  assert.deepEqual(report.actions.map(action => action.kind), ["technician_check_cable"]);
  assert.ok(report.evidence.every(entry => entry.source === "simulated"));
  assert.match(report.evidence.map(entry => entry.text).join(" "), /does not detect the USB camera/);
});

test("technician completion alone leaves the office waiting for a frame", () => {
  const incident = runScenario(scenario("camera-missing"), 4, start)!;
  const report = cameraReport(incident);
  assert.equal(incident.status, "open");
  assert.equal(report.heading, "Waiting for a fresh frame");
  assert.match(report.visit, /technician has reported back/);
});

test("office reflects fresh-frame resolution for both recovery cases", () => {
  for (const id of ["service-stopped-recovers", "camera-missing"]) {
    const selected = scenario(id);
    const incident = runScenario(selected, selected.steps.length, start)!;
    const report = cameraReport(incident);
    assert.equal(report.heading, "Resolved");
    assert.match(report.uncertainty, /fresh frame confirms simulated feed recovery/);
    assert.equal(report.actions.length, 1);
  }
});

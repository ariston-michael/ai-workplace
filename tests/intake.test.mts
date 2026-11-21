import { test } from "node:test";
import assert from "node:assert/strict";
import { extractPart, interpretRequest, type Interpretation, type PendingRequest } from "../src/lib/workplace/intake.ts";

function ready(i: Interpretation) {
  assert.equal(i.kind, "ready", JSON.stringify(i));
  return i as Extract<Interpretation, { kind: "ready" }>;
}
function followUp(i: Interpretation) {
  assert.equal(i.kind, "follow_up", JSON.stringify(i));
  return i as Extract<Interpretation, { kind: "follow_up" }>;
}

// --- clear requests ---------------------------------------------------------

const CLEAR_SUPPLIER: [string, string, string][] = [
  ["Find a Raspberry Pi 5 4GB on Adafruit", "Raspberry Pi 5 4GB", "adafruit"],
  ["Can you check if the Raspberry Pi 5 4GB is in stock at SparkFun?", "Raspberry Pi 5 4GB", "sparkfun"],
  ["Is the Raspberry Pi 5 4GB in stock at SparkFun?", "Raspberry Pi 5 4GB", "sparkfun"],
  ["We need to order a replacement Logitech C270 webcam from Digi-Key", "Logitech C270 webcam", "digikey"],
  ['Source "Qwiic cable 100mm" from sparkfun please', "Qwiic cable 100mm", "sparkfun"],
  ["price of a USB-C power supply 27W on adafruit", "USB-C power supply 27W", "adafruit"],
];

for (const [text, part, supplier] of CLEAR_SUPPLIER) {
  test(`clear supplier request: ${text}`, () => {
    const r = ready(interpretRequest(text));
    assert.equal(r.jobType, "supplier_lookup");
    assert.deepEqual(r.input, { partName: part, supplierId: supplier });
  });
}

for (const text of [
  "The camera feed at Packing Station 1 stopped",
  "camera is down",
  "Packing station camera shows a black screen and is frozen",
  "No video from the C270",
]) {
  test(`clear camera request: ${text}`, () => {
    const r = ready(interpretRequest(text));
    assert.equal(r.jobType, "camera_incident");
    assert.deepEqual(r.input, { station: "Packing Station 1" });
  });
}

test("a camera request never carries a simulated fault", () => {
  const r = ready(interpretRequest("The camera feed stopped"));
  assert.ok(!("scenarioId" in r.input));
});

// --- vague requests ---------------------------------------------------------

for (const text of ["I need help", "Something is broken, can you help?", "hi, we have a problem"]) {
  test(`vague request asks which kind of job: ${text}`, () => {
    const f = followUp(interpretRequest(text));
    assert.equal(f.pending.jobType, null);
    assert.match(f.question, /replacement part/);
    assert.match(f.question, /camera feed/);
  });
}

test("vague procurement request asks for part and supplier", () => {
  const f = followUp(interpretRequest("I need a replacement part"));
  assert.equal(f.pending.jobType, "supplier_lookup");
  assert.deepEqual(f.pending.missing, ["part_name", "supplier"]);
  assert.match(f.question, /Which part do you need, and which supplier/);
});

test("missing supplier only asks for the supplier", () => {
  const f = followUp(interpretRequest("Find a Raspberry Pi 5 4GB"));
  assert.deepEqual(f.pending.missing, ["supplier"]);
  assert.equal(f.pending.partName, "Raspberry Pi 5 4GB");
  assert.match(f.question, /Which supplier should I check for “Raspberry Pi 5 4GB”/);
});

test("answering a supplier follow-up completes the job and keeps the transcript", () => {
  const f = followUp(interpretRequest("Find a Raspberry Pi 5 4GB"));
  const r = ready(interpretRequest("Adafruit", f.pending));
  assert.deepEqual(r.input, { partName: "Raspberry Pi 5 4GB", supplierId: "adafruit" });
  assert.equal(r.original, "Find a Raspberry Pi 5 4GB");
  assert.deepEqual(r.transcript.map((l) => l.actor), ["You", "Dispatcher", "You"]);
});

test("one answer can supply both part and supplier", () => {
  const f = followUp(interpretRequest("I need a replacement part"));
  const r = ready(interpretRequest("Raspberry Pi 5 4GB on SparkFun", f.pending));
  assert.deepEqual(r.input, { partName: "Raspberry Pi 5 4GB", supplierId: "sparkfun" });
});

test("a bare part-name answer is taken as the part, then supplier is asked", () => {
  const f = followUp(interpretRequest("I need a replacement part"));
  const f2 = followUp(interpretRequest("C270 webcam", f.pending));
  assert.equal(f2.pending.partName, "C270 webcam");
  assert.deepEqual(f2.pending.missing, ["supplier"]);
  const r = ready(interpretRequest("digikey", f2.pending));
  assert.deepEqual(r.input, { partName: "C270 webcam", supplierId: "digikey" });
});

test("vague request clarified as a camera problem", () => {
  const f = followUp(interpretRequest("I need help"));
  const r = ready(interpretRequest("the camera feed stopped", f.pending));
  assert.equal(r.jobType, "camera_incident");
  assert.equal(r.original, "I need help");
});

test("vague request clarified as a part lookup", () => {
  const f = followUp(interpretRequest("I need help"));
  const r = ready(interpretRequest("find a Raspberry Pi 5 4GB on Adafruit", f.pending));
  assert.equal(r.jobType, "supplier_lookup");
});

test("camera mention without a problem asks what is happening", () => {
  const f = followUp(interpretRequest("the camera"));
  assert.match(f.question, /What is happening with the camera/);
  const r = ready(interpretRequest("it stopped sending frames", f.pending));
  assert.equal(r.jobType, "camera_incident");
});

test("broken camera + 'replacement' asks diagnose or source", () => {
  const f = followUp(interpretRequest("The camera is broken, I need a replacement"));
  assert.match(f.question, /diagnose the camera feed .* or a Procurement Researcher to find a replacement camera/);
  assert.equal(ready(interpretRequest("diagnose it", f.pending)).jobType, "camera_incident");
});

test("broken camera + explicit order goes to procurement", () => {
  const r = ready(interpretRequest("Camera is dead, order a Logitech C270 from Adafruit"));
  assert.equal(r.jobType, "supplier_lookup");
  assert.equal(r.input.supplierId, "adafruit");
});

// --- unsupported --------------------------------------------------------------

for (const text of ["Write a marketing email for our spring launch", "Book a flight to Toronto", "Translate this contract into French"]) {
  test(`unsupported request: ${text}`, () => {
    const u = interpretRequest(text);
    assert.equal(u.kind, "unsupported", JSON.stringify(u));
    if (u.kind === "unsupported") {
      assert.match(u.message, /No worker on your team or in the marketplace can handle/);
      assert.equal(u.skill, null);
    }
  });
}

test("internal catalog search: skill exists in the marketplace but no job type yet", () => {
  const u = interpretRequest("Look up part number 4471-B in our internal catalog");
  assert.equal(u.kind, "unsupported");
  if (u.kind === "unsupported") {
    assert.equal(u.skill, "catalog_search");
    assert.match(u.message, /Catalog Assistant/);
    assert.match(u.message, /no available worker can take this job/);
  }
});

// --- validation ---------------------------------------------------------------

test("empty and non-string requests are invalid", () => {
  assert.equal(interpretRequest("   ").kind, "invalid");
  assert.equal(interpretRequest(42).kind, "invalid");
});

test("tampered pending data is re-validated", () => {
  const bad = { original: "Find a pi", jobType: "supplier_lookup", supplierId: "evil.example", transcript: [] } as unknown as PendingRequest;
  const f = followUp(interpretRequest("Raspberry Pi 5", bad));
  assert.deepEqual(f.pending.missing, ["supplier"], "unknown supplier ids are dropped");
  assert.equal(interpretRequest("Adafruit", { nonsense: true }).kind, "invalid");
});

test("extractPart rejects generic words", () => {
  assert.equal(extractPart("I need a replacement part"), undefined);
  assert.equal(extractPart("find something"), undefined);
  assert.equal(extractPart("find a Raspberry Pi 5 on adafruit"), "Raspberry Pi 5");
});

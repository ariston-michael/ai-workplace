import { test, after } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/lib/workplace/db.server.ts";
import { ensurePersonalWorkspace, getState, runJob } from "../src/lib/workplace/service.server.ts";
import { dispatch } from "../src/lib/workplace/dispatcher-ai.server.ts";
import { lookupPart } from "../src/lib/procurement-provider.server.ts";
import { simulateSms, simulationMessages } from "../src/lib/sms/simulated.server.ts";
import { notifySmsResult, type SmsDeps } from "../src/lib/sms/sms.server.ts";
import { twilioConfig } from "../src/lib/sms/twilio.server.ts";
const prior = process.env.SMS_MODE; process.env.SMS_MODE = "simulated";
process.env.PROCUREMENT_FIXTURE_DELAY_MS = "0";
after(() => { if (prior === undefined) delete process.env.SMS_MODE; else process.env.SMS_MODE = prior; });

test("simulated SMS uses real private hire/report flow and cannot enable Twilio", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (() => { throw new Error("Carrier/provider network call attempted"); }) as typeof fetch;
  const db = openDb(":memory:"); let seq = 0;
  const deps: SmsDeps = { now: () => 1800000000000 + seq++, newId: p => `${p}_${seq++}`, lookup: (part, supplier) => lookupPart(part, supplier, "sample"), dispatch: (text, pending, opts) => dispatch(text, pending, opts, null) };
  try {
    const alice = ensurePersonalWorkspace(db, deps, { sub: "auth0|alice", name: "Alice" });
    const bob = ensurePersonalWorkspace(db, deps, { sub: "auth0|bob", name: "Bob" });
    const request = await simulateSms(db, deps, alice, "auth0|alice", "Find a Raspberry Pi 5 4GB on Adafruit", "request-12345678");
    const code = /Job ([A-Z0-9]{4})/.exec(request.reply)![1];
    const approved = await simulateSms(db, deps, alice, "auth0|alice", `APPROVE ${code}`, "approve-12345678");
    assert.equal(approved.runJobIds.length, 1);
    await runJob(db, deps, approved.runJobIds[0]);
    await notifySmsResult(db, deps.now(), approved.runJobIds[0], async () => ({ ok: true, sid: "SIMULATED", status: "simulated" }));
    const job = getState(db, alice, "sample", 0)!.jobs[0];
    assert.equal(job.status, "completed"); assert.equal(job.report?.mode, "sample"); assert.equal(job.sms?.simulated, true);
    assert.match(simulationMessages(db, alice, "auth0|alice").map(m => m.body).join(" "), /SAMPLE result/);
    assert.deepEqual(simulationMessages(db, bob, "auth0|bob"), []);
    assert.throws(() => simulationMessages(db, alice, "auth0|bob"));
    await assert.rejects(simulateSms(db, deps, alice, "auth0|bob", "APPROVE " + code, "attack-123456789"));
    const duplicate = await simulateSms(db, deps, alice, "auth0|alice", `APPROVE ${code}`, "approve-12345678");
    assert.deepEqual(duplicate.runJobIds, []);
    assert.equal(twilioConfig({ SMS_MODE: "simulated", TWILIO_ACCOUNT_SID: "AC" + "a".repeat(32), TWILIO_AUTH_TOKEN: "secret", TWILIO_PHONE_NUMBER: "+15555550100", TWILIO_WEBHOOK_URL: "https://example.com/api/sms/twilio" }), null);
  } finally { db.close(); globalThis.fetch = realFetch; }
});

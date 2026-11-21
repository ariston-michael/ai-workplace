// Text the Dispatcher: linking, the full SMS job flow, duplicates and signatures.
// Built-in Dispatcher rules and the SAMPLE procurement fixture: no network, no credits.
import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { openDb, type Db } from "../src/lib/workplace/db.server.ts";
import { approveHire, createWorkspace, ensurePersonalWorkspace, getState, resetWorkspace, runJob, type Viewer } from "../src/lib/workplace/service.server.ts";
import { dispatch } from "../src/lib/workplace/dispatcher-ai.server.ts";
import { createLinkCode, handleInboundSms, listLinks, notifySmsResult, unlinkPhone, LINK_CODE_TTL_MS, type SmsDeps } from "../src/lib/sms/sms.server.ts";
import { twilioConfig, twilioSignature, twiml, validTwilioSignature } from "../src/lib/sms/twilio.server.ts";
import { lookupPart } from "../src/lib/procurement-provider.server.ts";

const realFetch = globalThis.fetch;
globalThis.fetch = (() => { throw new Error("Network call attempted during tests"); }) as typeof fetch;
process.env.PROCUREMENT_FIXTURE_DELAY_MS = "0";
after(() => { globalThis.fetch = realFetch; });

let db: Db;
let clock: number;
let seq: number;
let lookups: number;
const deps: SmsDeps = {
  now: () => clock,
  newId: (p) => `${p}_${(++seq).toString(36).padStart(6, "0")}`,
  lookup: (partName, supplier) => { lookups++; return lookupPart(partName, supplier, "sample"); }, // SAMPLE fixture: no TinyFish
  dispatch: (text, pending, opts) => dispatch(text, pending, opts, null), // built-in rules
};
const alice: Viewer = { sub: "auth0|alice", name: "Alice Example" };
const PHONE = "+16135550123";
let ws: string;
let sid = 0;
const nextSid = () => `SM${(++sid).toString(16).padStart(32, "0")}`;
const text = (body: string, from = PHONE, messageSid = nextSid()) => handleInboundSms(db, deps, { messageSid, from, body });
const sent: { to: string; body: string }[] = [];
const send = async (to: string, body: string) => { sent.push({ to, body }); return { ok: true as const, sid: `SM${"f".repeat(32)}`, status: "queued" }; };
async function runAll(ids: string[]) { for (const id of ids) { await runJob(db, deps, id); await notifySmsResult(db, clock, id, send); } }
async function linkPhone(phone = PHONE, workspace = ws) {
  const { code } = createLinkCode(db, clock, workspace, alice.sub);
  return text(`LINK ${code}`, phone);
}

beforeEach(() => {
  db = openDb(":memory:");
  clock = Date.UTC(2026, 10, 21, 18);
  seq = 0; lookups = 0; sent.length = 0;
  ws = ensurePersonalWorkspace(db, deps, alice);
});

test("Twilio signatures: valid passes, any change fails; config needs all four settings", () => {
  const url = "https://example.trycloudflare.com/api/sms/twilio";
  const params: [string, string][] = [["To", "+15550000000"], ["From", PHONE], ["Body", "Hi there"], ["MessageSid", "SM" + "a".repeat(32)], ["AccountSid", "AC" + "b".repeat(32)]];
  const sig = twilioSignature("token123", url, params);
  // Twilio's own worked example (twilio.com/docs/usage/security, "Explore the algorithm yourself").
  assert.equal(twilioSignature("12345", "https://example.com/myapp.php?foo=1&bar=2", [["Digits", "1234"], ["To", "+18005551212"], ["From", "+14158675310"], ["Caller", "+14158675310"], ["CallSid", "CA1234567890ABCDE"]]), "L/OH5YylLD5NRKLltdqwSvS0BnU=");
  assert.ok(validTwilioSignature("token123", url, params, sig));
  assert.ok(!validTwilioSignature("token123", url, params, null));
  assert.ok(!validTwilioSignature("wrong", url, params, sig));
  assert.ok(!validTwilioSignature("token123", url + "/", params, sig), "the exact configured URL is required");
  assert.ok(!validTwilioSignature("token123", url, [...params.slice(0, 2), ["Body", "APPROVE ABCD"], ...params.slice(3)], sig), "a changed body is rejected");
  assert.equal(twilioConfig({}), null);
  assert.equal(twilioConfig({ TWILIO_ACCOUNT_SID: "AC" + "1".repeat(32), TWILIO_AUTH_TOKEN: "t", TWILIO_PHONE_NUMBER: "+16135550100", TWILIO_WEBHOOK_URL: "http://evil.example/x" }), null, "public webhooks must be https");
  assert.ok(twilioConfig({ TWILIO_ACCOUNT_SID: "AC" + "1".repeat(32), TWILIO_AUTH_TOKEN: "t", TWILIO_PHONE_NUMBER: "+1 (613) 555-0100", TWILIO_WEBHOOK_URL: url }));
  assert.equal(twiml("a < b & \"c\""), '<?xml version="1.0" encoding="UTF-8"?><Response><Message>a &lt; b &amp; &quot;c&quot;</Message></Response>');
  assert.equal(twiml(""), '<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
});

test("linking: single-use, expiring codes; unlinked phones get instructions; brute force is throttled", async () => {
  const before = await text("I need a replacement part");
  assert.match(before.reply, /isn't linked to an office/);
  const { code } = createLinkCode(db, clock, ws, alice.sub);
  const linked = await text(`link ${code}`);
  assert.match(linked.reply, /^Linked to Alice’s office\./);
  assert.equal(listLinks(db, ws)[0].phone, "•••0123");
  assert.ok(!JSON.stringify(listLinks(db, ws)).includes(PHONE), "the full number is never shown");
  const reuse = await text(code, "+16135550999");
  assert.match(reuse.reply, /invalid, used or expired/, "codes are single use");

  const { code: late } = createLinkCode(db, clock, ws, alice.sub);
  clock += LINK_CODE_TTL_MS + 1;
  assert.match((await text(late, "+16135550999")).reply, /invalid, used or expired/, "codes expire");

  for (let i = 0; i < 5; i++) await text(String(100000 + i), "+16135550888");
  const { code: good } = createLinkCode(db, clock, ws, alice.sub);
  assert.match((await text(good, "+16135550888")).reply, /Too many link attempts/);

  // One phone, one office: linking to a second office moves it.
  const second = createWorkspace(db, deps, { name: "Warehouse", ownerSub: alice.sub });
  assert.ok(second.ok);
  await linkPhone(PHONE, second.workspace.id);
  assert.equal(listLinks(db, ws).length, 0);
  assert.equal(listLinks(db, second.workspace.id).length, 1);
  assert.ok(unlinkPhone(db, second.workspace.id, listLinks(db, second.workspace.id)[0].id));
  assert.match((await text("hello")).reply, /isn't linked/);
});

test("end to end by text: follow-up, hire recommendation, APPROVE, one SAMPLE result, saved history", async () => {
  await linkPhone();
  const q = await text("I need a replacement part");
  assert.match(q.reply, /part/i);
  assert.match(q.reply, /Adafruit, SparkFun or Digi-Key/);
  const r = await text("Raspberry Pi 5 4GB on Adafruit");
  const m = /Job ([A-Z0-9]{4})\. Reply APPROVE \1 to hire Ro for this job only/.exec(r.reply);
  assert.ok(m, r.reply);
  assert.match(r.reply, /Ro, Procurement Researcher \(official\), \$6\.00 \/ hour/);
  assert.deepEqual(r.runJobIds, [], "nothing runs before approval");
  const code = m![1];

  const approved = await text(`approve ${code.toLowerCase()}`);
  assert.match(approved.reply, new RegExp(`Approved\\. Ro \\(Procurement Researcher\\) is hired for this job only and starting job ${code}`));
  assert.equal(approved.runJobIds.length, 1);
  const again = await text(`APPROVE ${code}`);
  assert.match(again.reply, /already approved and assigned to Ro/);
  assert.deepEqual(again.runJobIds, [], "a repeated approval runs nothing");

  await runAll(approved.runJobIds);
  await runAll(approved.runJobIds); // a second runner / notifier changes nothing
  assert.equal(lookups, 1, "the job ran exactly once (SAMPLE fixture)");
  assert.equal(sent.length, 1, "the result is texted once");
  assert.equal(sent[0].to, PHONE);
  assert.match(sent[0].body, new RegExp(`^SAMPLE result, job ${code}: Raspberry Pi 5`));
  assert.match(sent[0].body, /Fixture data, not a live stock check\./);
  assert.match(sent[0].body, /Source: https:\/\/www\.adafruit\.com\//);
  assert.match(sent[0].body, /Ro delivered the report and left the office \(hired for this job only\)\./);

  const job = getState(db, ws, "sample", clock)!.jobs[0];
  assert.equal(job.status, "completed");
  assert.equal(job.report?.mode, "sample");
  assert.deepEqual(job.sms, { code, phone: "•••0123" });
  const texts = job.events.map((e) => `${e.actor}: ${e.text}`);
  for (const expected of [/^You: I need a replacement part$/, /^You: Raspberry Pi 5 4GB on Adafruit$/, /^SMS: Requested by text from •••0123\. Job code/, /^SMS: Approved by text from •••0123 \(for this job only\)\./, /^SMS: Texted the SAMPLE result to •••0123\./]) {
    assert.ok(texts.some((t) => expected.test(t)), `${expected} in\n${texts.join("\n")}`);
  }
  assert.match(await text(`APPROVE ${code}`).then((x) => x.reply), /has already finished/);
});

test("a kept worker is reused by text with no hire, and the result comes back", async () => {
  await linkPhone();
  const first = await text("Find a Raspberry Pi 5 4GB on Adafruit");
  const code = /Job ([A-Z0-9]{4})/.exec(first.reply)![1];
  const kept = await text(`APPROVE ${code} KEEP`);
  assert.match(kept.reply, /kept on your team/);
  await runAll(kept.runJobIds);
  assert.match(sent[0].body, /Ro is back at their desk\./);

  const reuse = await text("Is the Qwiic cable 100mm in stock at SparkFun?");
  assert.match(reuse.reply, /Ro, already on your team, has it\. Job [A-Z0-9]{4}\. I'll text the result\./);
  assert.equal(reuse.runJobIds.length, 1);
  await runAll(reuse.runJobIds);
  assert.equal(sent.length, 2);
  assert.equal(lookups, 2);
});

test("duplicate webhook deliveries are answered from the log and never repeat work", async () => {
  await linkPhone();
  const sidA = nextSid();
  const first = await text("Find a Raspberry Pi 5 4GB on Adafruit", PHONE, sidA);
  const dup = await text("Find a Raspberry Pi 5 4GB on Adafruit", PHONE, sidA);
  assert.equal(dup.duplicate, true);
  assert.equal(dup.reply, first.reply);
  assert.equal(getState(db, ws, "sample", clock)!.jobs.length, 1);
  const code = /Job ([A-Z0-9]{4})/.exec(first.reply)![1];
  const sidB = nextSid();
  const ok = await text(`APPROVE ${code}`, PHONE, sidB);
  const okDup = await text(`APPROVE ${code}`, PHONE, sidB);
  assert.equal(ok.runJobIds.length, 1);
  assert.deepEqual(okDup.runJobIds, []);
  assert.equal(okDup.reply, ok.reply);
});

test("texts act only within the linked office: other offices' codes, unknown commands, opt-out and help", async () => {
  await linkPhone();
  const other = createWorkspace(db, deps, { name: "Other office", ownerSub: "auth0|bob" });
  assert.ok(other.ok);
  // A job in Bob's office cannot be approved from Alice's phone, even with its code.
  db.prepare("INSERT INTO jobs (id, workspace_id, client_request_id, type, title, input, required_skill, status, recommended_profile_id, created_at) VALUES ('job_bob', ?, 'req-bob-0001', 'supplier_lookup', 't', '{}', 'supplier_research', 'needs_worker', 'procurement_researcher', 1)").run(other.workspace.id);
  db.prepare("INSERT INTO sms_jobs (job_id, workspace_id, code, phone, created_at) VALUES ('job_bob', ?, 'BOBB', '+16135550777', 1)").run(other.workspace.id);
  assert.match((await text("APPROVE BOBB")).reply, /There is no job BOBB in Alice’s office/);
  assert.match((await text("APPROVE")).reply, /Reply APPROVE followed by the 4-character job code/);
  assert.equal((await text("STOP")).reply, "", "Twilio handles opt-out keywords");
  assert.match((await text("HELP")).reply, /APPROVE <job code>/);
  assert.match((await text("Book the meeting room for Friday at 3pm")).reply, /No worker on your team or in the marketplace can handle that request/);
  assert.match((await text("Which items in our inventory are low on stock?")).reply, /can't be sent by text/);
  // Losing the office (reset keeps links; a deleted owner relationship unlinks).
  assert.ok(resetWorkspace(db, ws, clock).ok);
  assert.equal(listLinks(db, ws).length, 1, "reset keeps the phone link");
  db.prepare("UPDATE workspaces SET owner_sub = 'auth0|someone-else' WHERE id = ?").run(ws);
  assert.match((await text("I need a replacement part")).reply, /isn't linked/);
});

test("the office can approve an SMS job too, and the result is still texted once", async () => {
  await linkPhone();
  const r = await text("Find a Raspberry Pi 5 4GB on Adafruit");
  const job = getState(db, ws, "sample", clock)!.jobs[0];
  const h = approveHire(db, deps, ws, { profileId: "procurement_researcher", jobId: job.id });
  assert.ok(h.ok);
  await runAll(h.runJobIds);
  assert.equal(sent.length, 1);
  const code = /Job ([A-Z0-9]{4})/.exec(r.reply)![1];
  assert.match((await text(`APPROVE ${code}`)).reply, /has already finished/);
});

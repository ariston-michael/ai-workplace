// End-to-end check of "Text the Dispatcher" against a production build.
// Starts `next start` with a temporary SQLite file, an Auth0 fixture session, and local
// mocks for Twilio's Messages API, Gemini and TinyFish. Inbound texts are POSTed to the
// real webhook with real X-Twilio-Signature headers. Nothing leaves this machine.
//
//   npm run build && npm run test:sms
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer as createNetServer } from "node:net";
import { createServer as createHttpServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const root = process.cwd();
assert.ok(existsSync(path.join(root, ".next/BUILD_ID")), "Run npm run build first.");
const { encrypt } = await import(pathToFileURL(path.join(root, "node_modules/@auth0/nextjs-auth0/dist/server/cookies.js")));
const temp = mkdtempSync(path.join(tmpdir(), "sms-check-"));
const shots = process.env.SMS_SCREENSHOT_DIR;
if (shots) mkdirSync(shots, { recursive: true });
async function freePort() { const s = createNetServer(); s.listen(0, "127.0.0.1"); await once(s, "listening"); const p = s.address().port; await new Promise(r => s.close(r)); return p; }
async function mock(handler) { const port = await freePort(); const srv = createHttpServer(handler); srv.listen(port, "127.0.0.1"); await once(srv, "listening"); return { srv, url: `http://127.0.0.1:${port}` }; }

const ACCOUNT = "AC" + randomBytes(16).toString("hex"), TOKEN = randomBytes(16).toString("hex"), NUMBER = "+16135550100", PHONE = "+16135550123";
const outbound = [], tinyfishCalls = [], geminiCalls = [];
const twilioApi = await mock(async (req, res) => {
  let raw = ""; for await (const c of req) raw += c;
  const p = new URLSearchParams(raw);
  const auth = Buffer.from((req.headers.authorization ?? "").replace("Basic ", ""), "base64").toString();
  outbound.push({ path: req.url, auth, to: p.get("To"), from: p.get("From"), body: p.get("Body") });
  res.writeHead(201, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ sid: "SM" + randomBytes(16).toString("hex"), status: "queued" }));
});
const tinyfish = await mock((req, res) => { tinyfishCalls.push(req.url); res.writeHead(500); res.end(); });
// Gemini mock: proposes like the real Dispatcher would for this conversation.
const gemini = await mock(async (req, res) => {
  let raw = ""; for await (const c of req) raw += c;
  geminiCalls.push(raw);
  const prompt = JSON.parse(raw).contents[0].parts[0].text;
  const user = prompt.split("\n").filter(l => l.startsWith("User: ")).at(-1)?.slice(6) ?? "";
  const out = /raspberry pi 5 4gb/i.test(user) && /adafruit/i.test(user)
    ? { decision: "ready", jobType: "supplier_lookup", partName: "Raspberry Pi 5 4GB", supplierId: "adafruit", question: "", message: "" }
    : /replacement part/i.test(user)
      ? { decision: "follow_up", jobType: "supplier_lookup", partName: "", supplierId: "none", question: "Which part do you need, and from Adafruit, SparkFun or Digi-Key?", message: "" }
      : { decision: "unsupported", jobType: "none", partName: "", supplierId: "none", question: "", message: "I can't help with that." };
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(out) }] }, finishReason: "STOP" }] }));
});

const port = await freePort();
const base = `http://127.0.0.1:${port}`, secret = randomBytes(32).toString("hex");
const WEBHOOK = `${base}/api/sms/twilio`;
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(port), "--hostname", "127.0.0.1"], {
  cwd: root, stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env, AUTH0_DOMAIN: "local-fixture.invalid", AUTH0_CLIENT_ID: "fixture", AUTH0_CLIENT_SECRET: "fixture", AUTH0_SECRET: secret, APP_BASE_URL: base,
    WORKPLACE_DB_PATH: path.join(temp, "sms.db"), WORKPLACE_DEMO_OWNER_EMAIL: "", PROCUREMENT_MODE: "sample", PROCUREMENT_FIXTURE_DELAY_MS: "800",
    TINYFISH_API_KEY: "fixture-not-used", TINYFISH_BASE_URL: tinyfish.url,
    GEMINI_API_KEY: "fixture-gemini-key", GEMINI_BASE_URL: gemini.url,
    TWILIO_ACCOUNT_SID: ACCOUNT, TWILIO_AUTH_TOKEN: TOKEN, TWILIO_PHONE_NUMBER: NUMBER, TWILIO_WEBHOOK_URL: WEBHOOK, TWILIO_API_BASE: twilioApi.url,
  },
});
let log = ""; server.stdout.on("data", d => { log += d; }); server.stderr.on("data", d => { log += d; });
let passed = 0, browser;
const ok = (cond, name, detail = "") => { assert.ok(cond, `${name}${detail ? ` — ${String(detail).slice(0, 500)}` : ""}`); passed++; console.log(`PASS  ${name}`); };

/** POST an inbound SMS exactly as Twilio would, signed with the auth token. */
let n = 0;
async function sms(body, { from = PHONE, sid = "SM" + (++n).toString(16).padStart(32, "0"), token = TOKEN } = {}) {
  const params = { ToCountry: "CA", MessageSid: sid, SmsMessageSid: sid, AccountSid: ACCOUNT, From: from, To: NUMBER, Body: body, NumMedia: "0", NumSegments: "1", ApiVersion: "2010-04-01" };
  const signed = WEBHOOK + Object.keys(params).sort().map(k => k + params[k]).join("");
  const signature = createHmac("sha1", token).update(signed).digest("base64");
  const res = await fetch(WEBHOOK, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Twilio-Signature": signature }, body: new URLSearchParams(params) });
  const xml = await res.text();
  const reply = (/<Message>([\s\S]*)<\/Message>/.exec(xml)?.[1] ?? "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
  return { status: res.status, type: res.headers.get("content-type"), reply, sid };
}

try {
  let ready = false;
  for (let i = 0; i < 200 && !ready; i++) {
    if (server.exitCode !== null) throw new Error(log);
    try { ready = (await fetch(base + "/api/marketplace")).status === 401; } catch { await delay(100); }
  }
  ok(ready, "server is up");
  const now = Math.floor(Date.now() / 1000);
  const cookie = await encrypt({ user: { sub: "auth0|sms-owner", name: "Sam Owner", email: "sam@example.test", email_verified: true }, tokenSet: { accessToken: "fixture", expiresAt: now + 3600, scope: "openid profile email" }, internal: { sid: "sam", createdAt: now } }, secret, now + 3600);
  const as = { headers: { Cookie: `__session=${cookie}`, "Content-Type": "application/json" } };
  const ws = (await (await fetch(base + "/api/workspaces", as)).json()).primaryWorkspaceId;

  console.log("\n== Webhook security");
  ok((await sms("hello", { token: "wrong-token" })).status === 403, "an invalid signature is rejected (403)");
  const unsigned = await fetch(WEBHOOK, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "From=%2B16135550123&Body=APPROVE+ABCD" });
  ok(unsigned.status === 403, "an unsigned request is rejected (403)");
  ok((await fetch(base + `/api/workspaces/${ws}/sms`)).status === 401, "office SMS settings need sign-in");

  console.log("\n== Link the phone with a single-use code");
  const unlinked = await sms("I need a replacement part");
  ok(unlinked.status === 200 && /xml/.test(unlinked.type) && /isn't linked to an office/.test(unlinked.reply), "unlinked phone gets instructions");
  const status0 = await (await fetch(base + `/api/workspaces/${ws}/sms`, as)).json();
  ok(status0.sms.configured && status0.sms.number === NUMBER && status0.sms.links.length === 0, "office shows SMS configured, no phones yet");
  const { sms: { code } } = await (await fetch(base + `/api/workspaces/${ws}/sms`, { ...as, method: "POST", body: JSON.stringify({ action: "link_code" }) })).json();
  ok(/^\d{6}$/.test(code.code), "office issues a 6-digit link code");
  ok(/^Linked to Sam’s office/.test((await sms(`LINK ${code.code}`)).reply), "texting the code links the phone");
  ok(/invalid, used or expired/.test((await sms(`LINK ${code.code}`, { from: "+16135550999" })).reply), "the code cannot be reused");
  const links = (await (await fetch(base + `/api/workspaces/${ws}/sms`, as)).json()).sms.links;
  ok(links.length === 1 && links[0].phone === "•••0123" && !JSON.stringify(links).includes(PHONE), "office lists the masked phone only");

  console.log("\n== The conversation");
  const q = await sms("I need a replacement part");
  ok(q.reply === "Which part do you need, and from Adafruit, SparkFun or Digi-Key?", "Dispatcher asks which part and supplier", q.reply);
  const answer = await sms("Raspberry Pi 5 4GB on Adafruit");
  const jobCode = /Job ([A-Z0-9]{4})\. Reply APPROVE \1/.exec(answer.reply)?.[1];
  ok(jobCode && /Ro, Procurement Researcher \(official\), \$6\.00 \/ hour, billed per second/.test(answer.reply), "hire needed: worker name, rate and job code are texted", answer.reply);
  const redelivered = await sms("Raspberry Pi 5 4GB on Adafruit", { sid: answer.sid });
  ok(redelivered.reply === answer.reply, "a duplicate delivery gets the same reply");
  let state = (await (await fetch(base + `/api/workspaces/${ws}`, as)).json()).state;
  ok(state.jobs.length === 1 && state.jobs[0].status === "needs_worker" && state.jobs[0].sms.code === jobCode, "exactly one job, waiting for approval");

  console.log("\n== Approve by text (twice, and a duplicate delivery)");
  const approve = await sms(`APPROVE ${jobCode}`);
  ok(new RegExp(`Approved\\. Ro \\(Procurement Researcher\\) is hired for this job only and starting job ${jobCode}`).test(approve.reply), "APPROVE hires and starts the job", approve.reply);
  const approveDup = await sms(`APPROVE ${jobCode}`, { sid: approve.sid });
  ok(approveDup.reply === approve.reply, "duplicate APPROVE delivery is answered from the log");
  const approveAgain = await sms(`approve ${jobCode}`);
  ok(/already approved and assigned to Ro|has already finished/.test(approveAgain.reply), "a repeated APPROVE starts nothing", approveAgain.reply);

  for (let i = 0; i < 100 && outbound.length === 0; i++) await delay(100);
  await delay(1500); // give any duplicate run or text a chance to appear
  state = (await (await fetch(base + `/api/workspaces/${ws}`, as)).json()).state;
  const job = state.jobs[0];
  ok(state.jobs.length === 1 && job.status === "completed" && job.report.mode === "sample", "the job completed once with a SAMPLE report");
  ok(job.events.filter(e => e.text === "Left the desk to start work.").length === 1, "the job ran exactly once");
  ok(outbound.length === 1, "exactly one result text was sent", JSON.stringify(outbound));
  const out = outbound[0];
  ok(out.to === PHONE && out.from === NUMBER && out.auth === `${ACCOUNT}:${TOKEN}` && out.path === `/2010-04-01/Accounts/${ACCOUNT}/Messages.json`, "sent via the Twilio Messages API from the Twilio number");
  ok(new RegExp(`^SAMPLE result, job ${jobCode}: `).test(out.body) && /Fixture data, not a live stock check\./.test(out.body) && /Source: https:\/\/www\.adafruit\.com\//.test(out.body), "result is labeled SAMPLE with its source", out.body);
  ok(/Ro delivered the report and left the office/.test(out.body), "result says the job-only worker left");
  ok(job.events.some(e => e.actor === "SMS" && /^Texted the SAMPLE result to •••0123\./.test(e.text)), "the text is recorded in the job history");
  const history = (await (await fetch(base + `/api/workflow?workspace=${ws}&job=${job.id}`, as)).json());
  const saved = (history.jobs ?? []).find(j => j.id === job.id);
  ok(saved && saved.report.id === job.report.id && saved.sms.code === jobCode, "the same job and report are in workflow history", JSON.stringify(history).slice(0, 300));

  console.log("\n== Zero provider calls");
  ok(tinyfishCalls.length === 0, "TinyFish calls: 0");
  ok(geminiCalls.length === 2, "Gemini mock called once per Dispatcher message (2), not for links, approvals or duplicates", geminiCalls.length);

  console.log("\n== Office shows the SMS panel and the job code");
  const chrome = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? (existsSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome") ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : undefined);
  browser = await chromium.launch({ executablePath: chrome, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
  await ctx.addCookies([{ name: "__session", value: cookie, url: base }]);
  const page = await ctx.newPage();
  await page.goto(`${base}/office?workspace=${ws}`);
  await page.getByRole("heading", { name: "Text the Dispatcher" }).or(page.locator("#sms-title")).first().waitFor();
  ok(/•••0123 · linked/.test(await page.locator(".office-sms").innerText()), "office lists the linked phone");
  await page.getByRole("button", { name: "Link another phone" }).click();
  await page.locator(".office-smsCodeValue").waitFor();
  ok(/^LINK \d{6}$/.test((await page.locator(".office-smsCodeValue").innerText()).trim()), "office shows a new single-use code");
  ok(new RegExp(`Requested by text from •••0123 · job code ${jobCode}`).test(await page.locator(".office-jobCard").first().innerText()), "job card shows it came by text");
  if (shots) await page.screenshot({ path: path.join(shots, "office-sms.png"), fullPage: true });

  console.log(`\nALL ${passed} CHECKS PASSED`);
} catch (err) {
  console.error(err);
  console.error(log.split("\n").slice(-30).join("\n"));
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
  for (const m of [twilioApi, tinyfish, gemini]) m.srv.close();
  rmSync(temp, { recursive: true, force: true });
}

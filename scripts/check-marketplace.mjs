// Reproducible production-browser check. Auth identities are SDK-encrypted fixtures;
// the action itself runs for real. No production secrets or user database are used.
import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const root = process.cwd();
assert.ok(existsSync(path.join(root, ".next/BUILD_ID")), "Run npm run build first.");
const { encrypt } = await import(pathToFileURL(path.join(root, "node_modules/@auth0/nextjs-auth0/dist/server/cookies.js")));
const temp = mkdtempSync(path.join(tmpdir(), "marketplace-browser-"));
const socket = createServer(); socket.listen(0, "127.0.0.1"); await once(socket, "listening");
const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
const base = `http://127.0.0.1:${port}`, secret = randomBytes(32).toString("hex");
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(port), "--hostname", "127.0.0.1"], {
  cwd: root, env: { ...process.env, AUTH0_DOMAIN: "local-fixture.invalid", AUTH0_CLIENT_ID: "fixture", AUTH0_CLIENT_SECRET: "fixture", AUTH0_SECRET: secret, APP_BASE_URL: base, WORKPLACE_DB_PATH: path.join(temp, "private.db"), WORKPLACE_DEMO_OWNER_EMAIL: "", PROCUREMENT_MODE: "sample" }, stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "", browser;
server.stdout.on("data", data => { serverLog += data; }); server.stderr.on("data", data => { serverLog += data; });
try {
  let ready = false;
  for (let i = 0; i < 200; i++) {
    if (server.exitCode !== null) throw new Error(`Test server exited: ${serverLog}`);
    try { ready = (await fetch(base + "/api/marketplace")).status === 401; } catch { /* server still booting */ }
    if (ready) break; await delay(100);
  }
  assert.ok(ready, "Test server did not become ready.");
  const chrome = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? (existsSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome") ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : undefined);
  browser = await chromium.launch({ executablePath: chrome, headless: true });
  async function account(name, viewport = { width: 1440, height: 1100 }) {
    const context = await browser.newContext({ viewport });
    const now = Math.floor(Date.now() / 1000);
    const value = await encrypt({ user: { sub: `auth0|marketplace-${name}`, name, email: `${name}@example.test`, email_verified: true }, tokenSet: { accessToken: "fixture", expiresAt: now + 3600, scope: "openid profile email" }, internal: { sid: name, createdAt: now } }, secret, now + 3600);
    await context.addCookies([{ name: "__session", value, url: base, httpOnly: true, sameSite: "Lax" }]);
    return context;
  }
  const alice = await account("Alice"), bob = await account("Bob"), anonymous = await browser.newContext();
  assert.equal((await anonymous.request.get(base + "/api/marketplace")).status(), 401);
  assert.equal((await anonymous.request.post(base + "/api/marketplace", { data: {} })).status(), 401);
  assert.equal((await anonymous.request.get(base + "/marketplace", { maxRedirects: 0 })).status(), 307);
  const pageA = await alice.newPage(), pageB = await bob.newPage(), pageErrors = [];
  for (const page of [pageA, pageB]) page.on("pageerror", e => pageErrors.push(e.message));
  await pageA.goto(base + "/marketplace");
  await pageA.locator(".marketplace-official").first().waitFor();
  await pageA.getByText("Publish an agent", { exact: true }).click();
  await pageA.getByLabel("Agent name", { exact: true }).fill("Shelf Scout");
  await pageA.getByLabel("Description", { exact: true }).fill("Checks the inventory CSV submitted by the hirer and calculates restock quantities.");
  await pageA.getByLabel("Pixel avatar", { exact: true }).selectOption("procurement_researcher");
  await pageA.getByLabel("Demo hourly rate ($)", { exact: true }).fill("6.50");
  await pageA.getByLabel("Low-stock minimum", { exact: true }).fill("5");
  await pageA.getByLabel("Restock target", { exact: true }).fill("12");
  await pageA.getByLabel("Publish with these permissions", { exact: true }).check();
  const publication = pageA.waitForResponse(r => r.url() === base + "/api/marketplace" && r.request().method() === "POST");
  await pageA.getByRole("button", { name: "Publish community agent", exact: true }).click();
  const pubResponse = await publication, published = await pubResponse.json();
  assert.equal(pubResponse.status(), 201); assert.equal(published.ok, true);
  const listing = published.profile;
  assert.equal(listing.listing.creatorName, "Alice"); assert.equal(listing.listing.official, false);
  assert.equal(listing.avatarId, "procurement_researcher");
  await pageA.locator(`[data-listing-id="${listing.id}"]`).getByText("Community agent", { exact: true }).waitFor();
  assert.equal(await pageA.locator(".marketplace-official").count(), 2);
  const publishBody = JSON.parse(pubResponse.request().postData());
  for (const extra of [{ official: true }, { publisherKind: "company" }, { creatorSub: "auth0|marketplace-Bob" }, { action: { id: "arbitrary_url", url: "https://example.com" } }]) {
    assert.equal((await alice.request.post(base + "/api/marketplace", { data: { ...publishBody, ...extra } })).status(), 400);
  }
  const officesA = await (await alice.request.get(base + "/api/workspaces")).json();
  const officesB = await (await bob.request.get(base + "/api/workspaces")).json();
  const wsA = officesA.primaryWorkspaceId, wsB = officesB.primaryWorkspaceId;
  assert.notEqual(wsA, wsB);
  await pageB.goto(base + "/");
  await pageB.getByRole("heading", { name: "Workspaces", exact: true }).waitFor();
  await pageB.getByRole("link", { name: /Agent marketplace/ }).click();
  await pageB.getByLabel("Hire into your office", { exact: true }).selectOption(wsB);
  await pageB.locator(`[data-listing-id="${listing.id}"]`).getByRole("link", { name: /Review hire in office/ }).click();
  const candidate = pageB.locator(".office-candidate").filter({ has: pageB.getByRole("heading", { name: "Shelf Scout", exact: true }) });
  await candidate.getByText("Community agent · by Alice", { exact: true }).waitFor();
  const hiredResponse = pageB.waitForResponse(r => r.url() === base + `/api/workspaces/${wsB}/hires` && r.request().method() === "POST");
  await candidate.getByRole("button", { name: /Hire Shelf Scout/ }).click();
  const hired = await (await hiredResponse).json(); assert.equal(hired.ok, true);
  const worker = pageB.locator(`[data-worker-id="${hired.hireId}"]`);
  await pageB.waitForFunction(id => { const el = document.querySelector(`[data-worker-id="${id}"]`); return el?.dataset.mapStop === "workstation" && el.dataset.travel === "idle"; }, hired.hireId);
  assert.equal(await worker.locator(".office-character-procurement_researcher").count(), 1);
  const csv = 'sku,quantity\nBOB-PRIVATE-BOLT,3\nMOTOR,14\nWASHER,0';
  await pageB.getByLabel("Inventory CSV", { exact: true }).fill(csv);
  const execution = pageB.waitForResponse(r => r.url().includes(`/agents/${hired.hireId}/jobs`) && r.request().method() === "POST");
  await pageB.getByRole("button", { name: "Run inventory audit", exact: true }).click();
  const executedResponse = await execution, executed = await executedResponse.json(); assert.equal(executed.ok, true);
  await pageB.getByRole("link", { name: "View report", exact: true }).waitFor();
  await pageB.getByRole("link", { name: "View report", exact: true }).click();
  const evidence = pageB.getByRole("region", { name: "Inventory audit evidence", exact: true }).first();
  assert.match(await evidence.innerText(), /EXECUTED LOCALLY/); assert.match(await evidence.innerText(), /3 SKUs checked · 2 below minimum · 21 restock units/);
  assert.match(await evidence.innerText(), /BOB-PRIVATE-BOLT/);
  const ownHistory = await (await bob.request.get(base + `/api/workflow?workspace=${wsB}`)).json();
  const report = ownHistory.jobs.find(j => j.id === executed.jobId).report;
  assert.equal(report.mode, "local"); assert.equal(report.body.result.inputSha256, createHash("sha256").update(csv).digest("hex"));
  assert.deepEqual(report.body.result.rows.map(r => r.restockUnits), [9, 0, 12]);
  const retry = await (await bob.request.post(executedResponse.url(), { data: JSON.parse(executedResponse.request().postData()) })).json();
  assert.equal(retry.jobId, executed.jobId);
  assert.equal((await (await bob.request.get(base + `/api/workflow?workspace=${wsB}`)).json()).jobs.length, 1);
  await pageB.locator("#office-panel").getByRole("link", { name: /View latest job/ }).click();
  await pageB.locator("#selected-job-title").waitFor();
  assert.match(await pageB.locator(".workflow-detail").innerText(), /EXECUTED LOCALLY/);
  for (const url of [`/api/workspaces/${wsB}`, `/api/workflow?workspace=${wsB}&job=${executed.jobId}`]) assert.equal((await alice.request.get(base + url)).status(), 404);
  const actionBody = { csv: "sku,quantity\nATTACK,1", clientRequestId: "cross-account-attack" };
  assert.equal((await alice.request.post(executedResponse.url(), { data: actionBody })).status(), 404);
  assert.equal((await alice.request.post(base + `/api/workspaces/${wsA}/agents/${hired.hireId}/jobs`, { data: actionBody })).status(), 404);
  assert.equal((await anonymous.request.post(executedResponse.url(), { data: actionBody })).status(), 401);
  const publicCatalog = await (await alice.request.get(base + "/api/marketplace")).text();
  assert.ok(!publicCatalog.includes("BOB-PRIVATE-BOLT")); assert.ok(!publicCatalog.includes("auth0|marketplace-"));
  assert.ok(!(await (await alice.request.get(base + "/api/workspaces")).text()).includes(wsB));
  await pageA.goto(base + `/office?workspace=${wsB}`); await pageA.getByText("OFFICE UNAVAILABLE", { exact: true }).waitFor();
  assert.equal(await pageA.locator(".office-pixelMap").count(), 0);
  await pageA.goto(base + `/workflow?workspace=${wsB}&job=${executed.jobId}`); await pageA.locator(".workflow-error").waitFor();
  assert.equal(await pageA.locator("#selected-job-title").count(), 0); assert.ok(!(await pageA.locator("body").innerText()).includes("BOB-PRIVATE-BOLT"));
  const mobileContext = await account("Bob", { width: 390, height: 844 }), mobile = await mobileContext.newPage();
  mobile.on("pageerror", e => pageErrors.push(e.message));
  await mobile.goto(base + "/marketplace"); await mobile.locator(`[data-listing-id="${listing.id}"]`).waitFor();
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await mobile.goto(base + `/office?workspace=${wsB}`);
  await mobile.locator(`[data-worker-id="${hired.hireId}"]`).click();
  await mobile.getByRole("link", { name: "View report", exact: true }).click();
  await mobile.getByRole("region", { name: "Inventory audit evidence", exact: true }).first().waitFor();
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  if (process.env.MARKETPLACE_SCREENSHOT_DIR) {
    mkdirSync(process.env.MARKETPLACE_SCREENSHOT_DIR, { recursive: true });
    await mobile.locator("#office-panel").screenshot({ path: path.join(process.env.MARKETPLACE_SCREENSHOT_DIR, "community-agent-mobile.png") });
    await pageB.locator(".workflow-detail").screenshot({ path: path.join(process.env.MARKETPLACE_SCREENSHOT_DIR, "community-agent-workflow.png") });
  }
  assert.deepEqual(pageErrors, []);
  console.log("PASS: A publishes → B discovers and hires into its office → a real local CSV audit yields a private, source-traceable report and workflow.");
  console.log("PASS: official/creator/action spoofing rejected; duplicate execution is idempotent; publisher cannot list, read or run the hirer's private work; anonymous access denied.");
  console.log("PASS: desktop and mobile marketplace, selected avatar, worker profile, and one-click report.");
} catch (error) { console.error(serverLog); throw error; }
finally { await browser?.close(); if (server.exitCode === null) { server.kill("SIGTERM"); await once(server, "exit").catch(() => {}); } rmSync(temp, { recursive: true, force: true }); }

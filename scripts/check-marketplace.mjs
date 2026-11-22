// Reproducible production-browser check for the marketplace and the Gemini Dispatcher.
// Starts its own `next start`, a temporary SQLite file, two SDK-encrypted Auth0 fixture
// sessions and a local mock of the Gemini generateContent endpoint. It never touches a
// real user's database, Auth0 tenant, Gemini key or TinyFish credits (procurement is SAMPLE).
//
//   npm run build && npm run test:marketplace
//   MARKETPLACE_SCREENSHOT_DIR=/tmp/shots npm run test:marketplace   # optional screenshots
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
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
const temp = mkdtempSync(path.join(tmpdir(), "workplace-browser-"));
const shots = process.env.MARKETPLACE_SCREENSHOT_DIR;
if (shots) mkdirSync(shots, { recursive: true });
const shot = async (page, name) => { if (shots) await page.screenshot({ path: path.join(shots, `${name}.png`) }); };
async function freePort() {
  const s = createNetServer(); s.listen(0, "127.0.0.1"); await once(s, "listening");
  const port = s.address().port; await new Promise(r => s.close(r)); return port;
}

// --- mock Gemini: answers like the real API, records every request body -------------
const geminiBodies = [];
const answer = (o) => ({ decision: "ready", jobType: "none", partName: "", supplierId: "none", question: "", message: "", ...o });
function decide(prompt) {
  const user = prompt.split("\n").filter(l => l.startsWith("User: ")).at(-1)?.slice(6) ?? "";
  if (/raspberry pi 5 4gb/i.test(user) && /adafruit/i.test(user)) return answer({ jobType: "supplier_lookup", partName: "Raspberry Pi 5 4GB", supplierId: "adafruit" });
  if (/qwiic/i.test(user)) return answer({ jobType: "supplier_lookup", partName: "Qwiic cable 100mm", supplierId: "sparkfun" });
  if (/inventory|low on stock/i.test(user) || /CSV attached: yes/.test(prompt)) return answer({ jobType: "inventory_audit" });
  if (/\border\b|pay/i.test(user)) return answer({ decision: "unsupported", message: "I can't place orders or make payments." });
  return answer({ decision: "follow_up", question: "Do you need a part sourced, a camera checked, or an inventory audit?" });
}
const gemini = createHttpServer(async (req, res) => {
  let raw = ""; for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  geminiBodies.push({ url: req.url, key: req.headers["x-goog-api-key"], body: raw });
  const text = JSON.stringify(decide(body.contents[0].parts[0].text));
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }] }));
});
const geminiPort = await freePort();
gemini.listen(geminiPort, "127.0.0.1"); await once(gemini, "listening");

const port = await freePort();
const base = `http://127.0.0.1:${port}`, secret = randomBytes(32).toString("hex");
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(port), "--hostname", "127.0.0.1"], {
  cwd: root, stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env, AUTH0_DOMAIN: "local-fixture.invalid", AUTH0_CLIENT_ID: "fixture", AUTH0_CLIENT_SECRET: "fixture", AUTH0_SECRET: secret,
    APP_BASE_URL: base, WORKPLACE_DB_PATH: path.join(temp, "private.db"), WORKPLACE_DEMO_OWNER_EMAIL: "", PROCUREMENT_MODE: "sample",
    PROCUREMENT_FIXTURE_DELAY_MS: "2500", TINYFISH_API_KEY: "", TINYFISH_BASE_URL: "http://127.0.0.1:9",
    GEMINI_API_KEY: "fixture-gemini-key", GEMINI_MODEL: "gemini-3.5-flash-lite", GEMINI_BASE_URL: `http://127.0.0.1:${geminiPort}`,
  },
});
let serverLog = "", browser;
server.stdout.on("data", d => { serverLog += d; }); server.stderr.on("data", d => { serverLog += d; });
let passed = 0;
const ok = (cond, name, detail = "") => { assert.ok(cond, `${name}${detail ? ` — ${String(detail).slice(0, 400)}` : ""}`); passed++; console.log(`PASS  ${name}`); };

try {
  let ready = false;
  for (let i = 0; i < 200 && !ready; i++) {
    if (server.exitCode !== null) throw new Error(`Test server exited: ${serverLog}`);
    try { ready = (await fetch(base + "/api/marketplace")).status === 401; } catch { await delay(100); }
  }
  ok(ready, "test server is up");
  const chrome = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? (existsSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome") ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : undefined);
  browser = await chromium.launch({ executablePath: chrome, headless: true });
  async function account(name, viewport = { width: 1440, height: 1100 }) {
    const context = await browser.newContext({ viewport });
    const now = Math.floor(Date.now() / 1000);
    const value = await encrypt({ user: { sub: `auth0|check-${name}`, name, email: `${name}@example.test`, email_verified: true }, tokenSet: { accessToken: "fixture", expiresAt: now + 3600, scope: "openid profile email" }, internal: { sid: name, createdAt: now } }, secret, now + 3600);
    await context.addCookies([{ name: "__session", value, url: base, httpOnly: true, sameSite: "Lax" }]);
    return context;
  }
  const alice = await account("Alice"), bob = await account("Bob"), anonymous = await browser.newContext();

  console.log("\n== Signed out");
  ok((await anonymous.request.get(base + "/api/marketplace")).status() === 401, "anon GET /api/marketplace → 401");
  ok((await anonymous.request.post(base + "/api/marketplace/listings", { data: {} })).status() === 401, "anon publish → 401");
  ok((await anonymous.request.post(base + "/api/workspaces/x/hires/y", { data: {} })).status() === 401, "anon hire update → 401");
  ok((await anonymous.request.get(base + "/marketplace", { maxRedirects: 0 })).status() === 307, "anon /marketplace redirects to sign-in");

  const pageA = await alice.newPage(), pageB = await bob.newPage(), pageErrors = [];
  for (const p of [pageA, pageB]) p.on("pageerror", e => pageErrors.push(e.message));
  await pageB.addInitScript(() => {
    window.__retroTrace = []; window.__retroCollisions = [];
    const ownChair = { "workstation-01": "chair-inspector", "desk-02": "chair-02", "desk-03": "chair-03" };
    let frame = 0;
    const tick = () => {
      const floor = document.querySelector(".office-pixelMap");
      if (floor && frame++ % 2 === 0) {
        const furniture = [...floor.querySelectorAll("[data-furniture]")].map(el => ({ id: el.dataset.furniture, rect: el.getBoundingClientRect() }));
        for (const el of floor.querySelectorAll('[data-worker-id][data-positioned="true"]')) {
          const rect = el.querySelector(".office-mapSprite").getBoundingClientRect();
          window.__retroTrace.push({ id: el.dataset.workerId, stop: el.dataset.mapStop, travel: el.dataset.travel, destination: el.dataset.destination, facing: el.dataset.facing });
          for (const item of furniture) {
            if (item.id === ownChair[el.dataset.desk]) continue;
            if (Math.min(rect.right, item.rect.right) - Math.max(rect.left, item.rect.left) > .75 && Math.min(rect.bottom, item.rect.bottom) - Math.max(rect.top, item.rect.top) > .75 && window.__retroCollisions.length < 20) window.__retroCollisions.push({ worker: el.dataset.workerId, furniture: item.id });
          }
        }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  console.log("\n== Alice publishes an inventory agent with the sprite builder");
  await pageA.goto(base + "/marketplace");
  await pageA.locator(".market-card").first().waitFor();
  ok(await pageA.locator('.market-card[data-kind="official"] .market-cardTitle .pixel-verified[role="img"]').count() === 4, "official listings show the blue pixel check");
  await pageA.getByRole("button", { name: /^Publish agent/ }).click();
  const dlg = pageA.getByRole("dialog", { name: "Publish an agent" });
  await dlg.getByLabel("Character name").fill("Shelf Scout");
  await dlg.getByLabel("Role").fill("Inventory Auditor");
  await dlg.getByLabel("Specialty").fill("Checks the inventory CSV you submit and calculates restock quantities.");
  await dlg.getByLabel("Greeting").fill("Hand me a stock sheet.");
  await dlg.locator('label.market-chip:has-text("Inventory audit")').click();
  await dlg.getByLabel("Low-stock minimum").fill("5");
  await dlg.getByLabel("Restock target").fill("12");
  await dlg.getByLabel(/Hourly rate/).fill("6.5");
  await dlg.getByLabel("Sample work").fill("Audited 40 SKUs and flagged 6 for restock.");
  await dlg.locator('fieldset:has(legend:text-is("Hair")) label:has-text("Beanie")').click();
  await dlg.locator('fieldset:has(legend:text-is("Accessory")) label:has-text("Glasses")').click();
  await dlg.locator('fieldset:has(legend:text-is("Outfit")) label[title="Navy"]').click();
  await shot(pageA, "1-publish");
  await dlg.getByRole("button", { name: "Publish to Community" }).click();
  const scoutCard = pageA.locator('.market-card:has(h2:text-is("Shelf Scout"))');
  await scoutCard.waitFor();
  const cardText = await scoutCard.innerText();
  ok(/Community · by Alice \(you\) · not verified/.test(cardText) && /low stock below 5, restock to 12/.test(cardText), "community card shows creator and action", cardText);
  ok(await scoutCard.locator(".market-cardTitle .pixel-verified").count() === 0, "no official check on a community listing");
  const spoof = await alice.request.post(base + "/api/marketplace/listings", { data: { clientRequestId: "spoof-request-1", listing: { official: true, characterName: "Fake" } } });
  ok(spoof.status() === 400, "spoofed official badge is rejected");
  const listings = (await (await bob.request.get(base + "/api/marketplace")).json()).listings;
  const scout = listings.find(l => l.characterName === "Shelf Scout");
  ok(scout && !JSON.stringify(listings).includes("auth0|"), "listing visible to Bob without creator ids");

  console.log("\n== Bob hires Shelf Scout from the dashboard (workspace picker) and runs an audit");
  await pageB.goto(base + "/");
  await pageB.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Marketplace" }).click();
  await pageB.getByRole("radio", { name: /Community/ }).click();
  const marketSouth = await pageB.locator('.market-card:has(h2:text-is("Shelf Scout")) .office-facing-south').first().innerHTML();
  await pageB.getByRole("button", { name: "Hire Shelf Scout" }).click();
  const hd = pageB.getByRole("dialog", { name: /Hire Shelf Scout/ });
  ok(await hd.getByRole("radio", { name: /Keep on team/ }).isChecked(), "hiring without a job keeps the worker on the team");
  await hd.getByRole("button", { name: /^Hire into/ }).click();
  await pageB.waitForURL(/\/office\?workspace=.*&arrived=/);
  const wsB = new URL(pageB.url()).searchParams.get("workspace");
  const scoutWalker = pageB.locator('.office-mapWalker:has-text("Inventory Auditor")');
  await scoutWalker.waitFor();
  ok(await scoutWalker.locator(".office-facing-south").first().innerHTML() === marketSouth, "the hired sprite is pixel-identical to the marketplace card");
  await pageB.waitForURL(new RegExp(`/office\\?workspace=${wsB}$`));
  await scoutWalker.click();
  const csv = "sku,quantity\nBOB-PRIVATE-BOLT,3\nMOTOR,14\nWASHER,0";
  await pageB.locator("#office-panel").getByLabel("Inventory CSV", { exact: true }).fill(csv);
  await pageB.getByRole("button", { name: "Run inventory audit" }).click();
  await pageB.locator("#office-panel").getByRole("link", { name: "View report" }).waitFor({ timeout: 20000 });
  await pageB.locator("#office-panel").getByRole("link", { name: "View report" }).click();
  const evidence = await pageB.getByRole("region", { name: "Inventory audit evidence" }).first().innerText();
  ok(/3 SKUs checked · 2 below minimum · 21 restock units/.test(evidence) && /EXECUTED LOCALLY/.test(evidence), "real local audit with the published thresholds", evidence);

  console.log("\n== Gemini Dispatcher: job-only hire, meter, return, departure");
  await pageB.getByRole("button", { name: /Reception: Dispatcher/ }).click();
  ok(/DISPATCHER: GEMINI · gemini-3\.5-flash-lite/.test(await pageB.locator(".office-headerBadges").innerText()), "office shows the Gemini Dispatcher badge");
  const request = pageB.getByLabel("What do you need help with?");
  await request.fill("Could you find a Raspberry Pi 5 4GB on Adafruit?");
  await pageB.getByRole("button", { name: /Send to Dispatcher/ }).click();
  const rec = pageB.getByRole("region", { name: "Dispatcher recommendation" }).or(pageB.locator('[aria-label="Dispatcher recommendation"]')).first();
  await rec.waitFor();
  const jobId1 = await pageB.locator(".office-jobCard").first().getAttribute("data-job-id");
  const jobCard = pageB.locator(`.office-jobCard[data-job-id="${jobId1}"]`);
  ok(/Understood \(Gemini gemini-3\.5-flash-lite\) as Supplier research/.test(await jobCard.locator(".office-jobHistory").textContent()), "job history records the Gemini interpretation");
  ok(await rec.getByRole("radio", { name: /For this job/ }).isChecked(), "approval defaults to For this job");
  await rec.getByLabel(/Instructions for Ro/).fill("Note the price.");
  await shot(pageB, "2-recommendation");
  await rec.getByRole("button", { name: /Approve hire/ }).click();
  const ro = pageB.locator('.office-mapWalker:has-text("Procurement Researcher")');
  await ro.waitFor();
  const roId = await ro.getAttribute("data-worker-id");
  await jobCard.locator('.office-meter[data-meter="running"]').waitFor({ timeout: 10000 });
  ok(true, "demo meter runs while the job executes");
  await shot(pageB, "3-meter-running");
  await jobCard.locator('.office-meter[data-meter="stopped"]').waitFor({ timeout: 20000 });
  const meterText = (await jobCard.locator(".office-meter").innerText()).replace(/\s+/g, " ");
  ok(/^Demo meter stopped: \$\d+\.\d\d · \d+\.\d s at \$6\.00 \/ hour$/.test(meterText.trim()), "meter stops when execution finishes", meterText);
  let sawReception = false, sawDoor = false;
  for (let i = 0; i < 120 && !(sawDoor); i++) {
    const el = pageB.locator(`[data-worker-id="${roId}"]`);
    if (!(await el.count())) { sawDoor = true; break; }
    const stop = await el.getAttribute("data-map-stop"), dest = await el.getAttribute("data-destination");
    if (stop === "reception") sawReception = true;
    if (dest === "door" || (await el.getAttribute("data-gone"))) sawDoor = true;
    await delay(100);
  }
  ok(sawReception, "worker brings the report to reception");
  ok(sawDoor, "job-only worker then walks out the door");
  await pageB.locator(`[data-worker-id="${roId}"]`).waitFor({ state: "detached", timeout: 15000 });
  ok(true, "job-only worker is gone from the map");
  const temporaryTrace = await pageB.evaluate(() => ({ trace: window.__retroTrace, collisions: window.__retroCollisions }));
  ok(temporaryTrace.trace.some(e => e.id === roId && e.stop === "reception" && e.travel === "handover"), "job-only report handover is visible before exit");
  ok(temporaryTrace.collisions.length === 0, "larger workers clear all desks and cubicle walls", JSON.stringify(temporaryTrace.collisions));
  await shot(pageB, "4-after-departure");
  const stateB = await (await bob.request.get(base + `/api/workspaces/${wsB}`)).json();
  const roFormer = stateB.state.formerHires.find(h => h.id === roId);
  ok(roFormer && roFormer.departedAt && !stateB.state.team.some(h => h.id === roId), "saved as a former hire");
  ok(roFormer.instructions === "Note the price." && roFormer.history.map(e => e.kind).join(",") === "hired,instructions,assigned,returned,departed", "hire instructions and history saved", roFormer.history.map(e => e.kind));
  ok(/left the office/.test(await jobCard.innerText()), "job card notes the worker left");
  await jobCard.getByRole("link", { name: /View this job’s workflow/ }).click();
  await pageB.locator("#selected-job-title").waitFor();
  ok(/SAMPLE/.test(await pageB.locator(".workflow-detail").innerText()), "report still in workflow history after departure");
  await pageB.goBack();

  console.log("\n== Keep on team while running; retained worker returns to its desk and is reused");
  // Wait for the office to load (and hydrate) before typing.
  await pageB.locator(".office-jobCard").first().waitFor();
  await pageB.locator(".office-mapWalker").first().waitFor();
  await pageB.getByLabel("What do you need help with?").fill("Is the Qwiic cable 100mm in stock at SparkFun?");
  await pageB.getByRole("button", { name: /Send to Dispatcher/ }).click();
  const rec2 = pageB.locator('[aria-label="Dispatcher recommendation"]').first();
  await rec2.waitFor();
  ok(true, "job-only Ro was not reused: a new recommendation appears");
  const jobCard2 = pageB.locator(`.office-jobCard[data-job-id="${await pageB.locator(".office-jobCard").first().getAttribute("data-job-id")}"]`);
  await rec2.getByRole("button", { name: /Approve hire/ }).click();
  const keep = pageB.getByRole("button", { name: "Keep Ro on team" });
  await keep.waitFor();
  await keep.click();
  await jobCard2.locator('.office-meter[data-meter="stopped"]').waitFor({ timeout: 20000 });
  const ro2 = pageB.locator('.office-mapWalker:has-text("Procurement Researcher")');
  const ro2Id = await ro2.getAttribute("data-worker-id");
  let backAtDesk = false, visitedReception = false;
  for (let i = 0; i < 150 && !backAtDesk; i++) {
    const stop = await ro2.getAttribute("data-map-stop");
    if (stop === "reception") visitedReception = true;
    if (visitedReception && stop === "workstation" && (await ro2.getAttribute("data-travel")) === "idle") backAtDesk = true;
    await delay(100);
  }
  ok(visitedReception && backAtDesk, "kept worker returns to reception, then its desk");
  ok((await ro2.getAttribute("data-retention")) === "team", "worker is kept on the team");
  const retainedTrace = await pageB.evaluate(() => ({ trace: window.__retroTrace, collisions: window.__retroCollisions }));
  ok(retainedTrace.trace.some(e => e.id === ro2Id && e.stop === "reception" && e.travel === "handover"), "retained worker visibly hands over the report");
  ok(retainedTrace.collisions.length === 0, "retained worker avoids cubicle walls on its return", JSON.stringify(retainedTrace.collisions));
  await pageB.locator('.office-mapStation:has([data-furniture="desk-03"])').click();
  await pageB.getByRole("region", { name: "Desk details", exact: true }).waitFor();
  ok(/Occupied/.test(await pageB.getByRole("region", { name: "Desk details", exact: true }).innerText()), "clicking an occupied cubicle opens desk details");
  await pageB.getByRole("button", { name: /^Reception: Dispatcher/ }).click();
  ok(await pageB.evaluate(() => visualViewport.scale === 1 && Number(getComputedStyle(document.documentElement).zoom) === 1), "office preview uses normal 100% zoom");
  ok(await ro2.locator(".office-mapSprite").evaluate(el => Math.round(el.getBoundingClientRect().width) === 39), "workers are 50% larger on the map");
  console.log("Preview build:", await pageB.locator(".office-office").getAttribute("data-preview-branch"), await pageB.locator(".office-office").getAttribute("data-preview-commit"));
  await pageB.waitForFunction(() => [...document.querySelectorAll(".office-mapWalker")].every(el => el.dataset.mapStop === "workstation" && el.dataset.travel === "idle"), { timeout: 30000 });
  if (shots) {
    await pageB.locator(".office-officeCard").screenshot({ path: path.join(shots, "office-retro-full.png") });
    await pageB.evaluate(() => scrollTo(0, 0));
    await pageB.screenshot({ path: path.join(shots, "office-retro-desktop.png") });
  }
  await pageB.getByLabel("What do you need help with?").fill("Find a Raspberry Pi 5 4GB on Adafruit please");
  const reuseResponse = pageB.waitForResponse(r => r.url().endsWith(`/api/workspaces/${wsB}/jobs`) && r.request().method() === "POST");
  await pageB.getByRole("button", { name: /Send to Dispatcher/ }).click();
  const reusedJob = await (await reuseResponse).json();
  await pageB.locator(`.office-jobCard[data-job-id="${reusedJob.jobId}"]`).waitFor();
  await pageB.waitForFunction(() => document.querySelector(".office-requestDock textarea")?.value === "");
  const reuse = (await (await bob.request.get(base + `/api/workspaces/${wsB}`)).json()).state.jobs[0];
  ok(reuse.hireId === ro2Id && reuse.status !== "needs_worker", "the kept worker is reused first, no new hire", reuse.status);

  console.log("\n== Inventory request through the Dispatcher; the CSV never reaches Gemini");
  await pageB.getByLabel("What do you need help with?").fill("Which items in our inventory are low on stock?");
  await pageB.getByRole("button", { name: /Send to Dispatcher/ }).click();
  await pageB.getByText(/Attach the inventory CSV/).first().waitFor();
  await pageB.getByLabel("Inventory CSV (header sku,quantity)").fill("sku,quantity\nSECRET-SKU-42,1\nNUT,40");
  await pageB.getByLabel("Your answer").fill("Here it is");
  await pageB.getByRole("button", { name: /Answer the Dispatcher/ }).click();
  await pageB.getByText(/Understood as Inventory audit/).waitFor();
  const inv = (await (await bob.request.get(base + `/api/workspaces/${wsB}`)).json()).state.jobs[0];
  ok(inv.type === "inventory_audit" && inv.hireRole === "Inventory Auditor", "inventory job goes to the kept Shelf Scout");
  ok(geminiBodies.length >= 5 && geminiBodies.every(b => !b.body.includes("SECRET-SKU-42") && !b.body.includes("BOB-PRIVATE-BOLT")), "Gemini never received CSV contents");
  ok(geminiBodies.every(b => b.key === "fixture-gemini-key" && !b.url.includes("key=")), "Gemini key only in the x-goog-api-key header");

  console.log("\n== Unsupported request");
  await pageB.getByLabel("What do you need help with?").fill("Order 50 Raspberry Pis and pay with the company card");
  await pageB.getByRole("button", { name: /Send to Dispatcher/ }).click();
  await pageB.getByText(/I can't place orders or make payments\./).waitFor();
  ok(true, "Gemini's unsupported answer is shown");

  console.log("\n== Privacy and ownership");
  await pageA.goto(base + `/office?workspace=${wsB}`);
  await pageA.getByText("OFFICE UNAVAILABLE", { exact: true }).waitFor();
  ok(await pageA.locator(".office-pixelMap").count() === 0, "Alice cannot open Bob's office");
  ok((await alice.request.post(base + `/api/workspaces/${wsB}/hires/${ro2Id}`, { data: { instructions: "x" } })).status() === 404, "Alice cannot change Bob's hire");
  await pageA.goto(base + `/workflow?workspace=${wsB}&job=${inv.id}`);
  await pageA.locator(".workflow-error").waitFor();
  ok(!(await pageA.locator("body").innerText()).includes("BOB-PRIVATE-BOLT"), "the publisher never sees the hirer's inventory or reports");

  console.log("\n== Mobile");
  const mobile = await (await account("Bob", { width: 390, height: 844 })).newPage();
  await mobile.goto(base + `/office?workspace=${wsB}`);
  await mobile.locator(".office-mapWalker").first().waitFor();
  ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), "no horizontal overflow at 390px");
  await shot(mobile, "5-mobile");

  ok(pageErrors.length === 0, "no page errors", pageErrors.join("\n"));
  console.log(`\nALL ${passed} CHECKS PASSED`);
} catch (err) {
  console.error(err);
  console.error(serverLog.split("\n").slice(-30).join("\n"));
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
  gemini.close();
  rmSync(temp, { recursive: true, force: true });
}

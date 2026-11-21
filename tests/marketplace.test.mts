import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { SCHEMA_VERSION, openDb, type Db } from "../src/lib/workplace/db.server.ts";
import { auditInventory } from "../src/lib/marketplace/inventory.server.ts";
import { INVENTORY_PERMISSIONS } from "../src/lib/marketplace/types.ts";
import { readSavedJobs } from "../src/lib/workflow/read-jobs.server.ts";
import {
  approveHire,
  ensurePersonalWorkspace,
  findListing,
  getState,
  hireTargets,
  listMarketplace,
  publishListing,
  listWorkspaces,
  runJob,
  submitAgentJob,
  submitRequest,
  type ServiceDeps,
  type Viewer,
} from "../src/lib/workplace/service.server.ts";
import { OFFICIAL_LISTINGS, validatePublish } from "../src/lib/workplace/marketplace.ts";
import { routeJob } from "../src/lib/workplace/dispatcher.ts";
import { parseCustomSprite, readSprite, spriteFromSeed } from "../src/lib/workplace/sprites.ts";
import { lookupPart } from "../src/lib/procurement-provider.server.ts";

const realFetch = globalThis.fetch;
globalThis.fetch = (() => {
  throw new Error("Network call attempted during tests");
}) as typeof fetch;
process.env.PROCUREMENT_FIXTURE_DELAY_MS = "0";
after(() => {
  globalThis.fetch = realFetch;
});

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "marketplace-test-"));
let db: Db;
let seq = 0;
const deps: ServiceDeps = {
  now: () => Date.UTC(2026, 10, 21, 18) + seq,
  newId: (p) => `${p}_${(++seq).toString(36).padStart(6, "0")}`,
  // Fixture only: zero TinyFish credits.
  lookup: (partName, supplier) => lookupPart(partName, supplier, "sample"),
};
const alice: Viewer = { sub: "auth0|alice", name: "Alice Example", email: "alice@example.com", emailVerified: true };
const bob: Viewer = { sub: "auth0|bob", name: "Bob Example", email: "bob@example.com", emailVerified: true };

const sprite = { kind: "custom", skin: "amber", outfit: "moss", trim: "rose", hair: "bun", hairColor: "copper", accessory: "tablet" } as const;
const draft = (over: Record<string, unknown> = {}) => ({
  characterName: "Juno", role: "Parts Scout", specialty: "Finds replacement parts on approved supplier sites.",
  greeting: "Point me at a part number.", skills: ["supplier_research"], hourlyRateCents: 350,
  sampleWork: "Checked stock for a USB camera on SparkFun.", publisherName: "Bob", sprite, ...over,
});
let reqSeq = 0;
const publish = (who: Viewer, over: Record<string, unknown> = {}, id = `pub-${++reqSeq}-xxxxxx`) =>
  publishListing(db, deps, who.sub, { clientRequestId: id, listing: draft(over) });

beforeEach(() => {
  db = openDb(path.join(tmp, `m-${Date.now()}-${Math.random()}.db`));
});

// --- listing fields and validation --------------------------------------------

test("official listings carry the verified check, a cast sprite and platform permissions", () => {
  assert.deepEqual(OFFICIAL_LISTINGS.map((l) => [l.id, l.characterName, l.verified, l.sprite.kind]), [
    ["catalog_assistant", "Kit", true, "cast"],
    ["procurement_researcher", "Ro", true, "cast"],
  ]);
  for (const l of OFFICIAL_LISTINGS) assert.equal(l.publisher.name, "AI Workplace");
});

test("publish validation reports every bad field and accepts only enumerated sprite parts", () => {
  assert.ok(validatePublish(draft()).ok);
  const bad = validatePublish(draft({
    characterName: "", skills: ["supplier_research", "root_access"], hourlyRateCents: 99_999, publisherName: "A.I. Workplace",
    sprite: { ...sprite, outfit: "#ff0000\" onload=\"x" },
  }));
  assert.ok(!bad.ok);
  assert.deepEqual(Object.keys(bad.errors).sort(), ["characterName", "hourlyRateCents", "publisherName", "skills", "sprite"]);
  assert.ok(!validatePublish(draft({ skills: ["supplier_research", "catalog_search", "visual_inspection", "camera_diagnostics"] })).ok, "max 3 skills");
  assert.equal(parseCustomSprite({ kind: "cast", id: "dispatcher" }), null, "community listings cannot borrow an official character");
  assert.deepEqual(readSprite("not json", "procurement_researcher"), { kind: "cast", id: "procurement_researcher" });
  assert.ok(parseCustomSprite(spriteFromSeed(42)), "shuffled sprites are always valid");
});

// --- publishing -----------------------------------------------------------------

test("a published agent is visible to every user, credited by name, and never exposes the owner's sub", () => {
  const r = publish(bob);
  assert.ok(r.ok && r.created);
  assert.match(r.listing.id, /^community-juno-/);
  assert.equal(r.listing.permissions.length, 1, "permissions come from the one skill");
  assert.match(r.listing.permissions[0], /cannot log in, add to cart or purchase/);

  const forAlice = listMarketplace(db, alice.sub).find((l) => l.id === r.listing.id)!;
  const forBob = listMarketplace(db, bob.sub).find((l) => l.id === r.listing.id)!;
  assert.equal(forAlice.kind, "community");
  assert.equal(forAlice.verified, false);
  assert.deepEqual(forAlice.publisher, { name: "Bob", isYou: false });
  assert.deepEqual(forBob.publisher, { name: "Bob", isYou: true });
  assert.doesNotMatch(JSON.stringify(listMarketplace(db, alice.sub)), /auth0\|/);
  // Official first, then community.
  assert.deepEqual(listMarketplace(db).map((l) => l.kind), ["official", "official", "community"]);
});

test("publishing is idempotent per request id and capped per publisher", () => {
  const first = publish(bob, {}, "same-request-1");
  const again = publish(bob, { characterName: "Different" }, "same-request-1");
  assert.ok(first.ok && again.ok);
  assert.equal(again.listing.id, first.listing.id);
  assert.equal(again.created, false);
  for (let i = 0; i < 11; i++) assert.ok(publish(bob).ok);
  const over = publish(bob);
  assert.ok(!over.ok);
  assert.equal(over.error.code, "LISTING_LIMIT");
  assert.ok(publish(alice).ok, "the cap is per publisher");
  const invalid = publish(alice, { hourlyRateCents: 1 });
  assert.ok(!invalid.ok);
  assert.equal(invalid.error.code, "INVALID_LISTING");
  assert.ok(invalid.error.fields?.hourlyRateCents);
});

// --- Dispatcher -------------------------------------------------------------------

test("the Dispatcher recommends an official worker over a cheaper community one", () => {
  const r = publish(bob, { hourlyRateCents: 100 });
  assert.ok(r.ok);
  const decision = routeJob("supplier_lookup", [], listMarketplace(db));
  assert.equal(decision.kind, "needs_worker");
  assert.ok(decision.kind === "needs_worker");
  assert.equal(decision.recommended?.id, "procurement_researcher");
  assert.deepEqual(decision.qualified.map((p) => p.id), ["procurement_researcher", r.listing.id]);

  const communityOnly = routeJob("supplier_lookup", [], [r.listing]);
  assert.ok(communityOnly.kind === "needs_worker");
  assert.equal(communityOnly.recommended?.id, r.listing.id);
  assert.match(communityOnly.note, /community listing, not verified/);
});

// --- hiring a community agent ---------------------------------------------------

test("hiring a community agent for a held job snapshots its sprite, runs the job, then leaves (job-only by default)", async () => {
  const listing = publish(bob);
  assert.ok(listing.ok);
  const ws = ensurePersonalWorkspace(db, deps, alice);
  const sub = submitRequest(db, deps, ws, { clientRequestId: "req-community-1", request: "Find a Raspberry Pi 5 4GB on Adafruit" });
  assert.ok(sub.ok && sub.kind === "job");
  assert.equal(getState(db, ws, "sample", 0)!.jobs[0].recommendedProfileId, "procurement_researcher");

  // The user compares in the marketplace and picks the community agent instead.
  const hire = approveHire(db, deps, ws, { profileId: listing.listing.id, jobId: sub.jobId });
  assert.ok(hire.ok && hire.created);
  assert.deepEqual(hire.runJobIds, [sub.jobId]);
  const during = getState(db, ws, "sample", 0)!.team.find((h) => h.id === hire.hireId)!;
  assert.deepEqual(during.sprite, sprite, "the exact marketplace character is on the team");
  assert.equal(during.retention, "job");
  await runJob(db, deps, sub.jobId);

  const state = getState(db, ws, "sample", 0)!;
  assert.equal(state.team.find((h) => h.id === hire.hireId), undefined, "a job-only worker leaves after its report");
  const juno = state.formerHires.find((h) => h.id === hire.hireId)!;
  assert.deepEqual(juno.sprite, sprite);
  assert.equal(juno.characterName, "Juno");
  assert.equal(juno.listingKind, "community");
  assert.equal(juno.publisherName, "Bob");
  assert.equal(state.jobs[0].status, "completed");
  assert.equal(state.jobs[0].report?.mode, "sample");
  assert.equal(state.jobs[0].hireName, "Juno");
  assert.ok(state.jobs[0].events.some((e) => /Juno \(Parts Scout, community listing by Bob\)/.test(e.text)));

  // The snapshot does not follow later changes to the listing row.
  db.prepare("UPDATE marketplace_listings SET sprite = ?, character_name = 'Changed' WHERE id = ?").run(JSON.stringify(spriteFromSeed(1)), listing.listing.id);
  const later = getState(db, ws, "sample", 0)!.formerHires.find((h) => h.id === hire.hireId)!;
  assert.deepEqual(later.sprite, sprite);
  assert.equal(later.characterName, "Juno");
});

test("hiring rejects unknown listings and community agents without the job's skill", () => {
  const catalog = publish(bob, { skills: ["catalog_search"] });
  assert.ok(catalog.ok);
  const ws = ensurePersonalWorkspace(db, deps, alice);
  const sub = submitRequest(db, deps, ws, { clientRequestId: "req-community-2", request: "Find a Raspberry Pi 5 4GB on Adafruit" });
  assert.ok(sub.ok && sub.kind === "job");
  const unknown = approveHire(db, deps, ws, { profileId: "community-ghost-000000" });
  assert.ok(!unknown.ok);
  assert.equal(unknown.error.code, "UNKNOWN_PROFILE");
  const unqualified = approveHire(db, deps, ws, { profileId: catalog.listing.id, jobId: sub.jobId });
  assert.ok(!unqualified.ok);
  assert.equal(unqualified.error.code, "NOT_QUALIFIED");
  assert.equal(findListing(db, "procurement_researcher")?.verified, true);
});

test("official hires keep their cast character", () => {
  const ws = ensurePersonalWorkspace(db, deps, alice);
  const r = approveHire(db, deps, ws, { profileId: "procurement_researcher" });
  assert.ok(r.ok);
  const team = getState(db, ws, "sample", 0)!.team;
  assert.deepEqual(team.map((h) => [h.characterName, h.sprite, h.listingKind]).sort(), [
    ["Inez", { kind: "cast", id: "quality_inspector" }, null],
    ["Ro", { kind: "cast", id: "procurement_researcher" }, "official"],
  ]);
});

// --- workspace picker -----------------------------------------------------------------

test("hire targets list only the caller's offices with open desks and current hires", () => {
  const listing = publish(bob);
  assert.ok(listing.ok);
  const ws = ensurePersonalWorkspace(db, deps, alice);
  ensurePersonalWorkspace(db, deps, bob);
  assert.deepEqual(hireTargets(db, alice.sub), [{ id: ws, name: "Alice’s office", openDesks: 2, hiredListingIds: ["quality_inspector"] }]);
  assert.ok(approveHire(db, deps, ws, { profileId: listing.listing.id }).ok);
  assert.ok(approveHire(db, deps, ws, { profileId: "procurement_researcher" }).ok);
  const [target] = hireTargets(db, alice.sub);
  assert.equal(target.openDesks, 0);
  assert.deepEqual(target.hiredListingIds.sort(), [listing.listing.id, "procurement_researcher", "quality_inspector"].sort());
  const full = approveHire(db, deps, ws, { profileId: "catalog_assistant" });
  assert.ok(!full.ok);
  assert.equal(full.error.code, "NO_OPEN_DESK");
  assert.equal(hireTargets(db, bob.sub)[0].openDesks, 2, "Bob's office is untouched");
});

// --- inventory audit action (from marketplace-publishing) -----------------------------

const inventoryDraft = (over: Record<string, unknown> = {}) => draft({
  characterName: "Shelf Scout", role: "Shelf Scout", specialty: "Audits the inventory CSV supplied by its hirer.",
  skills: ["inventory_audit"], hourlyRateCents: 650, sampleWork: "Runs an inventory audit on the CSV you submit.",
  publisherName: "Alice", actionConfig: { minimumQuantity: 5, targetQuantity: 12 }, ...over,
});
const CSV = "sku,quantity\nBOB-PRIVATE-BOLT,3\nMOTOR,14\nWASHER,0";

test("an inventory agent is published with its thresholds and fixed permissions; spoofed badges and identity are rejected", () => {
  const r = publishListing(db, deps, alice.sub, { clientRequestId: "publish-scout-1", listing: inventoryDraft() });
  assert.ok(r.ok);
  assert.deepEqual(r.listing.actionConfig, { minimumQuantity: 5, targetQuantity: 12 });
  assert.deepEqual(r.listing.permissions, INVENTORY_PERMISSIONS);
  assert.equal(r.listing.verified, false);
  for (const extra of [{ official: true }, { verified: true }, { kind: "official" }, { publisherKind: "company" }, { creatorSub: bob.sub }, { creatorName: "AI Workplace" }, { badge: "official" }, { permissions: ["Everything"] }]) {
    const spoof = publishListing(db, deps, alice.sub, { clientRequestId: `spoof-${Object.keys(extra)[0]}`, listing: inventoryDraft(extra) });
    assert.ok(!spoof.ok, JSON.stringify(extra));
  }
  for (const [n, actionConfig] of [undefined, { minimumQuantity: 0, targetQuantity: 3 }, { minimumQuantity: 9, targetQuantity: 3 }, { minimumQuantity: 1, targetQuantity: 100001 }].entries()) {
    const bad = publishListing(db, deps, alice.sub, { clientRequestId: `bad-config-${n}-xxxx`, listing: inventoryDraft({ actionConfig }) });
    assert.ok(!bad.ok && bad.error.fields?.actionConfig, JSON.stringify(actionConfig));
  }
  assert.equal(listMarketplace(db).filter((l) => l.kind === "community").length, 1, "rejections publish nothing");
  assert.equal(listMarketplace(db).filter((l) => l.verified).length, 2, "only the code-defined listings are official");
});

test("B hires A's inventory agent and gets a real, private, local audit using hire-time settings", async () => {
  const p = publishListing(db, deps, alice.sub, { clientRequestId: "publish-scout-2", listing: inventoryDraft() });
  assert.ok(p.ok);
  const a = ensurePersonalWorkspace(db, deps, alice), b = ensurePersonalWorkspace(db, deps, bob);
  const hired = approveHire(db, deps, b, { profileId: p.listing.id });
  assert.ok(hired.ok && hired.created);
  const duplicate = approveHire(db, deps, b, { profileId: p.listing.id });
  assert.ok(duplicate.ok && !duplicate.created && duplicate.hireId === hired.hireId, "an existing team hire is reused, not hired twice");
  // A later edit to the listing cannot change the hired thresholds.
  db.prepare("UPDATE marketplace_listings SET action_config = ? WHERE id = ?").run(JSON.stringify({ minimumQuantity: 1, targetQuantity: 1 }), p.listing.id);

  const request = { clientRequestId: "audit-request-1", csv: CSV };
  const submitted = submitAgentJob(db, deps, b, hired.hireId, request);
  assert.ok(submitted.ok);
  const retry = submitAgentJob(db, deps, b, hired.hireId, request);
  assert.ok(retry.ok && retry.jobId === submitted.jobId && retry.runJobIds.length === 0);
  await runJob(db, deps, submitted.jobId);

  const state = getState(db, b, "sample", 0)!;
  const job = state.jobs.find((j) => j.id === submitted.jobId)!;
  assert.equal(job.status, "completed");
  assert.equal(job.report?.mode, "local");
  assert.equal(job.report?.outcome, "audited");
  assert.equal(job.report?.hourlyRateCents, 650);
  assert.ok(job.report?.body.type === "inventory_audit");
  if (job.report?.body.type === "inventory_audit") {
    const r = job.report.body.result;
    assert.deepEqual([r.minimumQuantity, r.targetQuantity, r.rowCount, r.lowStockCount, r.totalRestockUnits], [5, 12, 3, 2, 21]);
    assert.deepEqual(r.rows.map((row) => row.restockUnits), [9, 0, 12]);
    assert.equal(r.inputSha256, createHash("sha256").update(CSV).digest("hex"));
  }
  assert.ok(state.team.some((h) => h.id === hired.hireId), "a worker hired from a desk is kept on the team");

  // Private: the publisher sees nothing of the hirer's office, input or report.
  const file = (db.prepare("PRAGMA database_list").get() as { file: string }).file;
  assert.equal(readSavedJobs(file, b, alice.sub), null);
  assert.equal(readSavedJobs(file, b, bob.sub)?.[0].report?.id, job.report?.id);
  assert.ok(!JSON.stringify(getState(db, a, "sample", 0)).includes("BOB-PRIVATE-BOLT"));
  assert.ok(!JSON.stringify(listMarketplace(db, alice.sub)).includes("BOB-PRIVATE-BOLT"));
  assert.ok(!listWorkspaces(db, alice.sub).some((w) => w.id === b));
  assert.equal(submitAgentJob(db, deps, a, hired.hireId, { clientRequestId: "cross-office-attack", csv: CSV }).ok, false);
});

test("an invalid CSV fails the job with no fabricated report", async () => {
  const p = publishListing(db, deps, alice.sub, { clientRequestId: "publish-scout-3", listing: inventoryDraft() });
  assert.ok(p.ok);
  const b = ensurePersonalWorkspace(db, deps, bob);
  const h = approveHire(db, deps, b, { profileId: p.listing.id });
  assert.ok(h.ok);
  const r = submitAgentJob(db, deps, b, h.hireId, { clientRequestId: "invalid-csv-task", csv: "sku,quantity\nPART-A,-1" });
  assert.ok(r.ok);
  await runJob(db, deps, r.jobId);
  const job = getState(db, b, "sample", 0)!.jobs[0];
  assert.equal(job.status, "failed");
  assert.equal(job.report, null);
  assert.match(job.error!.message, /whole quantity/);
});

test("inventory execution handles quoted SKUs, blank lines, exact boundaries and rejects bad or oversized data", () => {
  const config = { minimumQuantity: 5, targetQuantity: 10 };
  const actual = auditInventory('sku,quantity\r\n\r\n"A, B",4\r\n"C""D",5\r\n', config);
  assert.equal(actual.rows[0].line, 3); assert.equal(actual.rows[0].sku, "A, B"); assert.equal(actual.rows[0].restockUnits, 6); assert.equal(actual.rows[1].sku, 'C"D'); assert.equal(actual.rows[1].lowStock, false);
  for (const csv of ["", "sku,quantity", "part,count\nA,3", "sku,quantity\nA,-1", "sku,quantity\nA,1.2", "sku,quantity\nA,1\na,2", 'sku,quantity\n"A\nB",3', "sku,quantity\nA,2,3", "sku,quantity\nA,1000000001", "x".repeat(50001), "sku,quantity\n" + Array.from({ length: 501 }, (_, i) => `P${i},1`).join("\n")]) assert.throws(() => auditInventory(csv, config));
});

// --- migration ---------------------------------------------------------------------------
// Fixtures are the exact schemas written by each release (see tests/fixtures).

const fixture = (name: string) => fs.readFileSync(new URL(`./fixtures/schema-${name}.sql`, import.meta.url), "utf8");
const userVersion = (d: Db) => (d.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
function legacyFile(name: string, version: number, data: string) {
  const file = path.join(tmp, `${name}-${Math.random()}.db`);
  const raw = new DatabaseSync(file);
  raw.exec(fixture(name));
  raw.exec(data);
  raw.exec(`PRAGMA user_version = ${version}`);
  raw.close();
  return file;
}

test("a v3 database keeps jobs and reports, and existing hires keep their cast character", () => {
  const file = legacyFile("v3", 3, `
    INSERT INTO workspaces VALUES ('north','North',1,'auth0|alice');
    INSERT INTO hires VALUES ('staff_north_quality_inspector','north','quality_inspector','Quality Inspector','["camera_diagnostics","visual_inspection"]',NULL,'staff','workstation-01',1);
    INSERT INTO hires VALUES ('hire_ro','north','procurement_researcher','Procurement Researcher','["supplier_research"]',600,'marketplace','desk-02',2);
    INSERT INTO jobs VALUES ('job_1','north','req-00000001','supplier_lookup','t','{"partName":"Pi","supplierId":"adafruit","supplierName":"Adafruit"}','supplier_research','completed','hire_ro','procurement_researcher',3,3,3,4,NULL);
    INSERT INTO reports VALUES ('rpt_1','north','job_1','hire_ro','sample','found','s','{}',10,600,0,4);`);
  db = openDb(file);
  assert.equal(userVersion(db), SCHEMA_VERSION);
  const state = getState(db, "north", "sample", 0)!;
  assert.deepEqual(state.team.map((h) => [h.characterName, h.sprite, h.retention]).sort(), [
    ["Inez", { kind: "cast", id: "quality_inspector" }, "team"],
    ["Ro", { kind: "cast", id: "procurement_researcher" }, "team"],
  ]);
  assert.equal(state.jobs[0].report?.id, "rpt_1");
  assert.equal(state.jobs[0].hireName, "Ro");
  assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
  assert.equal(fs.readdirSync(tmp).filter((f) => f.startsWith(path.basename(file) + ".v3-backup-")).length, 1);
  assert.ok(publish(bob).ok, "listings table works after migration");
});

test("a v4 database from the marketplace branch keeps community listings, sprites and hires", () => {
  const custom = JSON.stringify(sprite);
  const file = legacyFile("v4-marketplace", 4, `
    INSERT INTO workspaces VALUES ('north','North',1,'auth0|alice');
    INSERT INTO marketplace_listings VALUES ('community-juno-abc123','auth0|bob','pub-1','Bob','Juno','Parts Scout','Finds parts.','Hi!','["supplier_research"]',350,'Checked stock.','${custom}',5);
    INSERT INTO hires VALUES ('hire_juno','north','community-juno-abc123','Parts Scout','["supplier_research"]',350,'marketplace','desk-02',6,'Juno','${custom}','community','Bob');`);
  db = openDb(file);
  assert.equal(userVersion(db), SCHEMA_VERSION);
  const listing = listMarketplace(db, bob.sub).find((l) => l.id === "community-juno-abc123")!;
  assert.deepEqual([listing.characterName, listing.publisher, listing.sprite], ["Juno", { name: "Bob", isYou: true }, sprite]);
  const juno = getState(db, "north", "sample", 0)!.team.find((h) => h.id === "hire_juno")!;
  assert.deepEqual([juno.characterName, juno.sprite, juno.listingKind, juno.publisherName, juno.retention], ["Juno", sprite, "community", "Bob", "team"]);
  assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
});

test("a v4 database from marketplace-publishing keeps inventory agents, their hires and local reports", () => {
  const snap = JSON.stringify({ id: "agent_1", role: "Shelf Scout", avatarId: "catalog_assistant", permissions: INVENTORY_PERMISSIONS, specialty: "Audits.",
    listing: { creatorName: "Alice Creator", publisherKind: "community", official: false, avatarId: "catalog_assistant", supportedAction: "inventory_audit", configuration: { minimumQuantity: 5, targetQuantity: 12 } } });
  const file = legacyFile("v4-publishing", 4, `
    INSERT INTO workspaces VALUES ('south','South',1,'auth0|bob');
    INSERT INTO marketplace_listings VALUES ('agent_1','auth0|alice','Alice Creator','community','Shelf Scout','Audits.','catalog_assistant','["inventory_audit"]',650,'[]','inventory_audit','{"minimumQuantity":5,"targetQuantity":12}',7,'publish-1');
    INSERT INTO hires VALUES ('hire_scout','south','agent_1','Shelf Scout','["inventory_audit"]',650,'marketplace','desk-02',8,'${snap}');
    INSERT INTO jobs VALUES ('job_a','south','req-00000002','inventory_audit','Audit','{"csv":"sku,quantity\\nA,1"}','inventory_audit','completed','hire_scout',NULL,9,9,9,10,NULL);
    INSERT INTO reports VALUES ('rpt_a','south','job_a','hire_scout','local','audited','s','{}',1,650,0,10);`);
  db = openDb(file);
  assert.equal(userVersion(db), SCHEMA_VERSION);
  const listings = listMarketplace(db);
  assert.deepEqual(listings.map((l) => [l.id, l.verified]), [["catalog_assistant", true], ["procurement_researcher", true], ["agent_1", false]], "company rows become the code-defined official listings");
  assert.deepEqual(listings[2].actionConfig, { minimumQuantity: 5, targetQuantity: 12 });
  assert.deepEqual(listings[2].sprite, { kind: "cast", id: "catalog_assistant" }, "the chosen preset avatar becomes the sprite");
  const state = getState(db, "south", "sample", 0)!;
  const scout = state.team.find((h) => h.id === "hire_scout")!;
  assert.deepEqual(scout.actionConfig, { minimumQuantity: 5, targetQuantity: 12 });
  assert.equal(scout.publisherName, "Alice Creator");
  assert.equal(state.jobs[0].report?.mode, "local");
  assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
});

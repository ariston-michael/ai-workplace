import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openDb, SCHEMA_VERSION } from "../src/lib/workplace/db.server.ts";
import { publishListing, listListings } from "../src/lib/marketplace/listings.server.ts";
import { auditInventory } from "../src/lib/marketplace/inventory.server.ts";
import { INVENTORY_PERMISSIONS } from "../src/lib/marketplace/types.ts";
import { ensurePersonalWorkspace, approveHire, submitAgentJob, submitJob, runJob, getState, listWorkspaces, type Viewer, type ServiceDeps } from "../src/lib/workplace/service.server.ts";
import { readSavedJobs } from "../src/lib/workflow/read-jobs.server.ts";

const alice: Viewer = { sub: "auth0|creator-a", name: "Alice Creator" };
const bob: Viewer = { sub: "auth0|hirer-b", name: "Bob Hirer" };
function setup() {
  const dir = mkdtempSync(path.join(tmpdir(), "marketplace-test-")), file = path.join(dir, "saved.db");
  const db = openDb(file);
  let sequence = 0;
  const deps: ServiceDeps = { now: () => 1800000000000 + sequence++, newId: p => `${p}_${sequence++}`, lookup: async () => { throw new Error("No provider calls in real local actions"); } };
  const a = ensurePersonalWorkspace(db, deps, alice), b = ensurePersonalWorkspace(db, deps, bob);
  return { db, file, dir, deps, a, b, close: () => { db.close(); rmSync(dir, { force: true, recursive: true }); } };
}
function draft(extra = {}) { return { clientRequestId: "publish-agent-a-123", name: "Shelf Scout", description: "Audits the inventory CSV supplied by its hirer.", avatarId: "procurement_researcher", hourlyRateCents: 650, skills: ["inventory_audit"], permissions: INVENTORY_PERMISSIONS, action: { id: "inventory_audit", config: { minimumQuantity: 5, targetQuantity: 12 } }, ...extra }; }

test("A publishes an immutable, attributed community listing; only managed listings are official", () => {
  const f = setup();
  try {
    const result = publishListing(f.db, f.deps, alice, draft());
    assert.ok(result.ok);
    assert.equal(result.profile.listing?.creatorName, alice.name);
    assert.equal(result.profile.listing?.official, false);
    assert.equal(result.profile.listing?.publisherKind, "community");
    assert.equal(result.profile.avatarId, "procurement_researcher");
    assert.deepEqual(result.profile.permissions, INVENTORY_PERMISSIONS);
    assert.deepEqual(result.profile.skills, ["inventory_audit"]);
    assert.equal(result.profile.hourlyRateCents, 650);
    assert.deepEqual(result.profile.listing?.configuration, { minimumQuantity: 5, targetQuantity: 12 });
    assert.equal((f.db.prepare("SELECT creator_sub FROM marketplace_listings WHERE id = ?").get(result.profile.id) as { creator_sub: string }).creator_sub, alice.sub);
    assert.ok(!JSON.stringify(listListings(f.db)).includes(alice.sub), "public catalog must not expose Auth0 subject IDs");
    assert.equal(listListings(f.db).filter(p => p.listing?.official).length, 2);
    const again = publishListing(f.db, f.deps, alice, draft());
    assert.ok(again.ok); assert.equal(again.created, false); assert.equal(again.profile.id, result.profile.id);
    const second = publishListing(f.db, f.deps, bob, draft());
    assert.ok(second.ok); assert.notEqual(second.profile.id, result.profile.id, "idempotency keys are creator scoped");
  } finally { f.close(); }
});

test("publishing rejects official/creator impersonation and unsupported capabilities", () => {
  const f = setup();
  try {
    for (const extra of [{ official: true }, { publisherKind: "company" }, { creatorSub: bob.sub }, { creatorName: "AI Workplace" }, { badge: "official" }, { avatarId: "__proto__" }, { skills: ["camera_diagnostics"] }, { permissions: ["Run arbitrary commands"] }, { hourlyRateCents: -1 }, { hourlyRateCents: 1.5 }, { hourlyRateCents: 100001 }, { action: { id: "javascript", code: "run me" } }, { action: { id: "inventory_audit", config: { minimumQuantity: 10, targetQuantity: 5 } } }]) {
      const result = publishListing(f.db, f.deps, alice, draft(extra)); assert.equal(result.ok, false, JSON.stringify(extra));
    }
    assert.equal(publishListing(f.db, f.deps, { sub: "" }, draft()).ok, false);
    assert.equal(listListings(f.db).length, 2, "rejections cannot publish anything");
  } finally { f.close(); }
});

test("B hires A's agent and receives a real private execution report, using hire-time configuration and rate", async () => {
  const f = setup();
  try {
    const published = publishListing(f.db, f.deps, alice, draft()); assert.ok(published.ok);
    const hired = approveHire(f.db, f.deps, f.b, { profileId: published.profile.id }); assert.ok(hired.ok);
    const duplicate = approveHire(f.db, f.deps, f.b, { profileId: published.profile.id }); assert.ok(duplicate.ok); assert.equal(duplicate.created, false); assert.equal(duplicate.hireId, hired.hireId);
    // Even an operator changing the listing later cannot rewrite the hired contract.
    f.db.prepare("UPDATE marketplace_listings SET hourly_rate_cents = 9900, action_config = ? WHERE id = ?").run(JSON.stringify({ minimumQuantity: 100, targetQuantity: 500 }), published.profile.id);
    const csv = 'sku,quantity\nBOB-PRIVATE-BOLT,3\n"MOTOR, LARGE",15\nWASHER,0';
    const request = { clientRequestId: "private-b-inventory-123", csv };
    const submitted = submitAgentJob(f.db, f.deps, f.b, hired.hireId, request); assert.ok(submitted.ok);
    const retry = submitAgentJob(f.db, f.deps, f.b, hired.hireId, request); assert.ok(retry.ok); assert.equal(retry.jobId, submitted.jobId); assert.deepEqual(retry.runJobIds, []);
    await Promise.all([runJob(f.db, f.deps, submitted.jobId), runJob(f.db, f.deps, submitted.jobId)]);
    const state = getState(f.db, f.b, "sample", f.deps.now())!, job = state.jobs[0], report = job.report!;
    assert.equal(job.status, "completed"); assert.equal(report.mode, "local"); assert.equal(report.outcome, "audited"); assert.equal(report.hourlyRateCents, 650);
    assert.equal(report.body.type, "inventory_audit");
    if (report.body.type === "inventory_audit") {
      const result = report.body.result;
      assert.equal(result.minimumQuantity, 5); assert.equal(result.targetQuantity, 12); assert.equal(result.lowStockCount, 2); assert.equal(result.totalRestockUnits, 21); assert.equal(result.rowCount, 3);
      assert.deepEqual(result.rows.map(r => r.restockUnits), [9, 0, 12]);
      assert.equal(result.inputSha256, createHash("sha256").update(csv).digest("hex"));
    }
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM reports WHERE job_id = ?").get(job.id)?.n, 1);
    assert.match(job.events.map(e => e.text).join(" "), /Assigned to Shelf Scout/); assert.match(job.events.at(-1)!.text, /Returned with a LOCAL report/);
    assert.equal(state.team.find(h => h.id === hired.hireId)?.listing?.configuration?.targetQuantity, 12);
    assert.equal(readSavedJobs(f.file, f.b, alice.sub), null, "publisher cannot read the hirer's history");
    assert.equal(readSavedJobs(f.file, f.b, bob.sub)?.[0].report?.id, report.id);
    assert.ok(!JSON.stringify(getState(f.db, f.a, "sample", 0)).includes("BOB-PRIVATE-BOLT"));
    assert.ok(!listWorkspaces(f.db, alice.sub).some(w => w.id === f.b));
    assert.equal(submitAgentJob(f.db, f.deps, f.a, hired.hireId, { clientRequestId: "cross-office-attack", csv }).ok, false);
    assert.ok(!JSON.stringify(listListings(f.db)).includes("BOB-PRIVATE-BOLT"));
  } finally { f.close(); }
});

test("invalid CSV produces a failed task and no fabricated report", async () => {
  const f = setup();
  try {
    const p = publishListing(f.db, f.deps, alice, draft()); assert.ok(p.ok);
    const h = approveHire(f.db, f.deps, f.b, { profileId: p.profile.id }); assert.ok(h.ok);
    const result = submitAgentJob(f.db, f.deps, f.b, h.hireId, { clientRequestId: "invalid-csv-task", csv: "sku,quantity\nPART-A,-1" }); assert.ok(result.ok);
    await runJob(f.db, f.deps, result.jobId);
    const job = getState(f.db, f.b, "sample", 0)!.jobs[0];
    assert.equal(job.status, "failed"); assert.equal(job.report, null); assert.match(job.error!.message, /whole quantity/);
  } finally { f.close(); }
});

test("inventory execution handles quoted SKUs, blank lines, exact boundaries and rejects bad or oversized data", () => {
  const config = { minimumQuantity: 5, targetQuantity: 10 };
  const actual = auditInventory('sku,quantity\r\n\r\n"A, B",4\r\n"C""D",5\r\n', config);
  assert.equal(actual.rows[0].line, 3); assert.equal(actual.rows[0].sku, "A, B"); assert.equal(actual.rows[0].restockUnits, 6); assert.equal(actual.rows[1].sku, 'C"D'); assert.equal(actual.rows[1].lowStock, false);
  for (const csv of ["", "sku,quantity", "part,count\nA,3", "sku,quantity\nA,-1", "sku,quantity\nA,1.2", "sku,quantity\nA,1\na,2", 'sku,quantity\n"A\nB",3', "sku,quantity\nA,2,3", "sku,quantity\nA,1000000001", "x".repeat(50001), "sku,quantity\n" + Array.from({ length: 501 }, (_, i) => `P${i},1`).join("\n")]) assert.throws(() => auditInventory(csv, config));
});

test("v3 migration preserves existing jobs/reports/ownership and backs up the file", async () => {
  const f = setup();
  try {
    const submitted = submitJob(f.db, f.deps, f.b, { clientRequestId: "pre-migration-camera", type: "camera_incident", input: {} });
    assert.ok(submitted.ok); await runJob(f.db, f.deps, submitted.jobId);
    const before = f.db.prepare("SELECT * FROM workspaces ORDER BY id").all();
    const jobs = f.db.prepare("SELECT * FROM jobs").all(), reports = f.db.prepare("SELECT * FROM reports").all(), events = f.db.prepare("SELECT * FROM job_events").all();
    assert.equal(reports.length, 1);
    f.db.exec("DROP TABLE marketplace_listings; ALTER TABLE hires DROP COLUMN listing_snapshot; PRAGMA user_version = 3;");
    f.db.close();
    const migrated = openDb(f.file);
    assert.equal(migrated.prepare("PRAGMA user_version").get()?.user_version, SCHEMA_VERSION);
    assert.deepEqual(migrated.prepare("SELECT * FROM workspaces ORDER BY id").all(), before);
    assert.equal(listListings(migrated).length, 2);
    assert.deepEqual(migrated.prepare("SELECT * FROM jobs").all(), jobs);
    assert.deepEqual(migrated.prepare("SELECT * FROM reports").all(), reports);
    assert.deepEqual(migrated.prepare("SELECT * FROM job_events").all(), events);
    assert.equal(migrated.prepare("PRAGMA foreign_key_check").all().length, 0);
    assert.ok(readdirSync(f.dir).some(name => name.includes(".v3-backup-")));
    migrated.close();
  } finally { rmSync(f.dir, { force: true, recursive: true }); }
});

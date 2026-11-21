import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SCHEMA_VERSION, openDb, type Db } from "../src/lib/workplace/db.server.ts";
import {
  approveHire,
  ensurePersonalWorkspace,
  findListing,
  getState,
  hireTargets,
  listMarketplace,
  publishListing,
  runJob,
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

test("hiring a community agent for a held job snapshots its sprite, resumes the job and runs it", async () => {
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
  await runJob(db, deps, sub.jobId);

  const state = getState(db, ws, "sample", 0)!;
  const juno = state.team.find((h) => h.id === hire.hireId)!;
  assert.deepEqual(juno.sprite, sprite, "the exact marketplace character is on the team");
  assert.equal(juno.characterName, "Juno");
  assert.equal(juno.listingKind, "community");
  assert.equal(juno.publisherName, "Bob");
  assert.equal(state.jobs[0].status, "completed");
  assert.equal(state.jobs[0].report?.mode, "sample");
  assert.ok(state.jobs[0].events.some((e) => /Juno \(Parts Scout, community listing by Bob\)/.test(e.text)));
  assert.ok(state.marketplace.find((l) => l.id === listing.listing.id)!.hired);

  // The snapshot does not follow later changes to the listing row.
  db.prepare("UPDATE marketplace_listings SET sprite = ?, character_name = 'Changed' WHERE id = ?").run(JSON.stringify(spriteFromSeed(1)), listing.listing.id);
  const later = getState(db, ws, "sample", 0)!.team.find((h) => h.id === hire.hireId)!;
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

// --- migration ---------------------------------------------------------------------------

test("a v3 database gains listings and back-fills the cast character on existing hires", () => {
  const file = path.join(tmp, `v3-${Math.random()}.db`);
  const current = openDb(file);
  const ws = ensurePersonalWorkspace(current, deps, alice);
  assert.ok(approveHire(current, deps, ws, { profileId: "procurement_researcher" }).ok);
  current.close();
  // Turn it back into a v3 file.
  const raw = new DatabaseSync(file);
  raw.exec(`DROP TABLE marketplace_listings; ALTER TABLE hires DROP COLUMN character_name; ALTER TABLE hires DROP COLUMN sprite;
    ALTER TABLE hires DROP COLUMN listing_kind; ALTER TABLE hires DROP COLUMN publisher_name; PRAGMA user_version = 3;`);
  raw.close();

  db = openDb(file);
  assert.equal((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version, SCHEMA_VERSION);
  const rows = db.prepare("SELECT profile_id, character_name, sprite, listing_kind FROM hires ORDER BY character_name").all();
  assert.deepEqual(rows.map((r) => ({ ...r })), [
    { profile_id: "quality_inspector", character_name: "Inez", sprite: '{"kind":"cast","id":"quality_inspector"}', listing_kind: null },
    { profile_id: "procurement_researcher", character_name: "Ro", sprite: '{"kind":"cast","id":"procurement_researcher"}', listing_kind: "official" },
  ]);
  assert.equal(fs.readdirSync(tmp).filter((f) => f.startsWith(path.basename(file) + ".v3-backup-")).length, 1);
  assert.ok(publish(bob).ok, "listings table works after migration");
});

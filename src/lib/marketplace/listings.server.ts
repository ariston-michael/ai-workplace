import { randomUUID } from "node:crypto";
import { transaction, type Db } from "../workplace/db.server.ts";
import type { Viewer, ServiceDeps } from "../workplace/service.server.ts";
import { MARKETPLACE, type WorkerProfile } from "../workplace/catalog.ts";
import { CHARACTERS, type CharacterId } from "../workplace/characters.ts";
import { INVENTORY_PERMISSIONS, type ListingDetails, type InventoryConfig } from "./types.ts";

type Row = { id: string; creator_sub: string | null; creator_name: string; publisher_kind: "company" | "community"; name: string; description: string; avatar_id: CharacterId; skills: string; hourly_rate_cents: number; permissions: string; action_id: ListingDetails["supportedAction"]; action_config: string | null; created_at: number };
function profile(row: Row): WorkerProfile {
  const managed = MARKETPLACE.find(p => p.id === row.id);
  return { id: row.id, role: row.name, initials: row.name.slice(0, 2).toUpperCase(), color: managed?.color ?? "blue", specialty: row.description, skills: JSON.parse(row.skills), hourlyRateCents: row.hourly_rate_cents, sampleWork: managed?.sampleWork ?? "Runs an inventory audit on the CSV you submit.", permissions: JSON.parse(row.permissions), avatarId: row.avatar_id,
    listing: { creatorName: row.creator_name, publisherKind: row.publisher_kind, official: row.publisher_kind === "company", avatarId: row.avatar_id, supportedAction: row.action_id, configuration: row.action_config ? JSON.parse(row.action_config) : null, createdAt: row.created_at } };
}
export function listListings(db: Db): WorkerProfile[] {
  return (db.prepare("SELECT * FROM marketplace_listings ORDER BY CASE publisher_kind WHEN 'company' THEN 0 ELSE 1 END, created_at DESC, id").all() as unknown as Row[]).map(profile);
}
export function findListing(db: Db, id: unknown): WorkerProfile | undefined {
  if (typeof id !== "string") return undefined;
  const row = db.prepare("SELECT * FROM marketplace_listings WHERE id = ?").get(id) as Row | undefined;
  return row ? profile(row) : undefined;
}
export function ownListingIds(db: Db, sub: string): string[] { return (db.prepare("SELECT id FROM marketplace_listings WHERE creator_sub = ?").all(sub) as { id: string }[]).map(r => r.id); }

export function publishListing(db: Db, deps: ServiceDeps, viewer: Viewer, body: Record<string, unknown>) {
  const invalid = (message: string) => ({ ok: false as const, status: 400, error: { code: "INVALID_LISTING", message } });
  if (!viewer.sub) return { ok: false as const, status: 401, error: { code: "UNAUTHENTICATED", message: "Sign in to publish." } };
  if (["official", "publisherKind", "creator", "creatorSub", "creatorName", "badge"].some(key => Object.hasOwn(body, key))) return invalid("Creator identity and official badges are controlled by the server.");
  const { name, description, avatarId, hourlyRateCents, skills, permissions, action, clientRequestId } = body;
  if (typeof name !== "string" || !name.trim() || name.trim().length > 60 || typeof description !== "string" || description.trim().length < 10 || description.trim().length > 500) return invalid("Use a name of 1–60 characters and a description of 10–500 characters.");
  if (typeof avatarId !== "string" || !Object.hasOwn(CHARACTERS, avatarId)) return invalid("Choose one of the pixel avatars.");
  if (!Number.isSafeInteger(hourlyRateCents) || (hourlyRateCents as number) < 0 || (hourlyRateCents as number) > 100000) return invalid("Hourly rate must be 0–100000 whole cents.");
  if (JSON.stringify(skills) !== JSON.stringify(["inventory_audit"])) return invalid("Inventory audit is the skill supported by this action.");
  if (!Array.isArray(permissions) || permissions.length !== INVENTORY_PERMISSIONS.length || !INVENTORY_PERMISSIONS.every(p => permissions.includes(p))) return invalid("Use the inventory action's declared permissions.");
  if (!action || typeof action !== "object" || (action as { id?: unknown }).id !== "inventory_audit") return invalid("Choose the supported inventory_audit action.");
  const config = (action as { config?: InventoryConfig }).config;
  if (!config || !Number.isSafeInteger(config.minimumQuantity) || !Number.isSafeInteger(config.targetQuantity) || config.minimumQuantity < 1 || config.targetQuantity < config.minimumQuantity || config.targetQuantity > 100000) return invalid("Choose a minimum of at least 1 and a restock target between that minimum and 100000.");
  if (typeof clientRequestId !== "string" || !/^[A-Za-z0-9_-]{8,100}$/.test(clientRequestId)) return invalid("A valid publish request ID is required.");
  return transaction(db, () => {
  const existing = db.prepare("SELECT id FROM marketplace_listings WHERE creator_sub = ? AND client_request_id = ?").get(viewer.sub, clientRequestId) as { id: string } | undefined;
  if (existing) return { ok: true as const, created: false, profile: findListing(db, existing.id)! };
  const id = `agent_${randomUUID()}`;
  db.prepare("INSERT INTO marketplace_listings VALUES (?, ?, ?, 'community', ?, ?, ?, ?, ?, ?, 'inventory_audit', ?, ?, ?)").run(id, viewer.sub, (viewer.name?.trim() || "Community creator").slice(0, 80), name.trim(), description.trim(), avatarId, JSON.stringify(skills), hourlyRateCents as number, JSON.stringify(INVENTORY_PERMISSIONS), JSON.stringify({ minimumQuantity: config.minimumQuantity, targetQuantity: config.targetQuantity }), deps.now(), clientRequestId);
  return { ok: true as const, created: true, profile: findListing(db, id)! };
  });
}

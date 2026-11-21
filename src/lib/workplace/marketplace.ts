// Marketplace listings: the shape shared by /marketplace, the office's empty-desk
// panel, Dispatcher recommendations and the hire snapshot. Pure (no SQLite).
//
// Official listings ship with the app and carry a verified check. Community
// listings are published by signed-in users and stored in SQLite. Either kind
// runs on the platform's built-in tools for its skills, so permissions are set
// here from the skills and never taken from the publisher.

import { CHARACTERS } from "./characters.ts";
import { MARKETPLACE, SKILLS, type SkillId, type WorkerProfile } from "./catalog.ts";
import { castSprite, parseCustomSprite, type CustomSprite, type SpriteSpec } from "./sprites.ts";

export type ListingKind = "official" | "community";

export interface MarketplaceListing extends WorkerProfile {
  kind: ListingKind;
  /** True only for official listings: shows the blue pixel check. */
  verified: boolean;
  /** The character's name ("Ro"); `role` is the job title. */
  characterName: string;
  /** One line the character says when idle. */
  greeting: string;
  sprite: SpriteSpec;
  publisher: { name: string; isYou: boolean };
  /** ms since epoch; null for official listings. */
  publishedAt: number | null;
}

export const OFFICIAL_PUBLISHER = "AI Workplace";

export const OFFICIAL_LISTINGS: MarketplaceListing[] = MARKETPLACE.map((p) => {
  const cast = p.id as keyof typeof CHARACTERS;
  return {
    ...p,
    kind: "official",
    verified: true,
    characterName: CHARACTERS[cast].name,
    greeting: CHARACTERS[cast].voice,
    sprite: castSprite(cast),
    publisher: { name: OFFICIAL_PUBLISHER, isYou: false },
    publishedAt: null,
  };
});

/** What a worker with these skills is allowed to do. Platform-defined, identical for official and community. */
const SKILL_PERMISSIONS: Record<SkillId, string> = {
  supplier_research: "Browses approved public supplier sites only (Adafruit, SparkFun, Digi-Key); cannot log in, add to cart or purchase",
  camera_diagnostics: "Reads Packing Station 1 observations; can request a camera service restart and create technician tasks",
  visual_inspection: "Reads Packing Station 1 camera frames",
  catalog_search: "Reads internal catalog records",
};

export function permissionsFor(skills: SkillId[]): string[] {
  return skills.map((s) => SKILL_PERMISSIONS[s]);
}

// --- publishing ----------------------------------------------------------------

export const PUBLISH_LIMITS = {
  characterName: [1, 24],
  role: [3, 40],
  specialty: [10, 160],
  greeting: [3, 120],
  sampleWork: [10, 200],
  publisherName: [1, 40],
  rateCents: [100, 5000],
  maxSkills: 3,
  /** Listings one user may publish. */
  perPublisher: 12,
} as const;

export interface PublishDraft {
  characterName: string;
  role: string;
  specialty: string;
  greeting: string;
  skills: SkillId[];
  hourlyRateCents: number;
  sampleWork: string;
  publisherName: string;
  sprite: CustomSprite;
}

export type PublishField = keyof PublishDraft;

const text = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");

/** Validates an untrusted Publish form. Returns every problem, keyed by field, so the form can show them inline. */
export function validatePublish(raw: unknown): { ok: true; draft: PublishDraft } | { ok: false; errors: Partial<Record<PublishField, string>> } {
  const b = (typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const errors: Partial<Record<PublishField, string>> = {};
  const L = PUBLISH_LIMITS;
  const str = (field: Exclude<PublishField, "skills" | "hourlyRateCents" | "sprite">, label: string) => {
    const v = text(b[field]);
    const [min, max] = L[field];
    if (v.length < min || v.length > max) errors[field] = `${label} must be ${min}–${max} characters.`;
    return v;
  };
  const characterName = str("characterName", "Character name");
  const role = str("role", "Role");
  const specialty = str("specialty", "Specialty");
  const greeting = str("greeting", "Greeting");
  const sampleWork = str("sampleWork", "Sample work");
  const publisherName = str("publisherName", "Publisher name");
  if (publisherName.toLowerCase().replace(/[^a-z]/g, "") === OFFICIAL_PUBLISHER.toLowerCase().replace(/[^a-z]/g, "")) {
    errors.publisherName = `“${OFFICIAL_PUBLISHER}” is reserved for official listings.`;
  }

  const skillsRaw = Array.isArray(b.skills) ? b.skills : [];
  const skills = [...new Set(skillsRaw.filter((s): s is SkillId => typeof s === "string" && Object.hasOwn(SKILLS, s)))];
  if (skills.length !== skillsRaw.length || skills.length < 1 || skills.length > L.maxSkills) {
    errors.skills = `Choose 1–${L.maxSkills} skills from the list.`;
  }

  const rate = b.hourlyRateCents;
  if (typeof rate !== "number" || !Number.isInteger(rate) || rate < L.rateCents[0] || rate > L.rateCents[1]) {
    errors.hourlyRateCents = `Hourly rate must be between $${L.rateCents[0] / 100} and $${L.rateCents[1] / 100}.`;
  }

  const sprite = parseCustomSprite(b.sprite);
  if (!sprite) errors.sprite = "Build a sprite from the listed parts.";

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    draft: { characterName, role, specialty, greeting, skills, hourlyRateCents: rate as number, sampleWork, publisherName, sprite: sprite! },
  };
}

export function initialsOf(role: string): string {
  const words = role.split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? "") + (words[1]?.[0] ?? words[0]?.[1] ?? "")).toUpperCase() || "AG";
}

/** Recommendation order: official before community, then cheapest, then oldest. */
export function recommendationOrder(a: WorkerProfile, b: WorkerProfile): number {
  const ka = a.kind === "community" ? 1 : 0, kb = b.kind === "community" ? 1 : 0;
  return ka - kb || (a.hourlyRateCents ?? 0) - (b.hourlyRateCents ?? 0);
}

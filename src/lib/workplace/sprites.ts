// Sprite specs for marketplace listings and hires. Pure data: the renderer is
// src/app/office/pixel-character.tsx. Community sprites are built only from the
// enumerated parts below, so a listing cannot inject arbitrary colours or markup.

import { CHARACTERS, type CharacterId } from "./characters.ts";

export const SKIN_TONES = { porcelain: "#f2cfb0", sand: "#e4ac82", amber: "#c98a5c", umber: "#9a6440", ebony: "#6b4330" } as const;
export const OUTFIT_COLORS = {
  coral: "#df775e", teal: "#36a8b3", violet: "#a485cd", amber: "#d7a642",
  moss: "#7fa35b", navy: "#4a6fb3", rose: "#d77fa1", slate: "#7d8a99",
} as const;
export const HAIR_COLORS = { ink: "#2b2730", chestnut: "#6e4232", copper: "#b0603a", honey: "#d9b26a", silver: "#c7c9cf", plum: "#6d4a7a" } as const;
export const HAIR_STYLES = ["crop", "long", "bun", "curls", "cap", "beanie", "shaved"] as const;
export const ACCESSORIES = ["none", "glasses", "satchel", "tablet", "toolbelt", "badge"] as const;

export type SkinTone = keyof typeof SKIN_TONES;
export type OutfitColor = keyof typeof OUTFIT_COLORS;
export type HairColor = keyof typeof HAIR_COLORS;
export type HairStyle = (typeof HAIR_STYLES)[number];
export type Accessory = (typeof ACCESSORIES)[number];

export type CustomSprite = {
  kind: "custom";
  skin: SkinTone;
  outfit: OutfitColor;
  trim: OutfitColor;
  hair: HairStyle;
  hairColor: HairColor;
  accessory: Accessory;
};

/** "cast" = one of the hand-drawn official characters; "custom" = assembled from parts. */
export type SpriteSpec = { kind: "cast"; id: CharacterId } | CustomSprite;

export const castSprite = (id: CharacterId): SpriteSpec => ({ kind: "cast", id });

const has = <T extends object>(table: T, key: unknown): key is keyof T => typeof key === "string" && Object.hasOwn(table, key);
const oneOf = <T extends readonly string[]>(list: T, value: unknown): value is T[number] => typeof value === "string" && list.includes(value);

/** Validates untrusted input. Community listings may only use "custom" sprites. */
export function parseCustomSprite(raw: unknown): CustomSprite | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const s = raw as Record<string, unknown>;
  if (s.kind !== "custom") return null;
  if (!has(SKIN_TONES, s.skin) || !has(OUTFIT_COLORS, s.outfit) || !has(OUTFIT_COLORS, s.trim)) return null;
  if (!oneOf(HAIR_STYLES, s.hair) || !has(HAIR_COLORS, s.hairColor) || !oneOf(ACCESSORIES, s.accessory)) return null;
  return { kind: "custom", skin: s.skin, outfit: s.outfit, trim: s.trim, hair: s.hair, hairColor: s.hairColor, accessory: s.accessory };
}

/** Reads a sprite saved in SQLite. Falls back to the cast character for the profile (older rows have none). */
export function readSprite(json: string | null | undefined, profileId: string): SpriteSpec {
  if (json) {
    try {
      const parsed = JSON.parse(json) as unknown;
      if (typeof parsed === "object" && parsed !== null && (parsed as { kind?: unknown }).kind === "cast") {
        const id = (parsed as { id?: unknown }).id;
        if (typeof id === "string" && Object.hasOwn(CHARACTERS, id)) return castSprite(id as CharacterId);
      }
      const custom = parseCustomSprite(parsed);
      if (custom) return custom;
    } catch {
      // fall through to the cast default
    }
  }
  return castSprite(Object.hasOwn(CHARACTERS, profileId) ? (profileId as CharacterId) : "catalog_assistant");
}

/** Deterministic sprite from a seed, for the Publish form's "Shuffle" button and its first preview. */
export function spriteFromSeed(seed: number): CustomSprite {
  let x = (seed >>> 0) || 1;
  const next = () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0); };
  const pick = <T,>(list: readonly T[]): T => list[next() % list.length];
  const outfits = Object.keys(OUTFIT_COLORS) as OutfitColor[];
  const outfit = pick(outfits);
  return {
    kind: "custom",
    skin: pick(Object.keys(SKIN_TONES) as SkinTone[]),
    outfit,
    trim: pick(outfits.filter((o) => o !== outfit)),
    hair: pick(HAIR_STYLES),
    hairColor: pick(Object.keys(HAIR_COLORS) as HairColor[]),
    accessory: pick(ACCESSORIES),
  };
}

/** Accent colour for labels and portrait backgrounds. */
export function spriteAccent(sprite: SpriteSpec): string {
  return sprite.kind === "cast" ? CHARACTERS[sprite.id].accent : OUTFIT_COLORS[sprite.outfit];
}

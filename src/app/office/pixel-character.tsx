import { CHARACTERS, type CharacterId, type Facing } from "@/lib/workplace/characters";
import { HAIR_COLORS, OUTFIT_COLORS, SKIN_TONES, castSprite, spriteAccent, type CustomSprite, type SpriteSpec } from "@/lib/workplace/sprites";
import "./pixel-character.css";

type Block = [number, number, number, number, string];
const ink = "#263546", skin = "#e4ac82", light = "#f4d3a0";

/** Shared body: boots, alternating legs, torso, head and the near arm, all with a dark arcade outline. */
function body(rect: (x: number, y: number, w: number, h: number, c: string) => void, o: { accent: string; skin: string; backHead: string; facing: Facing; frame: number }) {
  const back = o.facing === "north", side = o.facing === "east" || o.facing === "west";
  const stride = [0, 2, 0, -2][o.frame];
  rect(7, 21 + Math.max(0, stride), 4, 5 - Math.max(0, stride), ink);
  rect(14, 21 + Math.max(0, -stride), 4, 5 - Math.max(0, -stride), ink);
  rect(6, 25 + Math.min(0, stride), 6, 2, ink);
  rect(14, 25 + Math.min(0, -stride), 6, 2, ink);
  rect(5, 12, side ? 15 : 16, 11, ink); rect(7, 13, 12, 8, o.accent);
  rect(8, 2, 12, 12, ink); rect(9, 5, 10, 7, back ? o.backHead : o.skin);
  if (!back) { rect(side ? 17 : 10, 7, 2, 2, ink); if (!side) rect(16, 7, 2, 2, ink); rect(13, 11, 3, 1, ink); }
  const arm = 15 + (o.frame === 1 ? -1 : o.frame === 3 ? 1 : 0);
  rect(3, arm - 1, 4, 7, ink); rect(4, arm, 2, 4, o.accent); rect(4, arm + 4, 2, 2, o.skin);
  return { back, side, arm };
}

/** Hand-drawn official cast, four facings and four poses; no external artwork. */
function castBlocks(id: CharacterId, facing: Facing, frame: number, accentOverride?: string): Block[] {
  const blocks: Block[] = [];
  const rect = (x: number, y: number, w: number, h: number, color: string) => blocks.push([x, y, w, h, color]);
  const accent = accentOverride ?? CHARACTERS[id].accent;
  const { back, side, arm } = body(rect, { accent, skin, backHead: "#4c4148", facing, frame });
  if (id === "dispatcher") {
    rect(6, 2, 15, 4, ink); rect(7, 1, 11, 3, accent); rect(7, 4, 6, 2, accent);
    rect(7, 6, 2, 5, "#a6d9ce"); if (!back) { rect(7, 10, 6, 1, ink); rect(12, 10, 2, 2, "#f5dc8e"); }
    rect(12, 14, 2, 6, light); rect(16, 16, 2, 2, "#fff4cb");
    rect(20, arm - 1, 3, 6, ink); rect(20, arm, 2, 4, accent);
  } else if (id === "quality_inspector") {
    rect(6, 2, 16, 3, ink); rect(7, 3, 14, 2, "#eadb8e");
    if (!back) { rect(side ? 15 : 8, 6, side ? 5 : 13, 4, ink); rect(side ? 16 : 9, 7, side ? 3 : 4, 2, "#a9e4dc"); if (!side) rect(16, 7, 4, 2, "#a9e4dc"); }
    rect(8, 14, 2, 6, "#f7df90"); rect(16, 14, 2, 6, "#f7df90");
    rect(18, 15, 6, 9, ink); rect(19, 16, 4, 7, "#f9edc3"); rect(20, 15, 2, 2, "#657584");
    rect(20, 19, 2, 1, "#839075"); rect(20, 21, 2, 1, "#839075");
  } else if (id === "procurement_researcher") {
    rect(8, 1, 10, 4, ink); rect(11, 0, 5, 3, ink); rect(6, 4, 5, 3, ink);
    rect(8, 12, 12, 2, "#9b7acc"); rect(9, 14, 3, 6, "#9b7acc");
    rect(18, 16, 6, 8, ink); rect(19, 17, 4, 6, "#d3a773"); rect(20, 17, 1, 6, "#f3e2b0");
    rect(14, 16, 1, 5, ink);
  } else {
    rect(5, 1, 6, 5, ink); rect(18, 1, 6, 5, ink); rect(7, 1, 14, 4, "#69454f");
    rect(8, 14, 2, 5, "#e5bc63"); rect(16, 14, 2, 5, "#e5bc63"); rect(9, 18, 9, 4, "#735693");
    rect(19, 16, 5, 7, ink); rect(20, 17, 3, 5, "#f5dfaa"); rect(20, 16, 2, 1, "#dc7d65");
  }
  if (back) rect(9, 5, 10, 6, "#4c4148");
  return blocks;
}

/** Community sprite assembled from enumerated parts. */
function customBlocks(s: CustomSprite, facing: Facing, frame: number): Block[] {
  const blocks: Block[] = [];
  const rect = (x: number, y: number, w: number, h: number, color: string) => blocks.push([x, y, w, h, color]);
  const tone = SKIN_TONES[s.skin], outfit = OUTFIT_COLORS[s.outfit], trim = OUTFIT_COLORS[s.trim], hair = HAIR_COLORS[s.hairColor];
  const backHead = s.hair === "shaved" ? tone : s.hair === "cap" || s.hair === "beanie" ? trim : hair;
  const { back, side } = body(rect, { accent: outfit, skin: tone, backHead, facing, frame });
  // Collar / trim stripe.
  rect(9, 13, 8, 1, trim); rect(12, 14, 2, 4, trim);
  switch (s.hair) {
    case "crop": rect(8, 2, 12, 4, ink); rect(9, 3, 10, 2, hair); break;
    case "long": rect(7, 2, 14, 4, ink); rect(8, 3, 12, 2, hair); rect(7, 5, 2, 8, hair); if (!side) rect(19, 5, 2, 8, hair); break;
    case "bun": rect(8, 2, 12, 4, ink); rect(9, 3, 10, 2, hair); rect(11, 0, 6, 3, ink); rect(12, 0, 4, 2, hair); break;
    case "curls": rect(6, 1, 16, 5, ink); rect(7, 2, 4, 3, hair); rect(12, 1, 4, 3, hair); rect(17, 2, 4, 3, hair); break;
    case "cap": rect(7, 1, 14, 5, ink); rect(8, 2, 12, 3, trim); if (!back) rect(side ? 15 : 8, 5, side ? 7 : 12, 1, ink); break;
    case "beanie": rect(7, 1, 14, 5, ink); rect(8, 2, 12, 3, trim); rect(8, 4, 12, 1, outfit); rect(13, 0, 2, 1, trim); break;
    case "shaved": rect(8, 2, 12, 2, ink); rect(9, 3, 10, 1, hair); break;
  }
  switch (s.accessory) {
    case "glasses": if (!back) { rect(side ? 15 : 9, 6, side ? 5 : 10, 3, ink); rect(side ? 16 : 10, 7, side ? 3 : 3, 1, "#cfeef0"); if (!side) rect(15, 7, 3, 1, "#cfeef0"); } break;
    case "satchel": rect(8, 13, 1, 8, ink); rect(17, 18, 6, 5, ink); rect(18, 19, 4, 3, trim); break;
    case "tablet": rect(18, 15, 6, 8, ink); rect(19, 16, 4, 6, "#9fd3e6"); rect(19, 16, 4, 1, "#e8f6fb"); break;
    case "toolbelt": rect(7, 20, 12, 2, ink); rect(9, 20, 2, 2, trim); rect(15, 20, 2, 2, trim); rect(16, 22, 1, 2, "#b9c2cc"); break;
    case "badge": rect(15, 15, 3, 3, ink); rect(16, 16, 1, 1, "#f5dc8e"); break;
    case "none": break;
  }
  return blocks;
}

function Pose({ sprite, facing, frame, accentOverride }: { sprite: SpriteSpec; facing: Facing; frame: number; accentOverride?: string }) {
  const blocks = sprite.kind === "cast" ? castBlocks(sprite.id, facing, frame, accentOverride) : customBlocks(sprite, facing, frame);
  return <g transform={facing === "west" ? "translate(26 0) scale(-1 1)" : undefined}>
    {blocks.map(([x, y, width, height, fill], i) => <rect key={i} x={x} y={y} width={width} height={height} fill={fill} />)}
  </g>;
}

export type Gesture = "idle" | "wave" | "work" | "report";

/** Pass either a saved sprite or, for the built-in cast, its id. */
export default function PixelCharacter({ sprite, id, portrait = false, gesture = "idle", facing, stroll = false, accentOverride }: {
  sprite?: SpriteSpec; id?: CharacterId; portrait?: boolean; gesture?: Gesture;
  /** Loop the walk cycle in place (marketplace previews). */
  stroll?: boolean;
  /** Fixed facing for previews outside the map (the map sets facing via data-facing). */
  facing?: Facing;
  accentOverride?: string;
}) {
  const spec = sprite ?? castSprite(id ?? "catalog_assistant");
  const castId = spec.kind === "cast" ? spec.id : null;
  const className = `office-character office-character-${castId ?? "custom"}${portrait ? " office-characterPortrait" : ""}`;
  const style = castId ? undefined : { "--character-accent": spriteAccent(spec) } as React.CSSProperties;
  const facings = facing ? [facing] : (["south", "north", "east", "west"] as const);
  return <span className={className} style={style} data-gesture={gesture} data-fixed-facing={facing} data-stroll={stroll || undefined} aria-hidden="true">
    <svg className="office-mapSprite" viewBox="0 0 26 30" shapeRendering="crispEdges" focusable="false">
      {facings.map(f => <g className={`office-facing office-facing-${f}`} key={f}>
        {[0, 1, 2, 3].map(frame => <g className={`office-pose office-pose-${frame}`} key={frame}><Pose sprite={spec} facing={f} frame={frame} accentOverride={accentOverride} /></g>)}
      </g>)}
      {castId === "dispatcher" && <g className="office-characterWave"><path d="M20 16h4v-5h-2V8h-2v4h-2v3h2z" fill={skin} stroke={ink} strokeWidth="1" /></g>}
      {castId === "quality_inspector" && <path className="office-characterTick" d="m19 19 1 1 3-3" fill="none" stroke="#20847d" strokeWidth="1.5" />}
      {castId === "procurement_researcher" && <g className="office-characterPage"><path d="M19 16h5v7h-5z" fill="#fff0cb" /><path d="M20 18h3m-3 2h2" stroke="#8d90a1" strokeWidth="1" /></g>}
      {!castId && <path className="office-characterTick" d="m19 19 1 1 3-3" fill="none" stroke="#20847d" strokeWidth="1.5" />}
    </svg>
  </span>;
}

/** Blue pixel check shown on official (verified) listings and hires. */
export function VerifiedCheck({ label = "Official worker, verified by AI Workplace" }: { label?: string }) {
  const r = (x: number, y: number, w: number, h: number, fill: string, k: string) => <rect key={k} x={x} y={y} width={w} height={h} fill={fill} />;
  return <svg className="pixel-verified" viewBox="0 0 12 12" width="16" height="16" shapeRendering="crispEdges" {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}>
    {label && <title>{label}</title>}
    {[r(3, 0, 6, 12, "#1d3f8f", "a"), r(0, 3, 12, 6, "#1d3f8f", "b"), r(1, 1, 10, 10, "#1d3f8f", "c"),
      r(3, 1, 6, 10, "#3b7be8", "d"), r(1, 3, 10, 6, "#3b7be8", "e"), r(2, 2, 8, 8, "#3b7be8", "f"),
      ...[[2, 6], [3, 7], [4, 8], [5, 7], [6, 6], [7, 5], [8, 4]].map(([x, y], i) => r(x, y, 2, 1, "#ffffff", `k${i}`))]}
  </svg>;
}

/** Official: blue pixel check. Community: publisher credit and an unverified note. */
export function ListingBadge({ kind, publisher }: { kind: "official" | "community" | null; publisher: string | null }) {
  if (kind === "official") return <span className="pixel-listingBadge pixel-listingOfficial"><VerifiedCheck /> Official</span>;
  if (kind === "community") return <span className="pixel-listingBadge pixel-listingCommunity">Community · by {publisher} · not verified</span>;
  return <span className="pixel-listingBadge">Built-in staff</span>;
}

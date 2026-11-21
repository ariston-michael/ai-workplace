import { CHARACTERS, type CharacterId, type Facing } from "@/lib/workplace/characters";
import "./pixel-character.css";

type Block = [number, number, number, number, string];
const ink = "#263546", skin = "#e4ac82", light = "#f4d3a0";

/** Hand-drawn pixel geometry, four facings and four poses; no external artwork. */
function Pose({ id, facing, frame }: { id: CharacterId; facing: Facing; frame: number }) {
  const back = facing === "north", side = facing === "east" || facing === "west";
  const accent = CHARACTERS[id].accent;
  const stride = [0, 2, 0, -2][frame];
  const blocks: Block[] = [];
  const rect = (x: number, y: number, w: number, h: number, color: string) => blocks.push([x, y, w, h, color]);
  // Boots, alternating legs and a dark arcade outline stay inside the walk clearance.
  rect(7, 21 + Math.max(0, stride), 4, 5 - Math.max(0, stride), ink);
  rect(14, 21 + Math.max(0, -stride), 4, 5 - Math.max(0, -stride), ink);
  rect(6, 25 + Math.min(0, stride), 6, 2, ink);
  rect(14, 25 + Math.min(0, -stride), 6, 2, ink);
  rect(5, 12, side ? 15 : 16, 11, ink); rect(7, 13, 12, 8, accent);
  rect(8, 2, 12, 12, ink); rect(9, 5, 10, 7, back ? "#4c4148" : skin);
  if (!back) { rect(side ? 17 : 10, 7, 2, 2, ink); if (!side) rect(16, 7, 2, 2, ink); rect(13, 11, 3, 1, ink); }
  const arm = 15 + (frame === 1 ? -1 : frame === 3 ? 1 : 0);
  rect(3, arm - 1, 4, 7, ink); rect(4, arm, 2, 4, accent); rect(4, arm + 4, 2, 2, skin);
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
  return <g transform={facing === "west" ? "translate(26 0) scale(-1 1)" : undefined}>
    {blocks.map(([x, y, width, height, fill], i) => <rect key={i} x={x} y={y} width={width} height={height} fill={fill} />)}
    {back && <rect x="9" y="5" width="10" height="6" fill="#4c4148" />}
  </g>;
}

export default function PixelCharacter({ id, portrait = false, gesture = "idle" }: { id: CharacterId; portrait?: boolean; gesture?: "idle" | "wave" | "work" | "report" }) {
  return <span className={`office-character office-character-${id}${portrait ? " office-characterPortrait" : ""}`} data-gesture={gesture} aria-hidden="true">
    <svg className="office-mapSprite" viewBox="0 0 26 30" shapeRendering="crispEdges" focusable="false">
      {(["south", "north", "east", "west"] as const).map(facing => <g className={`office-facing office-facing-${facing}`} key={facing}>
        {[0, 1, 2, 3].map(frame => <g className={`office-pose office-pose-${frame}`} key={frame}><Pose id={id} facing={facing} frame={frame} /></g>)}
      </g>)}
      {id === "dispatcher" && <g className="office-characterWave"><path d="M20 16h4v-5h-2V8h-2v4h-2v3h2z" fill={skin} stroke={ink} strokeWidth="1" /></g>}
      {id === "quality_inspector" && <path className="office-characterTick" d="m19 19 1 1 3-3" fill="none" stroke="#20847d" strokeWidth="1.5" />}
      {id === "procurement_researcher" && <g className="office-characterPage"><path d="M19 16h5v7h-5z" fill="#fff0cb" /><path d="M20 18h3m-3 2h2" stroke="#8d90a1" strokeWidth="1" /></g>}
    </svg>
  </span>;
}

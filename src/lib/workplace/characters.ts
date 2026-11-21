import type { JobView } from "./types.ts";

/** Original office cast. Presentation only; identity, skills and prices stay saved data. */
export const CHARACTERS = {
  dispatcher: { name: "Milo", accent: "#df775e", detail: "Coral jacket · headset", voice: "Tell me what you need. I’ll find the right hands." },
  quality_inspector: { name: "Inez", accent: "#d7a642", detail: "Amber vest · square visor · clipboard", voice: "One observation at a time. Evidence first." },
  procurement_researcher: { name: "Ro", accent: "#36a8b3", detail: "Teal coat · violet scarf · field notebook", voice: "There’s a lead in every detail. Let’s check the source." },
  catalog_assistant: { name: "Kit", accent: "#a485cd", detail: "Violet overalls · twin curls · index cards", voice: "Everything has a place. I’ll help you find it." },
} as const;
export type CharacterId = keyof typeof CHARACTERS;
export type Facing = "north" | "east" | "south" | "west";
export function characterId(id: string): CharacterId { return Object.hasOwn(CHARACTERS, id) ? id as CharacterId : "catalog_assistant"; }
export function walkFacing(from: { x: number; y: number }, to: { x: number; y: number }): Facing {
  return Math.abs(to.x - from.x) > Math.abs(to.y - from.y) ? to.x > from.x ? "east" : "west" : to.y > from.y ? "south" : "north";
}
export function characterVoice(id: CharacterId, job?: JobView): string {
  if (!job) return CHARACTERS[id].voice;
  if (job.status === "failed") return "I couldn’t finish this one. My saved notes explain what happened.";
  if (job.status === "working") return id === "quality_inspector" ? "I’m checking the observations before I tick this off." : id === "procurement_researcher" ? "I’m following the source trail. I’ll bring back what I can verify." : "I’m sorting through the details.";
  if (job.status === "queued") return "The Dispatcher handed me a task. Time to get to my desk.";
  const report = job.report;
  if (id === "quality_inspector" && report?.body.type === "camera_incident") {
    const incident = report.body.incident;
    if (incident.status === "resolved") return "A fresh frame came through. I’ve recorded the recovery.";
    if (incident.phase === "awaiting_frame") return "I’m waiting for a fresh frame before I call this fixed.";
    if (incident.phase === "awaiting_technician") return "This needs a pair of hands at the station. See my visit request.";
    return "My report is ready. The incident still needs attention.";
  }
  if (id === "procurement_researcher" && report?.body.type === "supplier_lookup") {
    if (report.outcome === "not_found") return "No confirmed match this time. I’ve kept the uncertainties in my brief.";
    if (report.outcome === "ambiguous" || report.outcome === "close") return "There’s a possible lead, but the details need a closer look.";
    return report.mode === "sample" ? "My sample brief is ready. These are fixture findings, not a live stock check." : "My source-linked brief is ready. Check the findings before you decide.";
  }
  return CHARACTERS[id].voice;
}

export function characterTask(job?: JobView): string {
  if (!job) return "No active task";
  if (job.status === "working" || job.status === "queued") return job.title;
  if (job.report?.body.type === "camera_incident" && job.report.body.incident.status === "open") return `${job.report.body.incident.station} · report ready, incident still open`;
  if (job.report) return "No active task · report ready";
  if (job.status === "failed") return "No active task · last attempt failed";
  return "No active task";
}

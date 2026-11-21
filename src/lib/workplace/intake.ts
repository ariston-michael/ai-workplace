// Dispatcher intake: turn "What do you need help with?" into a supported job,
// a follow-up question, or an explanation that no worker can handle it.
// Deterministic keyword rules: no network, no model calls, no credits.

import { SKILLS, type JobType, type SkillId } from "./catalog.ts";
import { SUPPLIERS } from "../procurement.ts";

export const REQUEST_MAX = 500;
export const STATION = "Packing Station 1";

export type Missing = "job_type" | "part_name" | "supplier" | "camera_problem";

export interface TranscriptLine {
  actor: "You" | "Dispatcher";
  text: string;
}

/** Sent back by the client with the answer to a follow-up. Re-validated on every use. */
export interface PendingRequest {
  original: string;
  jobType: JobType | null;
  partName?: string;
  supplierId?: string;
  missing: Missing[];
  transcript: TranscriptLine[];
}

export type Interpretation =
  | {
      kind: "ready";
      jobType: "supplier_lookup";
      input: { partName: string; supplierId: string };
      original: string;
      understood: string;
      transcript: TranscriptLine[];
    }
  | {
      kind: "ready";
      jobType: "camera_incident";
      input: { station: string };
      original: string;
      understood: string;
      transcript: TranscriptLine[];
    }
  | { kind: "follow_up"; question: string; pending: PendingRequest }
  | { kind: "unsupported"; message: string; skill: SkillId | null }
  | { kind: "invalid"; message: string };

export const SUPPORTED_SUMMARY =
  "finding a replacement part on an approved supplier site (Adafruit, SparkFun or Digi-Key), or diagnosing a stopped camera feed at Packing Station 1";

// ---------------------------------------------------------------------------
// Signals
// ---------------------------------------------------------------------------

const SUPPLIER_PATTERNS: { id: string; re: RegExp }[] = [
  { id: "adafruit", re: /\badafruit\b/i },
  { id: "sparkfun", re: /\bspark\s?fun\b/i },
  { id: "digikey", re: /\bdigi[\s-]?key\b/i },
];

const CAMERA_NOUN = /\b(camera|cameras|webcam|c270|feed|video|stream|frames?)\b/i;
const CAMERA_PROBLEM =
  /\b(stopped|stops|stop|down|not working|isn'?t working|is not working|broken|dead|black|frozen|freez\w*|offline|disconnected|lost|blank|failing|failed|went out|no (?:video|image|picture|frames?|feed|signal))\b/i;
const PURCHASE_STRONG = /\b(buy|order|purchase|source|sourcing|reorder|restock|quote|price|pricing|supplier|suppliers|vendor)\b/i;
const PURCHASE_WEAK = /\b(replacement|replace|spare|in stock|stock|availability|available|find|look up|lookup|look for|search for|where can i get|need a new|new one)\b/i;
const CATALOG = /\b(internal catalog|our catalog|catalog|internal records?|our records|part numbers?|inventory|warehouse records?|bin location)\b/i;

const VAGUE_WORDS = new Set(
  (
    "help helping please pls can could would you i me my we us our need needs want something somethings issue issues problem problems " +
    "broken broke wrong fix fixed it its it's is isn't are a an the with there this that have has got hi hello hey some thing things stuff " +
    "urgent quick question working work not do does support assist assistance anyone somebody someone sort out going on happening to for on"
  ).split(" "),
);

const GENERIC_PARTS = new Set(
  "part parts component components something replacement replacements item items thing things it one stuff piece pieces supplies new spare".split(" "),
);

function detectSupplier(text: string): string | undefined {
  return SUPPLIER_PATTERNS.find((s) => s.re.test(text))?.id;
}

function supplierName(id: string): string {
  return SUPPLIERS.find((s) => s.id === id)?.name ?? id;
}

const LEADING = [
  /^(?:please|pls|hey|hi|hello|ok|okay|so)\b[\s,]*/i,
  /^(?:can|could|would|will) you\s*/i,
  /^(?:i|we) (?:need|want|would like|'d like)(?: you)?(?: to)?\s*/i,
  /^(?:i'd|we'd) like(?: to)?\s*/i,
  /^(?:help me|help us)\s*/i,
  /^(?:need|needs)(?: to)?\s*/i,
  /^(?:is|are|do you have|does|do|have|has|any|there|is there|are there)\b\s*/i,
  /^(?:find|source|order|buy|purchase|get|locate|look up|lookup|look for|search for|search|check on|check|see if|price|quote|reorder|restock)\b\s*/i,
  /^(?:if|whether)\b\s*/i,
  /^(?:me|us|a|an|the|some|another|spare|new|replacement|replacements|for|of|on|out)\b\s*/i,
  /^(?:price|availability|stock) (?:of|for|on)\s*/i,
];

const TRAILING = [
  /[\s,]*[.?!]+$/,
  /\s+(?:please|thanks|thank you|asap|today|for me|for us|again|right now|now)$/i,
  /\s+(?:is|are)?\s*(?:in stock|available|still available)$/i,
  /\s+(?:in stock|availability|available)$/i,
  /\s+(?:to buy|to order)$/i,
];

/** Pull a part name out of free text, or undefined if only generic words remain. */
export function extractPart(text: string): string | undefined {
  const quoted = text.match(/["“”']([^"“”']{2,100})["“”']/);
  let s = quoted ? quoted[1] : text;
  if (!quoted) {
    s = s.replace(/\b(?:on|at|from|via|through|with)\s+(?:adafruit|spark\s?fun(?:\s+electronics)?|digi[\s-]?key)\b/gi, " ");
    s = s.replace(/\b(?:adafruit|spark\s?fun(?:\s+electronics)?|digi[\s-]?key)\b/gi, " ");
    s = s.replace(/\breplacement for\b/gi, " ");
    s = s.replace(/\s+/g, " ").trim();
    for (let changed = true; changed; ) {
      changed = false;
      for (const re of [...LEADING, ...TRAILING]) {
        const next = s.replace(re, "").trim();
        if (next !== s) {
          s = next;
          changed = true;
        }
      }
    }
  }
  s = s.trim();
  const words = s.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length || words.every((w) => GENERIC_PARTS.has(w) || VAGUE_WORDS.has(w))) return undefined;
  if (s.length < 2 || s.length > 100) return undefined;
  return s;
}

function isVague(text: string): boolean {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  return words.every((w) => VAGUE_WORDS.has(w));
}

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

const SUPPLIER_LIST = "Adafruit, SparkFun or Digi-Key";

function supplierQuestion(missing: Missing[], partName?: string): string {
  if (missing.includes("part_name") && missing.includes("supplier")) {
    return `I can have a Procurement Researcher check a supplier. Which part do you need, and which supplier should I check: ${SUPPLIER_LIST}?`;
  }
  if (missing.includes("part_name")) return "Which part do you need? Please give the part name or model, for example “Raspberry Pi 5 4GB”.";
  return `Which supplier should I check for “${partName}”: ${SUPPLIER_LIST}?`;
}

const TYPE_QUESTION = `I can help with ${SUPPORTED_SUMMARY}. Which of those do you need?`;
const CAMERA_OR_PART_QUESTION =
  "Do you want the Quality Inspector to diagnose the camera feed at Packing Station 1, or a Procurement Researcher to find a replacement camera?";

// ---------------------------------------------------------------------------
// Interpret
// ---------------------------------------------------------------------------

function clean(text: unknown): string | null {
  if (typeof text !== "string") return null;
  const t = text.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return t.length ? t.slice(0, REQUEST_MAX) : null;
}

function supplierOutcome(
  original: string,
  transcript: TranscriptLine[],
  partName: string | undefined,
  supplierId: string | undefined,
): Interpretation {
  const missing: Missing[] = [];
  if (!partName) missing.push("part_name");
  if (!supplierId) missing.push("supplier");
  if (missing.length) {
    const question = supplierQuestion(missing, partName);
    return {
      kind: "follow_up",
      question,
      pending: {
        original,
        jobType: "supplier_lookup",
        partName,
        supplierId,
        missing,
        transcript: [...transcript, { actor: "Dispatcher", text: question }],
      },
    };
  }
  return {
    kind: "ready",
    jobType: "supplier_lookup",
    input: { partName: partName!, supplierId: supplierId! },
    original,
    understood: `${SKILLS.supplier_research}: find “${partName}” on ${supplierName(supplierId!)}.`,
    transcript,
  };
}

function cameraReady(original: string, transcript: TranscriptLine[]): Interpretation {
  return {
    kind: "ready",
    jobType: "camera_incident",
    input: { station: STATION },
    original,
    understood: `${SKILLS.camera_diagnostics}: camera feed problem at ${STATION}.`,
    transcript,
  };
}

function interpretFresh(text: string, original: string, transcript: TranscriptLine[]): Interpretation {
  const supplierId = detectSupplier(text);
  const cameraNoun = CAMERA_NOUN.test(text);
  const cameraProblem = cameraNoun && CAMERA_PROBLEM.test(text);
  const purchaseStrong = PURCHASE_STRONG.test(text) || supplierId !== undefined;
  const purchaseWeak = PURCHASE_WEAK.test(text);

  if (CATALOG.test(text) && !purchaseStrong && !cameraProblem) {
    return {
      kind: "unsupported",
      skill: "catalog_search",
      message:
        "That sounds like an internal catalog search. The Catalog Assistant in the marketplace lists that skill, but internal catalog jobs are not connected yet, so no available worker can take this job. " +
        `Right now I can help with ${SUPPORTED_SUMMARY}.`,
    };
  }

  if (cameraProblem && !purchaseStrong) {
    if (purchaseWeak) {
      return {
        kind: "follow_up",
        question: CAMERA_OR_PART_QUESTION,
        pending: { original, jobType: null, missing: ["job_type"], transcript: [...transcript, { actor: "Dispatcher", text: CAMERA_OR_PART_QUESTION }] },
      };
    }
    return cameraReady(original, transcript);
  }

  if (purchaseStrong || purchaseWeak) {
    return supplierOutcome(original, transcript, extractPart(text), supplierId);
  }

  if (cameraNoun) {
    const q = `What is happening with the camera? For example, “the feed stopped at ${STATION}”. Or do you need a replacement camera sourced?`;
    return {
      kind: "follow_up",
      question: q,
      pending: { original, jobType: null, missing: ["camera_problem"], transcript: [...transcript, { actor: "Dispatcher", text: q }] },
    };
  }

  if (isVague(text)) {
    return {
      kind: "follow_up",
      question: TYPE_QUESTION,
      pending: { original, jobType: null, missing: ["job_type"], transcript: [...transcript, { actor: "Dispatcher", text: TYPE_QUESTION }] },
    };
  }

  return {
    kind: "unsupported",
    skill: null,
    message: `No worker on your team or in the marketplace can handle that request. Right now I can help with ${SUPPORTED_SUMMARY}.`,
  };
}

function validPending(p: unknown): PendingRequest | null {
  if (typeof p !== "object" || p === null) return null;
  const r = p as Record<string, unknown>;
  const original = clean(r.original);
  if (!original) return null;
  const jobType = r.jobType === "supplier_lookup" || r.jobType === "camera_incident" ? r.jobType : null;
  const transcript = Array.isArray(r.transcript)
    ? r.transcript
        .slice(-12)
        .map((l) => l as Record<string, unknown>)
        .filter((l) => (l.actor === "You" || l.actor === "Dispatcher") && typeof l.text === "string")
        .map((l) => ({ actor: l.actor as "You" | "Dispatcher", text: String(l.text).slice(0, REQUEST_MAX) }))
    : [];
  const partName = clean(r.partName) ?? undefined;
  const supplierId = typeof r.supplierId === "string" && SUPPLIERS.some((s) => s.id === r.supplierId) ? r.supplierId : undefined;
  return { original, jobType, partName: partName && partName.length <= 100 ? partName : undefined, supplierId, missing: [], transcript };
}

/**
 * Interpret a new request, or an answer to a follow-up when `pendingRaw` is given.
 * The pending object comes from the client, so every field is re-validated.
 */
export function interpretRequest(textRaw: unknown, pendingRaw?: unknown): Interpretation {
  const text = clean(textRaw);
  if (!text) return { kind: "invalid", message: "Tell the Dispatcher what you need help with." };

  const pending = pendingRaw === undefined || pendingRaw === null ? null : validPending(pendingRaw);
  if (pendingRaw !== undefined && pendingRaw !== null && !pending) {
    return { kind: "invalid", message: "The follow-up expired. Please describe what you need again." };
  }

  if (!pending) {
    return interpretFresh(text, text, [{ actor: "You", text }]);
  }

  const transcript: TranscriptLine[] = [...pending.transcript, { actor: "You", text }];

  if (pending.jobType === "supplier_lookup") {
    const supplierId = detectSupplier(text) ?? pending.supplierId;
    let partName = pending.partName;
    if (!partName) {
      partName = extractPart(text);
      // A bare answer like "C270 webcam" is the part name itself.
      if (!partName && !detectSupplier(text) && !isVague(text) && text.length <= 100) partName = text;
    }
    return supplierOutcome(pending.original, transcript, partName, supplierId);
  }

  if (pending.jobType === "camera_incident") return cameraReady(pending.original, transcript);

  // Job type was unclear. "Diagnose it" about a camera mentioned earlier means the camera job.
  const aboutCamera = CAMERA_NOUN.test(text) || CAMERA_NOUN.test(pending.original);
  if (aboutCamera && /\b(diagnos\w*|inspect\w*|check the (?:camera|feed)|fix the (?:camera|feed))\b/i.test(text) && !PURCHASE_STRONG.test(text)) {
    return cameraReady(pending.original, transcript);
  }
  // Otherwise read the answer on its own first, then together with the original request.
  const answerOnly = interpretFresh(text, pending.original, transcript);
  if (answerOnly.kind === "ready" || (answerOnly.kind === "follow_up" && answerOnly.pending.jobType !== null)) return answerOnly;
  const combined = interpretFresh(`${pending.original} ${text}`, pending.original, transcript);
  if (combined.kind === "ready" || (combined.kind === "follow_up" && combined.pending.jobType !== null)) return combined;
  return answerOnly;
}

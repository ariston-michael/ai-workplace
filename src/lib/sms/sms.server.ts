// Text the Dispatcher: the SMS channel over the existing workplace service.
//
// A phone is linked to one workspace by texting a single-use code shown in that
// office. After that, every text from the phone acts as the office's owner:
// it goes through the same Dispatcher (Gemini or rules), the same routing and
// hiring rules (approveHire), and the same saved jobs, reports and workflow
// history as the office UI. Nothing here grants extra permissions.
//
// Delivery safety: each inbound MessageSid is recorded before any work, so a
// redelivered webhook is answered from the log and never runs anything twice.
// Approvals go through approveHire (idempotent per job) and runJob's claim step,
// and each job's result is texted at most once (sms_outbox unique per job).

import { createHash, randomInt } from "node:crypto";
import { transaction, type Db } from "../workplace/db.server.ts";
import {
  addEvent,
  approveHire,
  getOwnedWorkspace,
  getState,
  submitRequest,
  type ServiceDeps,
} from "../workplace/service.server.ts";
import { formatRate } from "../workplace/catalog.ts";
import type { DispatchResult } from "../workplace/dispatcher-ai.server.ts";
import type { JobView, WorkplaceState } from "../workplace/types.ts";
import { isE164, maskPhone, type SendResult } from "./twilio.server.ts";

export const LINK_CODE_TTL_MS = 10 * 60 * 1000;
export const CONVERSATION_TTL_MS = 30 * 60 * 1000;
const MAX_FAILED_LINKS_PER_HOUR = 5;
const JOB_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I/L
// Carrier/Twilio opt-out and opt-in keywords: Twilio handles these, so we stay silent.
const OPT_KEYWORDS = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "START", "YES", "UNSTOP", "REVOKE", "OPTOUT"]);

export interface SmsDeps extends ServiceDeps {
  /** The Dispatcher: Gemini when configured, else the built-in rules. */
  dispatch: (request: string, pending: unknown, options: { csvAttached: boolean }) => Promise<DispatchResult>;
}

export interface InboundSms {
  messageSid: string;
  from: string;
  body: string;
}

export interface InboundResult {
  reply: string;
  /** Jobs to run after replying (an approval, or a request a kept worker can take). */
  runJobIds: string[];
  duplicate: boolean;
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const clean = (s: string) => s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 500);

export const HELP_TEXT =
  "AI Workplace Dispatcher. Text what you need, e.g. \"I need a replacement part\". " +
  "APPROVE <job code> hires the recommended worker for that job (APPROVE <code> KEEP keeps them on your team). " +
  "RESET starts over. Results say SAMPLE until live procurement is on.";

// ---------------------------------------------------------------------------
// Linking (office side)
// ---------------------------------------------------------------------------

/** New single-use code for linking a phone to this office. Replaces the owner's previous unused code. */
export function createLinkCode(db: Db, now: number, ws: string, ownerSub: string): { code: string; expiresAt: number } {
  return transaction(db, () => {
    db.prepare("DELETE FROM sms_link_codes WHERE (workspace_id = ? AND owner_sub = ? AND used_at IS NULL) OR expires_at < ?").run(ws, ownerSub, now - 24 * 3600_000);
    for (let i = 0; i < 20; i++) {
      const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
      const hash = sha256(code);
      const taken = db.prepare("SELECT 1 FROM sms_link_codes WHERE code_hash = ?").get(hash);
      if (taken) continue;
      db.prepare("INSERT INTO sms_link_codes (code_hash, workspace_id, owner_sub, created_at, expires_at) VALUES (?, ?, ?, ?, ?)").run(hash, ws, ownerSub, now, now + LINK_CODE_TTL_MS);
      return { code, expiresAt: now + LINK_CODE_TTL_MS };
    }
    throw new Error("Could not allocate a link code.");
  });
}

export interface PhoneLinkView {
  /** Opaque id for unlinking; the full number is never sent to the browser. */
  id: string;
  phone: string;
  linkedAt: number;
}

export function listLinks(db: Db, ws: string): PhoneLinkView[] {
  const rows = db.prepare("SELECT phone, linked_at FROM sms_links WHERE workspace_id = ? ORDER BY linked_at").all(ws) as { phone: string; linked_at: number }[];
  return rows.map((r) => ({ id: sha256(r.phone).slice(0, 16), phone: maskPhone(r.phone), linkedAt: r.linked_at }));
}

export function unlinkPhone(db: Db, ws: string, id: unknown): boolean {
  if (typeof id !== "string") return false;
  const phone = (db.prepare("SELECT phone FROM sms_links WHERE workspace_id = ?").all(ws) as { phone: string }[]).find((r) => sha256(r.phone).slice(0, 16) === id)?.phone;
  if (!phone) return false;
  db.prepare("DELETE FROM sms_links WHERE phone = ?").run(phone);
  db.prepare("DELETE FROM sms_conversations WHERE phone = ?").run(phone);
  return true;
}

// ---------------------------------------------------------------------------
// Inbound texts
// ---------------------------------------------------------------------------

/** Handles one inbound text. Safe to call again with the same MessageSid. */
export async function handleInboundSms(db: Db, deps: SmsDeps, msg: InboundSms): Promise<InboundResult> {
  if (!/^[A-Z]{2}[0-9a-f]{32}$/i.test(msg.messageSid) || !isE164(msg.from)) {
    return { reply: "", runJobIds: [], duplicate: false };
  }
  const now = deps.now();
  // Claim this MessageSid before doing anything else.
  const claimed = db.prepare("INSERT OR IGNORE INTO sms_inbound (message_sid, phone, kind, reply, received_at) VALUES (?, ?, 'processing', NULL, ?)").run(msg.messageSid, msg.from, now);
  if (!claimed.changes) {
    const seen = db.prepare("SELECT reply FROM sms_inbound WHERE message_sid = ?").get(msg.messageSid) as { reply: string | null };
    return { reply: seen.reply ?? "", runJobIds: [], duplicate: true };
  }
  let out: { kind: string; reply: string; runJobIds?: string[] };
  try {
    out = await route(db, deps, msg.from, clean(msg.body), now);
  } catch (err) {
    console.error("[sms] inbound failed", err instanceof Error ? err.message : err);
    out = { kind: "error", reply: "Sorry, something went wrong on our side. Please try again." };
  }
  db.prepare("UPDATE sms_inbound SET kind = ?, reply = ? WHERE message_sid = ?").run(out.kind, out.reply, msg.messageSid);
  return { reply: out.reply, runJobIds: out.runJobIds ?? [], duplicate: false };
}

type Routed = { kind: string; reply: string; runJobIds?: string[] };

async function route(db: Db, deps: SmsDeps, phone: string, text: string, now: number): Promise<Routed> {
  const upper = text.toUpperCase();
  if (OPT_KEYWORDS.has(upper)) return { kind: "opt", reply: "" };
  if (upper === "HELP" || upper === "INFO") return { kind: "help", reply: HELP_TEXT };

  const linkMatch = /^(?:LINK\s+)?(\d{6})$/i.exec(text);
  if (linkMatch) return link(db, phone, linkMatch[1], now);

  const link_ = db.prepare("SELECT workspace_id, owner_sub FROM sms_links WHERE phone = ?").get(phone) as { workspace_id: string; owner_sub: string } | undefined;
  const ws = link_ && getOwnedWorkspace(db, link_.workspace_id, link_.owner_sub);
  if (!link_ || !ws) {
    if (link_) db.prepare("DELETE FROM sms_links WHERE phone = ?").run(phone);
    return { kind: "unlinked", reply: "This number isn't linked to an office yet. In your AI Workplace office, open Text the Dispatcher, choose Get a link code, then text the 6-digit code here." };
  }

  if (/^(RESET|NEW|START OVER)$/i.test(text)) {
    db.prepare("DELETE FROM sms_conversations WHERE phone = ?").run(phone);
    return { kind: "reset", reply: "Started over. What do you need help with?" };
  }
  if (/^APPROVE\b/i.test(text)) return approve(db, deps, phone, ws.id, ws.name, text, now);
  return dispatchText(db, deps, phone, ws.id, text, now);
}

function link(db: Db, phone: string, code: string, now: number): Routed {
  const failures = (db.prepare("SELECT COUNT(*) AS n FROM sms_inbound WHERE phone = ? AND kind = 'link_failed' AND received_at > ?").get(phone, now - 3600_000) as { n: number }).n;
  if (failures >= MAX_FAILED_LINKS_PER_HOUR) return { kind: "link_failed", reply: "Too many link attempts from this number. Wait an hour, then text a new code." };
  return transaction(db, (): Routed => {
    const row = db.prepare("SELECT workspace_id, owner_sub FROM sms_link_codes WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?").get(sha256(code), now) as { workspace_id: string; owner_sub: string } | undefined;
    const ws = row && getOwnedWorkspace(db, row.workspace_id, row.owner_sub);
    if (!row || !ws) return { kind: "link_failed", reply: "That code is invalid, used or expired. Get a new code in your office under Text the Dispatcher." };
    db.prepare("UPDATE sms_link_codes SET used_at = ?, used_by = ? WHERE code_hash = ?").run(now, phone, sha256(code));
    // One phone → one workspace: linking again moves the phone.
    db.prepare("INSERT INTO sms_links (phone, workspace_id, owner_sub, linked_at) VALUES (?, ?, ?, ?) ON CONFLICT (phone) DO UPDATE SET workspace_id = excluded.workspace_id, owner_sub = excluded.owner_sub, linked_at = excluded.linked_at").run(phone, ws.id, row.owner_sub, now);
    db.prepare("DELETE FROM sms_conversations WHERE phone = ?").run(phone);
    return { kind: "linked", reply: `Linked to ${ws.name}. Text the Dispatcher what you need, e.g. "I need a replacement part". Reply HELP for commands.` };
  });
}

function newJobCode(db: Db, ws: string): string {
  for (let i = 0; i < 50; i++) {
    const code = Array.from({ length: 4 }, () => JOB_CODE_ALPHABET[randomInt(JOB_CODE_ALPHABET.length)]).join("");
    if (!db.prepare("SELECT 1 FROM sms_jobs WHERE workspace_id = ? AND code = ?").get(ws, code)) return code;
  }
  throw new Error("Could not allocate a job code.");
}

const workerOf = (state: WorkplaceState, job: JobView) => [...state.team, ...state.formerHires].find((h) => h.id === job.hireId);

async function dispatchText(db: Db, deps: SmsDeps, phone: string, ws: string, text: string, now: number): Promise<Routed> {
  const conv = db.prepare("SELECT client_request_id, pending, updated_at FROM sms_conversations WHERE phone = ? AND workspace_id = ?").get(phone, ws) as
    { client_request_id: string; pending: string | null; updated_at: number } | undefined;
  const live = conv && now - conv.updated_at < CONVERSATION_TTL_MS ? conv : undefined;
  const pending = live?.pending ? JSON.parse(live.pending) : undefined;
  const clientRequestId = live?.client_request_id ?? deps.newId("sms").replace(/[^A-Za-z0-9_-]/g, "").padEnd(8, "0");

  // Same Dispatcher as the office: Gemini proposes, the server validates and routes.
  const d = await deps.dispatch(text, pending, { csvAttached: false });
  const r = submitRequest(db, deps, ws, { clientRequestId, request: text, pending }, d.interpretation, d.engine);
  if (!r.ok) {
    db.prepare("DELETE FROM sms_conversations WHERE phone = ?").run(phone);
    return { kind: "invalid", reply: `${r.error.message} Text what you need to start again.` };
  }
  if (r.kind === "follow_up") {
    if (/inventory CSV/i.test(r.question)) {
      db.prepare("DELETE FROM sms_conversations WHERE phone = ?").run(phone);
      return { kind: "follow_up", reply: "Inventory audits need your CSV file, which can't be sent by text. Attach it in your office under Give the Dispatcher a job." };
    }
    db.prepare(`INSERT INTO sms_conversations (phone, workspace_id, client_request_id, pending, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (phone) DO UPDATE SET workspace_id = excluded.workspace_id, client_request_id = excluded.client_request_id, pending = excluded.pending, updated_at = excluded.updated_at`)
      .run(phone, ws, clientRequestId, JSON.stringify(r.pending), now);
    return { kind: "follow_up", reply: r.question };
  }
  db.prepare("DELETE FROM sms_conversations WHERE phone = ?").run(phone);
  if (r.kind === "unsupported") return { kind: "unsupported", reply: r.message.slice(0, 480) };

  // A job was created (or found again for a retried conversation).
  let code = (db.prepare("SELECT code FROM sms_jobs WHERE job_id = ?").get(r.jobId) as { code: string } | undefined)?.code;
  if (!code) {
    code = newJobCode(db, ws);
    db.prepare("INSERT INTO sms_jobs (job_id, workspace_id, code, phone, created_at) VALUES (?, ?, ?, ?, ?)").run(r.jobId, ws, code, phone, now);
    addEvent(db, r.jobId, now, "SMS", `Requested by text from ${maskPhone(phone)}. Job code ${code}.`);
  }
  const state = getState(db, ws, "sample", now)!;
  const job = state.jobs.find((j) => j.id === r.jobId)!;
  const understood = `Understood: ${r.understood}`;
  if (job.status === "needs_worker") {
    const rec = state.marketplace.find((p) => p.id === job.recommendedProfileId);
    if (!rec) return { kind: "job", reply: `${understood} No worker in the marketplace can take it yet. Job ${code} is saved in your office.`, runJobIds: r.runJobIds };
    const who = `${rec.characterName}, ${rec.role}${rec.kind === "community" ? ` (community, by ${rec.publisher.name})` : " (official)"}, ${formatRate(rec.hourlyRateCents)}`;
    return {
      kind: "job",
      reply: `${understood} Nobody on your team can do this, so a hire is needed: ${who}, billed per second. Job ${code}. Reply APPROVE ${code} to hire ${rec.characterName} for this job only, or APPROVE ${code} KEEP to keep them on your team.`,
      runJobIds: r.runJobIds,
    };
  }
  const worker = workerOf(state, job);
  return { kind: "job", reply: `${understood} ${worker?.characterName ?? job.hireRole}, already on your team, has it. Job ${code}. I'll text the result.`, runJobIds: r.runJobIds };
}

function approve(db: Db, deps: SmsDeps, phone: string, ws: string, wsName: string, text: string, now: number): Routed {
  const m = /^APPROVE\s+([A-Z0-9]{4})(?:\s+(KEEP))?$/i.exec(text);
  if (!m) return { kind: "approve_invalid", reply: "Reply APPROVE followed by the 4-character job code, e.g. APPROVE K7P2. Add KEEP to keep the worker on your team." };
  const code = m[1].toUpperCase();
  const keep = Boolean(m[2]);
  const row = db.prepare("SELECT job_id FROM sms_jobs WHERE workspace_id = ? AND code = ?").get(ws, code) as { job_id: string } | undefined;
  if (!row) return { kind: "approve_invalid", reply: `There is no job ${code} in ${wsName}.` };
  const state = getState(db, ws, "sample", now)!;
  const job = state.jobs.find((j) => j.id === row.job_id);
  if (!job) return { kind: "approve_invalid", reply: `Job ${code} is no longer in ${wsName}.` };
  if (job.status !== "needs_worker") {
    // Repeated approval: nothing new runs.
    const worker = workerOf(state, job);
    const where = job.status === "completed" || job.status === "failed" ? "has already finished" : `is already approved and assigned to ${worker?.characterName ?? job.hireRole}`;
    return { kind: "approve_repeat", reply: `Job ${code} ${where}. It runs only once${job.status === "completed" || job.status === "failed" ? "" : "; I'll text the result"}.` };
  }
  if (!job.recommendedProfileId) return { kind: "approve_invalid", reply: `No marketplace worker can do job ${code} yet.` };
  const r = approveHire(db, deps, ws, { profileId: job.recommendedProfileId, jobId: job.id, retention: keep ? "team" : "job" });
  if (!r.ok) return { kind: "approve_failed", reply: `Could not approve job ${code}: ${r.error.message}` };
  addEvent(db, job.id, now, "SMS", `Approved by text from ${maskPhone(phone)}${keep ? " (keep on team)" : " (for this job only)"}.`);
  const after = getState(db, ws, "sample", now)!;
  const worker = after.team.find((h) => h.id === r.hireId);
  const terms = worker?.retention === "team" ? "kept on your team" : "hired for this job only";
  return {
    kind: "approved",
    reply: `Approved. ${worker?.characterName ?? "The worker"} (${worker?.role ?? "worker"}) is ${terms} and starting job ${code}. I'll text the result.`,
    runJobIds: r.runJobIds,
  };
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

/** Text of the result message for a finished SMS job. */
export function resultText(job: JobView, code: string, state: WorkplaceState): string {
  const worker = workerOf(state, job);
  const name = worker?.characterName ?? job.hireName ?? job.hireRole ?? "The worker";
  const after = worker?.departedAt ? `${name} delivered the report and left the office (hired for this job only).` : `${name} is back at their desk.`;
  const saved = `Saved in ${state.workspace.name}'s workflow history.`;
  if (job.status === "failed" || !job.report) {
    return `Job ${code} failed: ${job.error?.code ?? "FAILED"}. ${job.error?.message ?? ""} Nothing was billed. ${saved}`.replace(/\s+/g, " ").trim();
  }
  const report = job.report;
  const label = report.mode.toUpperCase();
  const lines = [`${label} result, job ${code}: ${report.summary}`];
  if (report.body.type === "supplier_lookup") {
    if (report.mode === "sample") lines.push("Fixture data, not a live stock check.");
    lines.push(`Source: ${report.body.result.sourceUrl}`);
  }
  lines.push(after, saved);
  return lines.join("\n").slice(0, 1500);
}

/**
 * After a job finishes: if it was requested by text, send its result once.
 * The outbox row is claimed before sending, so concurrent or repeated calls send nothing extra.
 */
export async function notifySmsResult(db: Db, now: number, jobId: string, send: (to: string, body: string) => Promise<SendResult>): Promise<"sent" | "failed" | "skipped"> {
  const sj = db.prepare("SELECT workspace_id, code, phone FROM sms_jobs WHERE job_id = ?").get(jobId) as { workspace_id: string; code: string; phone: string } | undefined;
  if (!sj) return "skipped";
  const state = getState(db, sj.workspace_id, "sample", now);
  const job = state?.jobs.find((j) => j.id === jobId);
  if (!state || !job || (job.status !== "completed" && job.status !== "failed")) return "skipped";
  const body = resultText(job, sj.code, state);
  const claimed = db.prepare("INSERT OR IGNORE INTO sms_outbox (workspace_id, job_id, kind, phone, body, status, created_at) VALUES (?, ?, 'result', ?, ?, 'sending', ?)").run(sj.workspace_id, jobId, sj.phone, body, now);
  if (!claimed.changes) return "skipped";
  const sent = await send(sj.phone, body);
  if (sent.ok) {
    db.prepare("UPDATE sms_outbox SET status = 'sent', twilio_sid = ? WHERE job_id = ? AND kind = 'result'").run(sent.sid, jobId);
    addEvent(db, jobId, now, "SMS", `Texted the ${job.report ? job.report.mode.toUpperCase() + " result" : "failure"} to ${maskPhone(sj.phone)}.`);
    return "sent";
  }
  db.prepare("UPDATE sms_outbox SET status = 'failed', error = ? WHERE job_id = ? AND kind = 'result'").run(`${sent.code}: ${sent.message}`, jobId);
  addEvent(db, jobId, now, "SMS", `Could not text the result to ${maskPhone(sj.phone)} (${sent.code}). The report is saved here.`);
  return "failed";
}

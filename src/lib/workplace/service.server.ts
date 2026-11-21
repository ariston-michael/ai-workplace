// The workplace flow: submit job -> Dispatcher routes -> (approve hire) ->
// job resumes automatically -> worker runs -> report saved. Every state change
// is persisted in SQLite and recorded as a job event.

import { randomUUID } from "node:crypto";
import {
  DISPATCHER,
  HIRE_DESKS,
  JOB_TYPES,
  SKILLS,
  STAFF,
  STAFF_DESK,
  demoCostCents,
  findProfile,
  formatCost,
  formatRate,
  type JobType,
  type SkillId,
} from "./catalog.ts";
import { routeJob, type TeamMember } from "./dispatcher.ts";
import { DEFAULT_WORKSPACE_ID, transaction, type Db } from "./db.server.ts";
import type {
  ApiError,
  DispatcherInfo,
  HireEventView,
  HireView,
  Retention,
  JobInput,
  JobStatus,
  JobView,
  ReportBody,
  ReportMode,
  ReportOutcome,
  WorkplaceState,
  WorkspaceSummary,
} from "./types.ts";
import { validateLookupRequest, findSupplier, type LookupMode, type LookupResponse, type Supplier } from "../procurement.ts";
import { SCENARIOS, runScenario } from "../camera-incident.ts";
import { cameraReport } from "../office-camera-report.ts";
import {
  OFFICIAL_LISTINGS,
  PUBLISH_LIMITS,
  initialsOf,
  permissionsFor,
  snapshotOf,
  staffSnapshot,
  validatePublish,
  type HireSnapshot,
  type MarketplaceListing,
  type PublishField,
} from "./marketplace.ts";
import { readSprite } from "./sprites.ts";
import { auditInventory } from "../marketplace/inventory.server.ts";
import { CSV_MAX_LENGTH, type InventoryConfig } from "../marketplace/types.ts";
import type { Interpretation } from "./intake.ts";
import { interpretRequest, STATION, type TranscriptLine } from "./intake.ts";

export { DEFAULT_WORKSPACE_ID };
/** A job still "working" after this long was interrupted (e.g. server restart). */
export const STALE_WORKING_MS = 10 * 60 * 1000;

export interface ServiceDeps {
  now: () => number;
  newId: (prefix: string) => string;
  lookup: (partName: string, supplier: Supplier) => Promise<LookupResponse>;
}

export function defaultIds(prefix: string): string {
  return `${prefix}_${randomUUID().slice(0, 8)}`;
}

type Result<T> = ({ ok: true } & T) | { ok: false; status: number; error: ApiError };

const fail = (status: number, code: string, message: string) => ({ ok: false as const, status, error: { code, message } });

// ---------------------------------------------------------------------------
// Workspaces
// ---------------------------------------------------------------------------

interface WorkspaceRow {
  id: string;
  name: string;
  created_at: number;
  owner_sub: string | null;
}

/** The signed-in user, from the Auth0 session. */
export interface Viewer {
  sub: string;
  name?: string | null;
  email?: string | null;
  emailVerified?: boolean;
}

export function getWorkspace(db: Db, id: unknown): WorkspaceRow | undefined {
  if (typeof id !== "string" || !/^[a-z0-9-]{1,64}$/.test(id)) return undefined;
  return db.prepare("SELECT id, name, created_at, owner_sub FROM workspaces WHERE id = ?").get(id) as unknown as WorkspaceRow | undefined;
}

/** The workspace only if `sub` owns it. Anyone else gets undefined (callers answer 404, not 403). */
export function getOwnedWorkspace(db: Db, id: unknown, sub: string): WorkspaceRow | undefined {
  const ws = getWorkspace(db, id);
  return ws && ws.owner_sub !== null && ws.owner_sub === sub ? ws : undefined;
}

/**
 * Offices created before sign-in existed have no owner. They are handed to the
 * user whose *verified* email matches WORKPLACE_DEMO_OWNER_EMAIL, and stay
 * hidden from everyone otherwise. Returns how many offices were claimed.
 */
export function claimUnownedWorkspaces(db: Db, viewer: Viewer, demoOwnerEmail: string | undefined): number {
  const wanted = demoOwnerEmail?.trim().toLowerCase();
  if (!wanted || !viewer.emailVerified || viewer.email?.trim().toLowerCase() !== wanted) return 0;
  return Number(db.prepare("UPDATE workspaces SET owner_sub = ? WHERE owner_sub IS NULL").run(viewer.sub).changes);
}

/** The user's main office: the migrated default office if they own it, else their oldest office. */
export function primaryWorkspaceId(db: Db, sub: string): string | undefined {
  const row = db
    .prepare(
      `SELECT id FROM workspaces WHERE owner_sub = ?
       ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END, created_at, id LIMIT 1`,
    )
    .get(sub, DEFAULT_WORKSPACE_ID) as { id: string } | undefined;
  return row?.id;
}

function personalOfficeName(viewer: Viewer): string {
  const base = (viewer.name?.trim() || viewer.email?.split("@")[0]?.trim() || "").split(/\s+/)[0];
  return base ? `${base.slice(0, 40)}’s office` : "My office";
}

/** Make sure the user owns at least one office (created on first sign-in). Returns their primary office id. */
export function ensurePersonalWorkspace(db: Db, deps: ServiceDeps, viewer: Viewer): string {
  return transaction(db, () => {
    const existing = primaryWorkspaceId(db, viewer.sub);
    if (existing) return existing;
    return insertWorkspace(db, deps, personalOfficeName(viewer), viewer.sub);
  });
}

function insertWorkspace(db: Db, deps: ServiceDeps, name: string, ownerSub: string | null): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "office";
  let id = base;
  for (let i = 0; getWorkspace(db, id); i++) {
    if (i > 20) throw Object.assign(new Error("Could not find a free id for that name."), { code: "WORKSPACE_ID_TAKEN" });
    id = `${base}-${deps.newId("w").replace(/[^a-z0-9]/g, "").slice(-6)}`;
  }
  const now = deps.now();
  db.prepare("INSERT INTO workspaces (id, name, created_at, owner_sub) VALUES (?, ?, ?, ?)").run(id, name, now, ownerSub);
  ensureSeeded(db, id, now);
  return id;
}

const missingWorkspace = (id: unknown) => fail(404, "WORKSPACE_NOT_FOUND", `Workspace "${String(id).slice(0, 64)}" does not exist.`);

/** Offices owned by `ownerSub`. Omit it only in tests/maintenance to list every office. */
export function listWorkspaces(db: Db, ownerSub?: string): WorkspaceSummary[] {
  const filter = ownerSub === undefined ? "" : "WHERE w.owner_sub = ?";
  const rows = db
    .prepare(
      `SELECT w.id, w.name, w.created_at,
              (SELECT COUNT(*) FROM hires h WHERE h.workspace_id = w.id AND h.departed_at IS NULL) AS team_size,
              (SELECT COUNT(*) FROM jobs j WHERE j.workspace_id = w.id) AS total_jobs,
              (SELECT COUNT(*) FROM jobs j WHERE j.workspace_id = w.id AND j.status IN ('needs_worker', 'queued', 'working')) AS open_jobs
         FROM workspaces w ${filter} ORDER BY w.created_at, w.id`,
    )
    .all(...(ownerSub === undefined ? [] : [ownerSub])) as unknown as (WorkspaceRow & { team_size: number; total_jobs: number; open_jobs: number })[];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    createdAt: r.created_at,
    teamSize: r.team_size,
    totalJobs: r.total_jobs,
    openJobs: r.open_jobs,
  }));
}

export function createWorkspace(
  db: Db,
  deps: ServiceDeps,
  req: { name: unknown; ownerSub?: string | null },
): Result<{ workspace: WorkspaceSummary }> {
  const name = typeof req.name === "string" ? req.name.replace(/\s+/g, " ").trim() : "";
  if (name.length < 1 || name.length > 60) return fail(400, "INVALID_NAME", "Office name must be 1–60 characters.");
  try {
    return transaction(db, () => {
      const id = insertWorkspace(db, deps, name, req.ownerSub ?? null);
      return { ok: true as const, workspace: listWorkspaces(db).find((w) => w.id === id)! };
    });
  } catch (err) {
    if ((err as { code?: string }).code === "WORKSPACE_ID_TAKEN") return fail(409, "WORKSPACE_ID_TAKEN", "Could not find a free id for that name.");
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

interface HireRow {
  id: string;
  workspace_id: string;
  profile_id: string;
  role: string;
  skills: string;
  hourly_rate_cents: number | null;
  source: "staff" | "marketplace";
  desk: string;
  hired_at: number;
  /** JSON HireSnapshot: the listing exactly as hired. */
  snapshot: string;
  retention: Retention;
  job_id: string | null;
  instructions: string;
  departed_at: number | null;
}

interface JobRow {
  id: string;
  workspace_id: string;
  client_request_id: string;
  type: JobType;
  title: string;
  input: string;
  required_skill: SkillId;
  status: JobStatus;
  hire_id: string | null;
  recommended_profile_id: string | null;
  created_at: number;
  assigned_at: number | null;
  started_at: number | null;
  finished_at: number | null;
  error: string | null;
}

interface ReportRow {
  id: string;
  job_id: string;
  hire_id: string;
  mode: ReportMode;
  outcome: ReportOutcome;
  summary: string;
  body: string;
  runtime_ms: number;
  hourly_rate_cents: number | null;
  demo_cost_cents: number | null;
  created_at: number;
}

/** Workers currently in the office (not departed). */
function hires(db: Db, ws: string): HireRow[] {
  return db.prepare("SELECT * FROM hires WHERE workspace_id = ? AND departed_at IS NULL ORDER BY hired_at, id").all(ws) as unknown as HireRow[];
}

function getHire(db: Db, ws: string, id: string): HireRow | undefined {
  return db.prepare("SELECT * FROM hires WHERE workspace_id = ? AND id = ?").get(ws, id) as unknown as HireRow | undefined;
}

function snapshot(h: HireRow): HireSnapshot {
  try {
    return JSON.parse(h.snapshot) as HireSnapshot;
  } catch {
    return staffSnapshot();
  }
}

/** Saved per workspace with the hire; deleted only by an office reset. */
function addHireEvent(db: Db, ws: string, hireId: string, at: number, kind: string, text: string, jobId: string | null = null) {
  db.prepare("INSERT INTO hire_events (workspace_id, hire_id, job_id, at, kind, text) VALUES (?, ?, ?, ?, ?, ?)").run(ws, hireId, jobId, at, kind, text);
}

const INSTRUCTIONS_MAX = 1000;
const cleanInstructions = (v: unknown): string | null =>
  v === undefined ? "" : typeof v === "string" && v.trim().length <= INSTRUCTIONS_MAX ? v.replace(/\r\n/g, "\n").trim() : null;

function getJob(db: Db, id: string): JobRow | undefined {
  return db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as unknown as JobRow | undefined;
}

function toMember(h: HireRow): TeamMember {
  return { id: h.id, profileId: h.profile_id, role: h.role, skills: JSON.parse(h.skills), hiredAt: h.hired_at };
}

/** Only workers kept on the team are reused. A job-only worker is busy with its one job and then leaves. */
const retainedMembers = (rows: HireRow[]) => rows.filter((h) => h.retention === "team").map(toMember);

/**
 * After a job finishes (report or failure) the worker returns to reception.
 * A job-only worker then leaves the office; a retained one goes back to its desk.
 */
function afterJob(db: Db, job: JobRow, hire: HireRow, at: number, outcome: string) {
  addHireEvent(db, job.workspace_id, hire.id, at, "returned", `Returned to reception: ${outcome}`, job.id);
  const current = getHire(db, job.workspace_id, hire.id)!;
  if (current.retention === "job" && current.job_id === job.id && current.departed_at === null) {
    db.prepare("UPDATE hires SET departed_at = ? WHERE workspace_id = ? AND id = ?").run(at, job.workspace_id, hire.id);
    addHireEvent(db, job.workspace_id, hire.id, at, "departed", "Hired for this job only, so left the office. Its report stays in workflow history.", job.id);
    addEvent(db, job.id, at, hire.role, "Left the office (hired for this job only).");
  } else if (current.source === "marketplace") {
    addHireEvent(db, job.workspace_id, hire.id, at, "at_desk", `Back at ${deskLabel(current.desk)}, ready for the next job.`, job.id);
  }
}

/** Append to a job's saved history (also used by the SMS channel). */
export function addEvent(db: Db, jobId: string, at: number, actor: string, text: string) {
  db.prepare("INSERT INTO job_events (job_id, at, actor, text) VALUES (?, ?, ?, ?)").run(jobId, at, actor, text);
}

function deskLabel(desk: string): string {
  return desk === STAFF_DESK ? "Workstation 01" : desk === "desk-02" ? "Desk 02" : desk === "desk-03" ? "Desk 03" : desk;
}

// ---------------------------------------------------------------------------
// Seed / reset
// ---------------------------------------------------------------------------

export function ensureSeeded(db: Db, ws: string, now: number) {
  for (const profile of STAFF) {
    const id = ws === DEFAULT_WORKSPACE_ID ? `staff_${profile.id}` : `staff_${ws}_${profile.id}`;
    const inserted = db.prepare(
      `INSERT OR IGNORE INTO hires (id, workspace_id, profile_id, role, skills, hourly_rate_cents, source, desk, hired_at, snapshot, retention)
       VALUES (?, ?, ?, ?, ?, ?, 'staff', ?, ?, ?, 'team')`,
    ).run(id, ws, profile.id, profile.role, JSON.stringify(profile.skills), profile.hourlyRateCents, STAFF_DESK, now, JSON.stringify(staffSnapshot()));
    if (inserted.changes) addHireEvent(db, ws, id, now, "hired", "Built-in staff at Workstation 01.");
  }
}

export function resetWorkspace(db: Db, ws: string, now: number): Result<{ workspaceId: string }> {
  if (!getWorkspace(db, ws)) return missingWorkspace(ws);
  return transaction(db, () => {
    db.prepare("DELETE FROM reports WHERE workspace_id = ?").run(ws);
    db.prepare("DELETE FROM job_events WHERE job_id IN (SELECT id FROM jobs WHERE workspace_id = ?)").run(ws);
    // SMS job codes, sent results and open text conversations go with the jobs; phone links stay.
    db.prepare("DELETE FROM sms_outbox WHERE workspace_id = ?").run(ws);
    db.prepare("DELETE FROM sms_jobs WHERE workspace_id = ?").run(ws);
    db.prepare("DELETE FROM sms_conversations WHERE workspace_id = ?").run(ws);
    db.prepare("DELETE FROM jobs WHERE workspace_id = ?").run(ws);
    db.prepare("DELETE FROM hire_events WHERE workspace_id = ?").run(ws);
    db.prepare("DELETE FROM hires WHERE workspace_id = ?").run(ws);
    db.prepare("DELETE FROM simulator_settings WHERE workspace_id = ?").run(ws);
    ensureSeeded(db, ws, now);
    return { ok: true as const, workspaceId: ws };
  });
}

// ---------------------------------------------------------------------------
// Submit
// ---------------------------------------------------------------------------

export interface SubmitInput {
  clientRequestId: unknown;
  type: unknown;
  input: unknown;
  /** The user's own words, when the job came from the request field. */
  request?: string;
  /** Intake conversation (request, follow-up questions and answers) to record on the job. */
  conversation?: TranscriptLine[];
  /** How the Dispatcher understood the request. */
  understood?: string;
  /** Which Dispatcher engine interpreted the request (recorded on the job). */
  engine?: DispatcherInfo;
}

// ---------------------------------------------------------------------------
// Simulator controls (operator side; never given to a worker as input)
// ---------------------------------------------------------------------------

export const DEFAULT_CAMERA_FAULT = SCENARIOS[0].id;

export function getCameraFault(db: Db, ws: string): string {
  const row = db.prepare("SELECT camera_fault FROM simulator_settings WHERE workspace_id = ?").get(ws) as
    | { camera_fault: string }
    | undefined;
  return row && SCENARIOS.some((s) => s.id === row.camera_fault) ? row.camera_fault : DEFAULT_CAMERA_FAULT;
}

export function setCameraFault(db: Db, ws: string, fault: unknown): Result<{ cameraFault: string }> {
  if (!getWorkspace(db, ws)) return missingWorkspace(ws);
  const scenario = SCENARIOS.find((s) => s.id === fault);
  if (!scenario) return fail(400, "UNKNOWN_FAULT", "Choose one of the simulated camera faults.");
  db.prepare(
    "INSERT INTO simulator_settings (workspace_id, camera_fault) VALUES (?, ?) ON CONFLICT (workspace_id) DO UPDATE SET camera_fault = excluded.camera_fault",
  ).run(ws, scenario.id);
  return { ok: true, cameraFault: scenario.id };
}

// ---------------------------------------------------------------------------
// Free-text requests
// ---------------------------------------------------------------------------

export type RequestOutcome =
  | { ok: true; kind: "job"; jobId: string; runJobIds: string[]; understood: string }
  | { ok: true; kind: "follow_up"; question: string; pending: unknown }
  | { ok: true; kind: "unsupported"; message: string }
  | { ok: false; status: number; error: ApiError };

/**
 * "What do you need help with?" → job, follow-up question, or "no worker can handle it".
 * `interpretation` comes from the Gemini Dispatcher (runtime) or, when omitted, the
 * built-in rules. Either way the job type, part, supplier and station are re-validated
 * by submitJob. An inventory CSV is attached here and never sent to Gemini.
 */
export function submitRequest(
  db: Db,
  deps: ServiceDeps,
  ws: string,
  req: { clientRequestId: unknown; request: unknown; pending?: unknown; csv?: unknown },
  interpretation: Interpretation = interpretRequest(req.request, req.pending, { csvAttached: hasCsv(req.csv) }),
  engine: DispatcherInfo = { engine: "rules", model: null },
): RequestOutcome {
  if (!getWorkspace(db, ws)) return missingWorkspace(ws);
  switch (interpretation.kind) {
    case "invalid":
      return fail(400, "INVALID_REQUEST", interpretation.message);
    case "unsupported":
      return { ok: true, kind: "unsupported", message: interpretation.message };
    case "follow_up":
      return { ok: true, kind: "follow_up", question: interpretation.question, pending: interpretation.pending };
    case "ready": {
      const r = submitJob(db, deps, ws, {
        clientRequestId: req.clientRequestId,
        type: interpretation.jobType,
        input: interpretation.jobType === "inventory_audit" ? { csv: req.csv } : interpretation.input,
        request: interpretation.original,
        conversation: interpretation.transcript,
        understood: interpretation.understood,
        engine,
      });
      if (!r.ok) return r;
      return { ok: true, kind: "job", jobId: r.jobId, runJobIds: r.runJobIds, understood: interpretation.understood };
    }
  }
}

export const hasCsv = (csv: unknown) => typeof csv === "string" && csv.trim().length > 0;

export function submitJob(db: Db, deps: ServiceDeps, ws: string, req: SubmitInput): Result<{ jobId: string; runJobIds: string[] }> {
  if (!getWorkspace(db, ws)) return missingWorkspace(ws);
  if (typeof req.clientRequestId !== "string" || !/^[A-Za-z0-9_-]{8,100}$/.test(req.clientRequestId)) {
    return fail(400, "INVALID_REQUEST", "clientRequestId must be 8–100 letters, digits, '-' or '_'.");
  }
  if (typeof req.type !== "string" || !(req.type in JOB_TYPES)) {
    return fail(400, "UNKNOWN_JOB_TYPE", "Job type must be supplier_lookup, camera_incident or inventory_audit.");
  }
  const type = req.type as JobType;

  let input: JobInput;
  let title: string;
  if (type === "supplier_lookup") {
    const v = validateLookupRequest(req.input);
    if (!v.ok) return fail(400, v.error.code, v.error.message);
    input = { partName: v.partName, supplierId: v.supplier.id, supplierName: v.supplier.name, request: req.request };
    title = `Find “${v.partName}” on ${v.supplier.name}`;
  } else if (type === "inventory_audit") {
    // Private input: stays in this workspace's job row. Never sent to Gemini or the publisher.
    const csv = (req.input as { csv?: unknown } | null | undefined)?.csv;
    if (typeof csv !== "string" || !csv.trim() || csv.length > CSV_MAX_LENGTH) {
      return fail(400, "INVALID_INPUT", `Attach an inventory CSV of 1–${CSV_MAX_LENGTH} characters (header sku,quantity).`);
    }
    input = { csv, request: req.request };
    title = "Inventory audit (private CSV)";
  } else {
    // The job carries only the station. The simulated fault stays in the simulator controls.
    const station = (req.input as { station?: unknown } | null | undefined)?.station ?? STATION;
    if (station !== STATION) return fail(400, "UNKNOWN_STATION", `Only ${STATION} has a camera in this demo.`);
    input = { station: STATION, request: req.request };
    title = `Camera feed problem at ${STATION} (SIMULATED station)`;
  }

  const clientRequestId = req.clientRequestId;
  return transaction(db, () => {
    const now = deps.now();
    ensureSeeded(db, ws, now);

    // Same submission retried (double click, network retry): return the original job.
    const existing = db
      .prepare("SELECT id FROM jobs WHERE workspace_id = ? AND client_request_id = ?")
      .get(ws, clientRequestId) as { id: string } | undefined;
    if (existing) return { ok: true as const, jobId: existing.id, runJobIds: [] };

    const jobId = deps.newId("job");
    // Reuse a qualified worker kept on the team first; otherwise recommend a hire.
    const decision = routeJob(type, retainedMembers(hires(db, ws)), listMarketplace(db));
    db.prepare(
      `INSERT INTO jobs (id, workspace_id, client_request_id, type, title, input, required_skill, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'needs_worker', ?)`,
    ).run(jobId, ws, clientRequestId, type, title, JSON.stringify(input), decision.requiredSkill, now);
    if (req.conversation?.length) {
      for (const line of req.conversation) addEvent(db, jobId, now, line.actor === "You" ? "You" : DISPATCHER.role, line.text);
    } else {
      addEvent(db, jobId, now, "You", `Submitted: ${title}`);
    }
    if (req.understood) {
      const by = req.engine?.engine === "gemini" ? ` (Gemini ${req.engine.model})` : req.engine ? " (built-in rules)" : "";
      addEvent(db, jobId, now, DISPATCHER.role, `Understood${by} as ${req.understood}`);
    }
    addEvent(db, jobId, now, DISPATCHER.role, decision.note);

    if (decision.kind === "assign") {
      db.prepare("UPDATE jobs SET status = 'queued', hire_id = ?, assigned_at = ? WHERE id = ?").run(decision.hire.id, now, jobId);
      addEvent(db, jobId, now, DISPATCHER.role, `Assigned to ${decision.hire.role}.`);
      const assigned = getHire(db, ws, decision.hire.id)!;
      addHireEvent(db, ws, assigned.id, now, "assigned", `Assigned: ${title}`, jobId);
      if (assigned.instructions) addEvent(db, jobId, now, DISPATCHER.role, `Brief includes ${assigned.role}’s saved instructions: “${assigned.instructions}”`);
      return { ok: true as const, jobId, runJobIds: [jobId] };
    }

    db.prepare("UPDATE jobs SET recommended_profile_id = ? WHERE id = ?").run(decision.recommended?.id ?? null, jobId);
    if (decision.recommended) {
      addEvent(
        db,
        jobId,
        now,
        DISPATCHER.role,
        `Job posting drafted. Waiting for your approval to hire ${decision.recommended.role} at ${formatRate(decision.recommended.hourlyRateCents)}.`,
      );
    }
    return { ok: true as const, jobId, runJobIds: [] };
  });
}

// ---------------------------------------------------------------------------
// Hire
// ---------------------------------------------------------------------------

export interface HireInput {
  profileId: unknown;
  jobId?: unknown;
  /** "job" (default with a jobId): leaves after that job's report. "team": kept for later jobs. */
  retention?: unknown;
  /** Saved with the hire and shown in each job brief. */
  instructions?: unknown;
}

export function approveHire(
  db: Db,
  deps: ServiceDeps,
  ws: string,
  req: HireInput,
): Result<{ hireId: string; created: boolean; runJobIds: string[] }> {
  if (!getWorkspace(db, ws)) return missingWorkspace(ws);
  const profile = typeof req.profileId === "string" ? findListing(db, req.profileId) : undefined;
  if (!profile) return fail(400, "UNKNOWN_PROFILE", "That worker is not in the marketplace.");
  if (req.jobId !== undefined && typeof req.jobId !== "string") return fail(400, "INVALID_REQUEST", "jobId must be a string.");
  const jobId = req.jobId as string | undefined;
  // Hiring for a job defaults to "for this job"; hiring from an empty desk keeps the worker.
  const retention: Retention | null = req.retention === undefined ? (jobId ? "job" : "team") : req.retention === "job" || req.retention === "team" ? req.retention : null;
  if (!retention) return fail(400, "INVALID_REQUEST", "retention must be \"job\" or \"team\".");
  if (retention === "job" && !jobId) return fail(400, "INVALID_REQUEST", "A job-only hire needs the jobId it is hired for.");
  const instructions = cleanInstructions(req.instructions);
  if (instructions === null) return fail(400, "INVALID_INSTRUCTIONS", `Instructions must be text of at most ${INSTRUCTIONS_MAX} characters.`);

  return transaction(db, () => {
    const now = deps.now();
    ensureSeeded(db, ws, now);

    let job: JobRow | undefined;
    if (jobId) {
      job = getJob(db, jobId);
      if (!job || job.workspace_id !== ws) return fail(404, "JOB_NOT_FOUND", "Job not found.");
      if (!profile.skills.includes(job.required_skill)) {
        return fail(400, "NOT_QUALIFIED", `${profile.role} does not have ${SKILLS[job.required_skill]}.`);
      }
      // Approving twice (double click, retry) returns the worker already on this job.
      if (job.status !== "needs_worker" && job.hire_id) return { ok: true as const, hireId: job.hire_id, created: false, runJobIds: [] };
    }

    const team = hires(db, ws);
    let hire = team.find((h) => h.profile_id === profile.id && h.retention === "team");
    let created = false;
    if (!hire) {
      const used = new Set(team.map((h) => h.desk));
      const desk = HIRE_DESKS.find((d) => !used.has(d));
      if (!desk) return fail(409, "NO_OPEN_DESK", "Every desk is taken. A job-only worker frees its desk when its job is done.");
      const id = deps.newId("hire");
      db.prepare(
        `INSERT INTO hires (id, workspace_id, profile_id, role, skills, hourly_rate_cents, source, desk, hired_at, snapshot, retention, job_id, instructions)
         VALUES (?, ?, ?, ?, ?, ?, 'marketplace', ?, ?, ?, ?, ?, ?)`,
      ).run(
        id, ws, profile.id, profile.role, JSON.stringify(profile.skills), profile.hourlyRateCents, desk, now,
        // Snapshot: the exact character, rate, permissions and action settings from the listing.
        JSON.stringify(snapshotOf(profile)), retention, jobId ?? null, instructions,
      );
      hire = getHire(db, ws, id)!;
      created = true;
      const terms = retention === "job" ? "for this job only" : "and kept on the team";
      addHireEvent(db, ws, id, now, "hired", `Hired ${terms} at ${formatRate(profile.hourlyRateCents)}${profile.kind === "community" ? ` (community listing by ${profile.publisher.name})` : ""}. Arrived at ${deskLabel(desk)}.`, jobId ?? null);
      if (instructions) addHireEvent(db, ws, id, now, "instructions", `Instructions saved: “${instructions}”`);
      if (job) {
        addEvent(db, job.id, now, "You", `Approved hiring ${profile.characterName} (${profile.role}${profile.kind === "community" ? `, community listing by ${profile.publisher.name}` : ""}) at ${formatRate(profile.hourlyRateCents)}, ${terms}.`);
        addEvent(db, job.id, now, profile.role, `Arrived at ${deskLabel(desk)}.`);
      }
    }

    // A job-only hire takes only its own job. A retained hire resumes every waiting job it can do.
    const waiting = hire.retention === "job"
      ? [job!]
      : (db.prepare("SELECT * FROM jobs WHERE workspace_id = ? AND status = 'needs_worker' ORDER BY created_at").all(ws) as unknown as JobRow[])
          .filter((w) => profile.skills.includes(w.required_skill));
    const runJobIds: string[] = [];
    for (const w of waiting) {
      const moved = db.prepare("UPDATE jobs SET status = 'queued', hire_id = ?, assigned_at = ? WHERE id = ? AND status = 'needs_worker'").run(hire.id, now, w.id);
      if (!moved.changes) continue;
      addEvent(db, w.id, now, DISPATCHER.role, `Resumed the original job automatically: assigned to ${hire.role}.`);
      addHireEvent(db, ws, hire.id, now, "assigned", `Assigned: ${w.title}`, w.id);
      if (hire.instructions) addEvent(db, w.id, now, DISPATCHER.role, `Brief includes ${hire.role}’s saved instructions: “${hire.instructions}”`);
      runJobIds.push(w.id);
    }
    return { ok: true as const, hireId: hire.id, created, runJobIds };
  });
}

/**
 * Change a hire: keep a job-only worker on the team (at approval or while the job runs),
 * release a retained worker (leaves now if idle, after its current job otherwise),
 * or save its instructions. Recorded in the hire's history.
 */
export function updateHire(
  db: Db,
  deps: ServiceDeps,
  ws: string,
  hireId: unknown,
  req: { retention?: unknown; instructions?: unknown },
): Result<{ hireId: string }> {
  if (!getWorkspace(db, ws)) return missingWorkspace(ws);
  if (typeof hireId !== "string") return fail(404, "HIRE_NOT_FOUND", "Worker not found.");
  if (req.retention !== undefined && req.retention !== "team" && req.retention !== "job") return fail(400, "INVALID_REQUEST", "retention must be \"job\" or \"team\".");
  const instructions = req.instructions === undefined ? undefined : cleanInstructions(req.instructions);
  if (instructions === null) return fail(400, "INVALID_INSTRUCTIONS", `Instructions must be text of at most ${INSTRUCTIONS_MAX} characters.`);
  return transaction(db, () => {
    const now = deps.now();
    const hire = getHire(db, ws, hireId);
    if (!hire) return fail(404, "HIRE_NOT_FOUND", "Worker not found.");
    if (hire.departed_at !== null) return fail(409, "HIRE_DEPARTED", `${hire.role} has already left this office.`);
    if (req.retention !== undefined && hire.source === "staff") return fail(400, "STAFF_RETAINED", "Built-in staff always stay on the team.");

    if (req.retention === "team" && hire.retention === "job") {
      const other = hires(db, ws).find((h) => h.id !== hire.id && h.profile_id === hire.profile_id && h.retention === "team");
      if (other) return fail(409, "ALREADY_ON_TEAM", `Another ${hire.role} is already kept on this team.`);
      db.prepare("UPDATE hires SET retention = 'team' WHERE workspace_id = ? AND id = ?").run(ws, hire.id);
      addHireEvent(db, ws, hire.id, now, "kept", "Kept on the team. Later jobs that need its skills will reuse this worker.", hire.job_id);
      if (hire.job_id) addEvent(db, hire.job_id, now, "You", `Kept ${hire.role} on the team after this job.`);
    } else if (req.retention === "job" && hire.retention === "team") {
      const active = db.prepare("SELECT id FROM jobs WHERE workspace_id = ? AND hire_id = ? AND status IN ('queued', 'working') ORDER BY created_at DESC LIMIT 1").get(ws, hire.id) as { id: string } | undefined;
      if (active) {
        db.prepare("UPDATE hires SET retention = 'job', job_id = ? WHERE workspace_id = ? AND id = ?").run(active.id, ws, hire.id);
        addHireEvent(db, ws, hire.id, now, "released", "Released from the team. Will leave after the current job’s report.", active.id);
      } else {
        db.prepare("UPDATE hires SET retention = 'job', departed_at = ? WHERE workspace_id = ? AND id = ?").run(now, ws, hire.id);
        addHireEvent(db, ws, hire.id, now, "departed", "Released from the team and left the office.");
      }
    }
    if (instructions !== undefined && instructions !== hire.instructions) {
      db.prepare("UPDATE hires SET instructions = ? WHERE workspace_id = ? AND id = ?").run(instructions, ws, hire.id);
      addHireEvent(db, ws, hire.id, now, "instructions", instructions ? `Instructions saved: “${instructions}”` : "Instructions cleared.");
    }
    return { ok: true as const, hireId: hire.id };
  });
}

/** Run the inventory action of a worker in this office directly from its profile (Codex's flow). */
export function submitAgentJob(db: Db, deps: ServiceDeps, ws: string, hireId: unknown, req: { clientRequestId: unknown; csv: unknown }): Result<{ jobId: string; runJobIds: string[] }> {
  if (!getWorkspace(db, ws)) return missingWorkspace(ws);
  if (typeof hireId !== "string") return fail(404, "HIRE_NOT_FOUND", "Worker not found.");
  const hire = hires(db, ws).find((h) => h.id === hireId);
  if (!hire) return fail(404, "HIRE_NOT_FOUND", "Worker not found.");
  if (!snapshot(hire).actionConfig) return fail(400, "UNSUPPORTED_ACTION", "This hire does not support inventory audits.");
  if (hire.retention !== "team") return fail(409, "HIRED_FOR_ONE_JOB", "This worker was hired for one job. Keep it on the team to give it more work.");
  if (typeof req.csv !== "string" || !req.csv.trim() || req.csv.length > CSV_MAX_LENGTH) return fail(400, "INVALID_INPUT", `Submit 1–${CSV_MAX_LENGTH} characters of inventory CSV.`);
  if (typeof req.clientRequestId !== "string" || !/^[A-Za-z0-9_-]{8,100}$/.test(req.clientRequestId)) return fail(400, "INVALID_REQUEST", "A valid request ID is required.");
  return transaction(db, () => {
    const existing = db.prepare("SELECT id FROM jobs WHERE workspace_id = ? AND client_request_id = ?").get(ws, req.clientRequestId as string) as { id: string } | undefined;
    if (existing) return { ok: true as const, jobId: existing.id, runJobIds: [] };
    const now = deps.now(), jobId = deps.newId("job");
    const title = `Inventory audit by ${hire.role}`;
    db.prepare(`INSERT INTO jobs (id, workspace_id, client_request_id, type, title, input, required_skill, status, hire_id, created_at, assigned_at)
      VALUES (?, ?, ?, 'inventory_audit', ?, ?, 'inventory_audit', 'queued', ?, ?, ?)`)
      .run(jobId, ws, req.clientRequestId as string, title, JSON.stringify({ csv: req.csv, request: "Audit this inventory CSV for low stock and calculate restock quantities." }), hire.id, now, now);
    addEvent(db, jobId, now, "You", "Submitted a private inventory CSV for a local audit.");
    addEvent(db, jobId, now, DISPATCHER.role, `Needs: Inventory audit. ${hire.role} is on the team with the inventory_audit action. Assigned to ${hire.role}.`);
    addHireEvent(db, ws, hire.id, now, "assigned", `Assigned: ${title}`, jobId);
    return { ok: true as const, jobId, runJobIds: [jobId] };
  });
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

export async function runJob(db: Db, deps: ServiceDeps, jobId: string): Promise<void> {
  const startedAt = deps.now();
  // Claim: only one runner may move a job from queued to working.
  const claim = db.prepare("UPDATE jobs SET status = 'working', started_at = ? WHERE id = ? AND status = 'queued'").run(startedAt, jobId);
  if (claim.changes !== 1) return;

  const job = getJob(db, jobId)!;
  const hire = db.prepare("SELECT * FROM hires WHERE workspace_id = ? AND id = ?").get(job.workspace_id, job.hire_id) as unknown as HireRow;
  addEvent(db, jobId, startedAt, hire.role, "Left the desk to start work.");

  try {
    const input = JSON.parse(job.input) as JobInput;
    let mode: ReportMode;
    let outcome: ReportOutcome;
    let summary: string;
    let body: ReportBody;

    if (job.type === "supplier_lookup" && "partName" in input) {
      const supplier = findSupplier(input.supplierId);
      if (!supplier) throw Object.assign(new Error("Supplier is no longer approved."), { code: "UNKNOWN_SUPPLIER" });
      const response = await deps.lookup(input.partName, supplier);
      if (!response.ok) {
        finishFailed(db, deps, job, hire, response.error);
        return;
      }
      const r = response.result;
      mode = r.mode;
      outcome = r.match === "exact" ? "found" : r.match;
      summary =
        r.match === "not_found"
          ? `No listing for “${r.partName}” on ${r.supplier.name}.`
          : r.match === "ambiguous"
            ? `Ambiguous: ${r.candidates.length || "several"} possible listings on ${r.supplier.name}.`
            : `${r.itemName}: ${r.availabilityText ?? r.availability} at ${r.supplier.name}.`;
      body = { type: "supplier_lookup", result: r };
    } else if (job.type === "inventory_audit" && "csv" in input) {
      // Real local execution with the thresholds from the hire's snapshot, never from the request.
      const config: InventoryConfig | null = snapshot(hire).actionConfig;
      if (!config) throw Object.assign(new Error("The hired agent does not support inventory audits."), { code: "UNSUPPORTED_ACTION" });
      let result;
      try { result = auditInventory(input.csv, config); } catch (e) { throw Object.assign(e as Error, { code: "INVALID_INPUT" }); }
      mode = "local";
      outcome = "audited";
      summary = `Audited ${result.rowCount} SKUs: ${result.lowStockCount} below minimum; ${result.totalRestockUnits} units to reach the restock target.`;
      body = { type: "inventory_audit", result, listingName: hire.role };
    } else if (job.type === "camera_incident") {
      // The simulated station emits observations for the fault set in the simulator
      // controls. The Inspector's decisions come only from those observations.
      const fault = getCameraFault(db, job.workspace_id);
      const scenario = SCENARIOS.find((s) => s.id === fault)!;
      const station = "station" in input ? input.station : STATION;
      const incident = runScenario(scenario, scenario.steps.length, startedAt, station)!;
      const report = cameraReport(incident);
      mode = "simulated";
      outcome = incident.status === "resolved" ? "resolved" : "incident_open";
      summary = incident.status === "resolved" ? "Fresh frame received. Incident resolved." : `Incident still open: ${report.heading}.`;
      body = { type: "camera_incident", incident, simulatorFault: scenario.id };
    } else {
      throw Object.assign(new Error("Job input does not match its type."), { code: "INVALID_JOB" });
    }

    const finishedAt = deps.now();
    const runtimeMs = Math.max(0, finishedAt - startedAt);
    transaction(db, () => {
      db.prepare(
        `INSERT INTO reports (id, workspace_id, job_id, hire_id, mode, outcome, summary, body, runtime_ms, hourly_rate_cents, demo_cost_cents, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        deps.newId("rpt"),
        job.workspace_id,
        jobId,
        hire.id,
        mode,
        outcome,
        summary,
        JSON.stringify(body),
        runtimeMs,
        hire.hourly_rate_cents,
        demoCostCents(hire.hourly_rate_cents, runtimeMs),
        finishedAt,
      );
      db.prepare("UPDATE jobs SET status = 'completed', finished_at = ? WHERE id = ?").run(finishedAt, jobId);
      const cost = demoCostCents(hire.hourly_rate_cents, runtimeMs);
      addEvent(db, jobId, finishedAt, "System", cost === null
        ? `Execution finished after ${(runtimeMs / 1000).toFixed(1)} s. Staff time is not billed.`
        : `Execution finished. Demo meter stopped at ${formatCost(cost)} (${(runtimeMs / 1000).toFixed(1)} s at ${formatRate(hire.hourly_rate_cents)}). Report saved.`);
      addEvent(db, jobId, finishedAt, hire.role, `Returned with a ${mode.toUpperCase()} report: ${summary}`);
      afterJob(db, job, hire, finishedAt, `${mode.toUpperCase()} report saved`);
    });
  } catch (err) {
    const code = (err as { code?: string }).code ?? "RUN_FAILED";
    finishFailed(db, deps, job, hire, { code, message: err instanceof Error ? err.message : "Run failed." });
  }
}

function finishFailed(db: Db, deps: ServiceDeps, job: JobRow, hire: HireRow, error: ApiError) {
  const at = deps.now();
  transaction(db, () => {
    db.prepare("UPDATE jobs SET status = 'failed', finished_at = ?, error = ? WHERE id = ?").run(at, JSON.stringify(error), job.id);
    addEvent(db, job.id, at, "System", "Execution stopped without a report. Demo meter stopped; nothing is billed for a failed job.");
    addEvent(db, job.id, at, hire.role, `Returned without a report: ${error.code}. ${error.message}`);
    afterJob(db, job, hire, at, `no report (${error.code})`);
  });
}

/** Fail jobs stuck in "working" and return queued jobs that still need a runner. */
export function recoverJobs(db: Db, ws: string, now: number): string[] {
  const stale = db
    .prepare("SELECT id FROM jobs WHERE workspace_id = ? AND status = 'working' AND started_at < ?")
    .all(ws, now - STALE_WORKING_MS) as { id: string }[];
  for (const { id } of stale) {
    const error = { code: "INTERRUPTED", message: "The run was interrupted (server stopped). Submit the job again." };
    db.prepare("UPDATE jobs SET status = 'failed', finished_at = ?, error = ? WHERE id = ? AND status = 'working'").run(
      now,
      JSON.stringify(error),
      id,
    );
    addEvent(db, id, now, "System", error.message);
    const job = getJob(db, id)!;
    const hire = job.hire_id ? getHire(db, ws, job.hire_id) : undefined;
    if (hire) afterJob(db, job, hire, now, "no report (INTERRUPTED)");
  }
  const queued = db.prepare("SELECT id FROM jobs WHERE workspace_id = ? AND status = 'queued'").all(ws) as { id: string }[];
  return queued.map((q) => q.id);
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/** Full state of one workspace, or null when it does not exist. */
export function getState(
  db: Db,
  ws: string,
  procurementMode: LookupMode,
  now: number,
  dispatcher: DispatcherInfo = { engine: "rules", model: null },
): WorkplaceState | null {
  const workspace = getWorkspace(db, ws);
  if (!workspace) return null;
  ensureSeeded(db, ws, now);
  const hireRows = hires(db, ws);
  const formerRows = db
    .prepare("SELECT * FROM hires WHERE workspace_id = ? AND departed_at IS NOT NULL ORDER BY departed_at DESC, id LIMIT 20")
    .all(ws) as unknown as HireRow[];
  const allRows = [...hireRows, ...formerRows];
  const hireEvents = allRows.length
    ? (db.prepare(`SELECT hire_id, at, kind, text, job_id FROM hire_events WHERE workspace_id = ? AND hire_id IN (${allRows.map(() => "?").join(",")}) ORDER BY id`)
        .all(ws, ...allRows.map((h) => h.id)) as unknown as (HireEventView & { hire_id: string; job_id: string | null })[])
    : [];
  const jobRows = db
    .prepare("SELECT * FROM jobs WHERE workspace_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 50")
    .all(ws) as unknown as JobRow[];
  const ids = jobRows.map((j) => j.id);
  const placeholders = ids.map(() => "?").join(",");
  const events = ids.length
    ? (db.prepare(`SELECT job_id, at, actor, text FROM job_events WHERE job_id IN (${placeholders}) ORDER BY id`).all(...ids) as unknown as {
        job_id: string;
        at: number;
        actor: string;
        text: string;
      }[])
    : [];
  const reports = ids.length
    ? (db.prepare(`SELECT * FROM reports WHERE workspace_id = ? AND job_id IN (${placeholders})`).all(ws, ...ids) as unknown as ReportRow[])
    : [];
  const completedCounts = db
    .prepare("SELECT hire_id, COUNT(*) AS n FROM jobs WHERE workspace_id = ? AND status = 'completed' GROUP BY hire_id")
    .all(ws) as unknown as { hire_id: string; n: number }[];

  const view = (h: HireRow): HireView => {
    const snap = snapshot(h);
    const active = jobRows.find((j) => j.hire_id === h.id && (j.status === "working" || j.status === "queued"));
    const listing = findProfile(h.profile_id);
    return {
      id: h.id,
      profileId: h.profile_id,
      role: h.role,
      initials: listing?.initials ?? initialsOf(h.role),
      color: listing?.color ?? "blue",
      specialty: snap.specialty,
      skills: JSON.parse(h.skills),
      permissions: snap.permissions,
      hourlyRateCents: h.hourly_rate_cents,
      source: h.source,
      desk: h.desk,
      hiredAt: h.hired_at,
      activeJobId: active?.id ?? null,
      completedJobs: completedCounts.find((c) => c.hire_id === h.id)?.n ?? 0,
      characterName: snap.characterName,
      sprite: snap.sprite,
      listingKind: snap.kind === "staff" ? null : snap.kind,
      publisherName: snap.kind === "staff" ? null : snap.publisherName,
      greeting: snap.greeting,
      actionConfig: snap.actionConfig,
      retention: h.retention,
      jobId: h.job_id,
      instructions: h.instructions,
      departedAt: h.departed_at,
      history: hireEvents.filter((e) => e.hire_id === h.id).slice(-30).map(({ at, kind, text, job_id }) => ({ at, kind, text, jobId: job_id })),
    };
  };
  const team = hireRows.map(view);
  const smsJobs = ids.length
    ? (db.prepare(`SELECT job_id, code, phone FROM sms_jobs WHERE workspace_id = ? AND job_id IN (${placeholders})`).all(ws, ...ids) as unknown as { job_id: string; code: string; phone: string }[])
    : [];
  const formerHires = formerRows.map(view);
  const anyHire = (id: string | null) => allRows.find((h) => h.id === id) ?? (id ? getHire(db, ws, id) : undefined);

  const jobs: JobView[] = jobRows.map((j) => {
    const r = reports.find((x) => x.job_id === j.id);
    const sms = smsJobs.find((x) => x.job_id === j.id);
    return {
      id: j.id,
      type: j.type,
      title: j.title,
      input: JSON.parse(j.input),
      requiredSkill: j.required_skill,
      status: j.status,
      hireId: j.hire_id,
      hireRole: anyHire(j.hire_id)?.role ?? null,
      sms: sms ? { code: sms.code, ...(sms.phone.startsWith("+999") ? { simulated: true } : {}), phone: `•••${sms.phone.slice(-4)}` } : null,
      hireName: (() => { const h = anyHire(j.hire_id); return h ? snapshot(h).characterName : null; })(),
      recommendedProfileId: j.recommended_profile_id,
      createdAt: j.created_at,
      assignedAt: j.assigned_at,
      startedAt: j.started_at,
      finishedAt: j.finished_at,
      error: j.error ? JSON.parse(j.error) : null,
      events: events.filter((e) => e.job_id === j.id).map(({ at, actor, text }) => ({ at, actor, text })),
      report: r
        ? {
            id: r.id,
            mode: r.mode,
            outcome: r.outcome,
            summary: r.summary,
            body: JSON.parse(r.body),
            runtimeMs: r.runtime_ms,
            hourlyRateCents: r.hourly_rate_cents,
            demoCostCents: r.demo_cost_cents,
            createdAt: r.created_at,
          }
        : null,
    };
  });

  return {
    workspaceId: ws,
    workspace: { id: workspace.id, name: workspace.name },
    procurementMode,
    team,
    jobs,
    formerHires,
    dispatcher,
    marketplace: listMarketplace(db).map((p) => ({ ...p, hired: hireRows.some((h) => h.profile_id === p.id && h.retention === "team") })),
    simulator: { cameraFault: getCameraFault(db, ws) },
  };
}

// ---------------------------------------------------------------------------
// Marketplace listings
// ---------------------------------------------------------------------------

interface ListingRow {
  id: string;
  creator_sub: string;
  client_request_id: string;
  creator_name: string;
  character_name: string;
  role: string;
  description: string;
  greeting: string;
  skills: string;
  hourly_rate_cents: number;
  sample_work: string;
  action_config: string | null;
  sprite: string;
  published_at: number;
}

function toListing(r: ListingRow, viewerSub?: string): MarketplaceListing {
  const skills = JSON.parse(r.skills) as SkillId[];
  return {
    id: r.id,
    kind: "community",
    verified: false,
    characterName: r.character_name,
    role: r.role,
    initials: initialsOf(r.role),
    color: "blue",
    specialty: r.description,
    greeting: r.greeting,
    skills,
    hourlyRateCents: r.hourly_rate_cents,
    sampleWork: r.sample_work,
    permissions: permissionsFor(skills),
    sprite: readSprite(r.sprite, r.id),
    publisher: { name: r.creator_name, isYou: viewerSub !== undefined && r.creator_sub === viewerSub },
    publishedAt: r.published_at,
    actionConfig: r.action_config ? (JSON.parse(r.action_config) as InventoryConfig) : null,
  };
}

/** Official listings first (catalog order), then community listings oldest first. Never exposes creator_sub. */
export function listMarketplace(db: Db, viewerSub?: string): MarketplaceListing[] {
  const rows = db.prepare("SELECT * FROM marketplace_listings ORDER BY published_at, id").all() as unknown as ListingRow[];
  return [...OFFICIAL_LISTINGS, ...rows.map((r) => toListing(r, viewerSub))];
}

export function findListing(db: Db, id: string): MarketplaceListing | undefined {
  const official = OFFICIAL_LISTINGS.find((l) => l.id === id);
  if (official) return official;
  const row = db.prepare("SELECT * FROM marketplace_listings WHERE id = ?").get(id) as unknown as ListingRow | undefined;
  return row ? toListing(row) : undefined;
}

export interface PublishInput {
  clientRequestId: unknown;
  listing: unknown;
}

export type PublishResult =
  | { ok: true; listing: MarketplaceListing; created: boolean }
  | { ok: false; status: number; error: ApiError & { fields?: Partial<Record<PublishField, string>> } };

const REQUEST_ID = /^[A-Za-z0-9_-]{8,100}$/;

/** Publishes a community listing owned by the signed-in user. Retrying with the same clientRequestId returns the first listing. */
export function publishListing(db: Db, deps: ServiceDeps, ownerSub: string, req: PublishInput): PublishResult {
  if (typeof req.clientRequestId !== "string" || !REQUEST_ID.test(req.clientRequestId)) {
    return fail(400, "INVALID_REQUEST", "clientRequestId must be 8–100 letters, digits, '-' or '_'.");
  }
  const clientRequestId = req.clientRequestId;
  return transaction(db, (): PublishResult => {
    const existing = db
      .prepare("SELECT * FROM marketplace_listings WHERE creator_sub = ? AND client_request_id = ?")
      .get(ownerSub, clientRequestId) as unknown as ListingRow | undefined;
    if (existing) return { ok: true, listing: toListing(existing, ownerSub), created: false };

    const v = validatePublish(req.listing);
    if (!v.ok) return { ok: false, status: 400, error: { code: "INVALID_LISTING", message: "Some listing fields need attention.", fields: v.errors } };
    const count = (db.prepare("SELECT COUNT(*) AS n FROM marketplace_listings WHERE creator_sub = ?").get(ownerSub) as { n: number }).n;
    if (count >= PUBLISH_LIMITS.perPublisher) {
      return fail(409, "LISTING_LIMIT", `You can publish up to ${PUBLISH_LIMITS.perPublisher} agents.`);
    }
    const d = v.draft;
    const slug = d.characterName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "agent";
    const id = `community-${slug}-${deps.newId("l").replace(/[^A-Za-z0-9]/g, "").slice(-6).toLowerCase()}`;
    db.prepare(
      `INSERT INTO marketplace_listings (id, creator_sub, client_request_id, creator_name, character_name, role, description,
         greeting, skills, hourly_rate_cents, sample_work, action_config, sprite, published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, ownerSub, clientRequestId, d.publisherName, d.characterName, d.role, d.specialty, d.greeting,
      JSON.stringify(d.skills), d.hourlyRateCents, d.sampleWork, d.actionConfig ? JSON.stringify(d.actionConfig) : null, JSON.stringify(d.sprite), deps.now());
    const row = db.prepare("SELECT * FROM marketplace_listings WHERE id = ?").get(id) as unknown as ListingRow;
    return { ok: true, listing: toListing(row, ownerSub), created: true };
  });
}

export interface HireTarget {
  id: string;
  name: string;
  openDesks: number;
  hiredListingIds: string[];
}

/** The caller's offices, for the marketplace's workspace picker. */
export function hireTargets(db: Db, ownerSub: string): HireTarget[] {
  return listWorkspaces(db, ownerSub).map((w) => {
    const rows = db.prepare("SELECT profile_id, desk, retention FROM hires WHERE workspace_id = ? AND departed_at IS NULL").all(w.id) as { profile_id: string; desk: string; retention: Retention }[];
    return {
      id: w.id,
      name: w.name,
      openDesks: HIRE_DESKS.filter((d) => !rows.some((r) => r.desk === d)).length,
      // Workers kept on the team; a job-only copy of a listing does not block keeping one.
      hiredListingIds: rows.filter((r) => r.retention === "team").map((r) => r.profile_id),
    };
  });
}

// The workplace flow: submit job -> Dispatcher routes -> (approve hire) ->
// job resumes automatically -> worker runs -> report saved. Every state change
// is persisted in SQLite and recorded as a job event.

import { randomUUID } from "node:crypto";
import {
  DISPATCHER,
  HIRE_DESKS,
  JOB_TYPES,
  MARKETPLACE,
  SKILLS,
  STAFF,
  STAFF_DESK,
  demoCostCents,
  findProfile,
  formatRate,
  type JobType,
  type SkillId,
} from "./catalog.ts";
import { routeJob, type TeamMember } from "./dispatcher.ts";
import { transaction, type Db } from "./db.server.ts";
import type {
  ApiError,
  HireView,
  JobInput,
  JobStatus,
  JobView,
  ReportBody,
  ReportMode,
  ReportOutcome,
  WorkplaceState,
} from "./types.ts";
import { validateLookupRequest, findSupplier, type LookupMode, type LookupResponse, type Supplier } from "../procurement.ts";
import { SCENARIOS, runScenario } from "../camera-incident.ts";
import { cameraReport } from "../office-camera-report.ts";

export const WORKSPACE_ID = "demo";
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

function hires(db: Db, ws: string): HireRow[] {
  return db.prepare("SELECT * FROM hires WHERE workspace_id = ? ORDER BY hired_at, id").all(ws) as unknown as HireRow[];
}

function getJob(db: Db, id: string): JobRow | undefined {
  return db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as unknown as JobRow | undefined;
}

function toMember(h: HireRow): TeamMember {
  return { id: h.id, profileId: h.profile_id, role: h.role, skills: JSON.parse(h.skills), hiredAt: h.hired_at };
}

function addEvent(db: Db, jobId: string, at: number, actor: string, text: string) {
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
    db.prepare(
      `INSERT OR IGNORE INTO hires (id, workspace_id, profile_id, role, skills, hourly_rate_cents, source, desk, hired_at)
       VALUES (?, ?, ?, ?, ?, ?, 'staff', ?, ?)`,
    ).run(`staff_${profile.id}`, ws, profile.id, profile.role, JSON.stringify(profile.skills), profile.hourlyRateCents, STAFF_DESK, now);
  }
}

export function resetWorkspace(db: Db, ws: string, now: number) {
  transaction(db, () => {
    db.prepare("DELETE FROM reports WHERE job_id IN (SELECT id FROM jobs WHERE workspace_id = ?)").run(ws);
    db.prepare("DELETE FROM job_events WHERE job_id IN (SELECT id FROM jobs WHERE workspace_id = ?)").run(ws);
    db.prepare("DELETE FROM jobs WHERE workspace_id = ?").run(ws);
    db.prepare("DELETE FROM hires WHERE workspace_id = ?").run(ws);
    ensureSeeded(db, ws, now);
  });
}

// ---------------------------------------------------------------------------
// Submit
// ---------------------------------------------------------------------------

export interface SubmitInput {
  clientRequestId: unknown;
  type: unknown;
  input: unknown;
}

export function submitJob(db: Db, deps: ServiceDeps, ws: string, req: SubmitInput): Result<{ jobId: string; runJobIds: string[] }> {
  if (typeof req.clientRequestId !== "string" || !/^[A-Za-z0-9_-]{8,100}$/.test(req.clientRequestId)) {
    return fail(400, "INVALID_REQUEST", "clientRequestId must be 8–100 letters, digits, '-' or '_'.");
  }
  if (typeof req.type !== "string" || !(req.type in JOB_TYPES)) {
    return fail(400, "UNKNOWN_JOB_TYPE", "Job type must be supplier_lookup or camera_incident.");
  }
  const type = req.type as JobType;

  let input: JobInput;
  let title: string;
  if (type === "supplier_lookup") {
    const v = validateLookupRequest(req.input);
    if (!v.ok) return fail(400, v.error.code, v.error.message);
    input = { partName: v.partName, supplierId: v.supplier.id, supplierName: v.supplier.name };
    title = `Find “${v.partName}” on ${v.supplier.name}`;
  } else {
    const scenarioId = (req.input as { scenarioId?: unknown } | null)?.scenarioId;
    const scenario = SCENARIOS.find((s) => s.id === scenarioId);
    if (!scenario) return fail(400, "UNKNOWN_SCENARIO", "Choose one of the simulated camera cases.");
    input = { scenarioId: scenario.id, scenarioTitle: scenario.title };
    title = `Camera feed stopped at Packing Station 1 (SIMULATED · ${scenario.title.split(" · ")[0]})`;
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
    const decision = routeJob(type, hires(db, ws).map(toMember));
    db.prepare(
      `INSERT INTO jobs (id, workspace_id, client_request_id, type, title, input, required_skill, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'needs_worker', ?)`,
    ).run(jobId, ws, clientRequestId, type, title, JSON.stringify(input), decision.requiredSkill, now);
    addEvent(db, jobId, now, "You", `Submitted: ${title}`);
    addEvent(db, jobId, now, DISPATCHER.role, decision.note);

    if (decision.kind === "assign") {
      db.prepare("UPDATE jobs SET status = 'queued', hire_id = ?, assigned_at = ? WHERE id = ?").run(decision.hire.id, now, jobId);
      addEvent(db, jobId, now, DISPATCHER.role, `Assigned to ${decision.hire.role}.`);
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
}

export function approveHire(
  db: Db,
  deps: ServiceDeps,
  ws: string,
  req: HireInput,
): Result<{ hireId: string; created: boolean; runJobIds: string[] }> {
  const profile = MARKETPLACE.find((p) => p.id === req.profileId);
  if (!profile) return fail(400, "UNKNOWN_PROFILE", "That worker is not in the marketplace.");
  if (req.jobId !== undefined && typeof req.jobId !== "string") return fail(400, "INVALID_REQUEST", "jobId must be a string.");
  const jobId = req.jobId as string | undefined;

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
    }

    const team = hires(db, ws);
    let hire = team.find((h) => h.profile_id === profile.id);
    let created = false;
    if (!hire) {
      const used = new Set(team.map((h) => h.desk));
      const desk = HIRE_DESKS.find((d) => !used.has(d));
      if (!desk) return fail(409, "NO_OPEN_DESK", "Every desk is taken.");
      const id = deps.newId("hire");
      db.prepare(
        `INSERT INTO hires (id, workspace_id, profile_id, role, skills, hourly_rate_cents, source, desk, hired_at)
         VALUES (?, ?, ?, ?, ?, ?, 'marketplace', ?, ?)`,
      ).run(id, ws, profile.id, profile.role, JSON.stringify(profile.skills), profile.hourlyRateCents, desk, now);
      hire = hires(db, ws).find((h) => h.id === id)!;
      created = true;
      if (job) {
        addEvent(db, job.id, now, "You", `Approved hiring ${profile.role} at ${formatRate(profile.hourlyRateCents)}.`);
        addEvent(db, job.id, now, profile.role, `Arrived at ${deskLabel(desk)}.`);
      }
    }

    // Resume every waiting job this hire can now do, starting with the approved one.
    const waiting = db
      .prepare("SELECT * FROM jobs WHERE workspace_id = ? AND status = 'needs_worker' ORDER BY created_at")
      .all(ws) as unknown as JobRow[];
    const runJobIds: string[] = [];
    for (const w of waiting) {
      if (!profile.skills.includes(w.required_skill)) continue;
      db.prepare("UPDATE jobs SET status = 'queued', hire_id = ?, assigned_at = ? WHERE id = ? AND status = 'needs_worker'").run(
        hire.id,
        now,
        w.id,
      );
      addEvent(db, w.id, now, DISPATCHER.role, `Resumed the original job automatically: assigned to ${hire.role}.`);
      runJobIds.push(w.id);
    }
    return { ok: true as const, hireId: hire.id, created, runJobIds };
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
  const hire = db.prepare("SELECT * FROM hires WHERE id = ?").get(job.hire_id) as unknown as HireRow;
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
    } else if (job.type === "camera_incident" && "scenarioId" in input) {
      const scenario = SCENARIOS.find((s) => s.id === input.scenarioId);
      if (!scenario) throw Object.assign(new Error("Unknown simulated case."), { code: "UNKNOWN_SCENARIO" });
      const incident = runScenario(scenario, scenario.steps.length, startedAt, "Packing Station 1")!;
      const report = cameraReport(incident);
      mode = "simulated";
      outcome = incident.status === "resolved" ? "resolved" : "incident_open";
      summary = incident.status === "resolved" ? "Fresh frame received. Incident resolved." : `Incident still open: ${report.heading}.`;
      body = { type: "camera_incident", incident };
    } else {
      throw Object.assign(new Error("Job input does not match its type."), { code: "INVALID_JOB" });
    }

    const finishedAt = deps.now();
    const runtimeMs = Math.max(0, finishedAt - startedAt);
    transaction(db, () => {
      db.prepare(
        `INSERT INTO reports (id, job_id, hire_id, mode, outcome, summary, body, runtime_ms, hourly_rate_cents, demo_cost_cents, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        deps.newId("rpt"),
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
      addEvent(db, jobId, finishedAt, hire.role, `Returned with a ${mode.toUpperCase()} report: ${summary}`);
    });
  } catch (err) {
    const code = (err as { code?: string }).code ?? "RUN_FAILED";
    finishFailed(db, deps, job, hire, { code, message: err instanceof Error ? err.message : "Run failed." });
  }
}

function finishFailed(db: Db, deps: ServiceDeps, job: JobRow, hire: HireRow, error: ApiError) {
  const at = deps.now();
  db.prepare("UPDATE jobs SET status = 'failed', finished_at = ?, error = ? WHERE id = ?").run(at, JSON.stringify(error), job.id);
  addEvent(db, job.id, at, hire.role, `Returned without a report: ${error.code}. ${error.message}`);
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
  }
  const queued = db.prepare("SELECT id FROM jobs WHERE workspace_id = ? AND status = 'queued'").all(ws) as { id: string }[];
  return queued.map((q) => q.id);
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export function getState(db: Db, ws: string, procurementMode: LookupMode, now: number): WorkplaceState {
  ensureSeeded(db, ws, now);
  const hireRows = hires(db, ws);
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
    ? (db.prepare(`SELECT * FROM reports WHERE job_id IN (${placeholders})`).all(...ids) as unknown as ReportRow[])
    : [];
  const completedCounts = db
    .prepare("SELECT hire_id, COUNT(*) AS n FROM jobs WHERE workspace_id = ? AND status = 'completed' GROUP BY hire_id")
    .all(ws) as unknown as { hire_id: string; n: number }[];

  const team: HireView[] = hireRows.map((h) => {
    const profile = findProfile(h.profile_id);
    const active = jobRows.find((j) => j.hire_id === h.id && (j.status === "working" || j.status === "queued"));
    return {
      id: h.id,
      profileId: h.profile_id,
      role: h.role,
      initials: profile?.initials ?? h.role.slice(0, 2).toUpperCase(),
      color: profile?.color ?? "blue",
      specialty: profile?.specialty ?? "",
      skills: JSON.parse(h.skills),
      hourlyRateCents: h.hourly_rate_cents,
      source: h.source,
      desk: h.desk,
      hiredAt: h.hired_at,
      activeJobId: active?.id ?? null,
      completedJobs: completedCounts.find((c) => c.hire_id === h.id)?.n ?? 0,
    };
  });

  const jobs: JobView[] = jobRows.map((j) => {
    const r = reports.find((x) => x.job_id === j.id);
    return {
      id: j.id,
      type: j.type,
      title: j.title,
      input: JSON.parse(j.input),
      requiredSkill: j.required_skill,
      status: j.status,
      hireId: j.hire_id,
      hireRole: hireRows.find((h) => h.id === j.hire_id)?.role ?? null,
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
    procurementMode,
    team,
    jobs,
    marketplace: MARKETPLACE.map((p) => ({ ...p, hired: hireRows.some((h) => h.profile_id === p.id) })),
  };
}

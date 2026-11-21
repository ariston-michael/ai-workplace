import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { defaultDbPath } from "../workplace/db.server.ts";
import type { JobView, JobEventView, ReportView } from "../workplace/types.ts";

type JobRow = Omit<JobView, "input" | "error" | "events" | "report"> & { input: string; error: string | null };
type EventRow = JobEventView & { jobId: string };
type ReportRow = Omit<ReportView, "body"> & { jobId: string; body: string };

/** Snapshot only: never seed, recover, schedule, or run jobs when viewing history. */
export function readSavedJobs(file = defaultDbPath(), workspaceId = "demo"): JobView[] {
  if (!existsSync(file)) return [];
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    db.exec("PRAGMA busy_timeout = 5000; BEGIN;");
    const jobs = db.prepare(`
      SELECT j.id, j.type, j.title, j.input, j.required_skill AS requiredSkill,
        j.status, j.hire_id AS hireId, h.role AS hireRole,
        j.recommended_profile_id AS recommendedProfileId, j.created_at AS createdAt,
        j.assigned_at AS assignedAt, j.started_at AS startedAt, j.finished_at AS finishedAt, j.error
      FROM jobs j LEFT JOIN hires h ON h.id = j.hire_id
      WHERE j.workspace_id = ? ORDER BY j.created_at DESC, j.rowid DESC LIMIT 50
    `).all(workspaceId) as unknown as JobRow[];
    if (!jobs.length) return [];
    const ids = jobs.map(job => job.id);
    const placeholders = ids.map(() => "?").join(",");
    const events = db.prepare(`SELECT job_id AS jobId, at, actor, text FROM job_events
      WHERE job_id IN (${placeholders}) ORDER BY id`).all(...ids) as unknown as EventRow[];
    const reports = db.prepare(`SELECT id, job_id AS jobId, mode, outcome, summary, body,
      runtime_ms AS runtimeMs, hourly_rate_cents AS hourlyRateCents,
      demo_cost_cents AS demoCostCents, created_at AS createdAt FROM reports
      WHERE job_id IN (${placeholders})`).all(...ids) as unknown as ReportRow[];
    return jobs.map(row => {
      const report = reports.find(item => item.jobId === row.id);
      return {
        ...row, input: JSON.parse(row.input), error: row.error ? JSON.parse(row.error) : null,
        events: events.filter(event => event.jobId === row.id).map(({ at, actor, text }) => ({ at, actor, text })),
        report: report ? {
          id: report.id, mode: report.mode, outcome: report.outcome, summary: report.summary,
          body: JSON.parse(report.body), runtimeMs: report.runtimeMs,
          hourlyRateCents: report.hourlyRateCents, demoCostCents: report.demoCostCents,
          createdAt: report.createdAt,
        } : null,
      };
    });
  } finally {
    db.close();
  }
}

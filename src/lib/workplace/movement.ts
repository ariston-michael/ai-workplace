import type { HireView, JobView } from "./types.ts";

/**
 * Only saved assignment, departure, and return events move a worker.
 * `after` says where a worker goes once its report is at reception:
 * back to its desk (kept on the team, or staff) or out of the office (job-only / released).
 */
export function workerMovement(hire: HireView, jobs: JobView[]) {
  const ownJobs = jobs.filter(item => item.hireId === hire.id);
  const job = ownJobs.find(item => item.status === "working")
    ?? ownJobs.find(item => item.id === hire.activeJobId) ?? ownJobs[0];
  const after = hire.departedAt !== null ? "leave" as const : "desk" as const;
  // "Left the office" follows the return; it is handled by `after`, not as a new stop.
  const event = job?.events.filter(item => item.actor === hire.role && !item.text.startsWith("Left the office")).at(-1);
  const assigned = job?.events.filter(item => item.actor === "Dispatcher" && /assigned to /i.test(item.text)).at(-1);
  const departed = job?.events.some(item => item.actor === hire.role && item.text === "Left the desk to start work.") ?? false;
  const key = event ?? assigned;
  const eventKey = `${job && key ? `${job.id}:${key.at}:${key.text}` : "none"}:${after}`;
  if (job?.status === "working" && departed && !event?.text.startsWith("Returned ")) {
    return { kind: "working" as const, eventKey, jobId: job.id, departed, after };
  }
  if (job?.status === "queued" && job.assignedAt !== null && assigned) {
    return { kind: "assigned" as const, eventKey, jobId: job.id, departed, after };
  }
  if (job && job.finishedAt !== null && event?.text.startsWith("Returned ") && (job.status === "failed" || job.report !== null)) {
    return { kind: job.status === "failed" ? "failed" as const : "returned" as const, eventKey, jobId: job.id, departed, after };
  }
  return { kind: "at_desk" as const, eventKey, jobId: job?.id, departed, after };
}
export type WorkerMovement = ReturnType<typeof workerMovement>;

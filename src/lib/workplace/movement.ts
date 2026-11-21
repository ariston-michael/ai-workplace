import type { HireView, JobView } from "./types.ts";

/** Only saved assignment, departure, and return events move a worker. */
export function workerMovement(hire: HireView, jobs: JobView[]) {
  const ownJobs = jobs.filter(item => item.hireId === hire.id);
  const job = ownJobs.find(item => item.status === "working")
    ?? ownJobs.find(item => item.id === hire.activeJobId) ?? ownJobs[0];
  const event = job?.events.filter(item => item.actor === hire.role).at(-1);
  const assigned = job?.events.filter(item => item.actor === "Dispatcher" && /assigned to /i.test(item.text)).at(-1);
  const departed = job?.events.some(item => item.actor === hire.role && item.text === "Left the desk to start work.") ?? false;
  const key = event ?? assigned;
  const eventKey = job && key ? `${job.id}:${key.at}:${key.text}` : null;
  if (job?.status === "working" && departed && !event?.text.startsWith("Returned ")) {
    return { kind: "working" as const, eventKey, jobId: job.id, departed };
  }
  if (job?.status === "queued" && job.assignedAt !== null && assigned) {
    return { kind: "assigned" as const, eventKey, jobId: job.id, departed };
  }
  if (job && job.finishedAt !== null && event?.text.startsWith("Returned ") && (job.status === "failed" || job.report !== null)) {
    return { kind: job.status === "failed" ? "failed" as const : "returned" as const, eventKey, jobId: job.id, departed };
  }
  return { kind: "at_desk" as const, eventKey, jobId: job?.id, departed };
}
export type WorkerMovement = ReturnType<typeof workerMovement>;

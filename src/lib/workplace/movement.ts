import type { HireView, JobView } from "./types.ts";

/** Physical movement requires a saved worker event, not a random timer. */
export function workerMovement(hire: HireView, jobs: JobView[]) {
  const job = jobs.find(item => item.id === hire.activeJobId) ?? jobs.find(item => item.hireId === hire.id);
  const event = job?.events.filter(item => item.actor === hire.role).at(-1);
  const eventKey = job && event ? `${job.id}:${event.at}:${event.text}` : null;
  if (job?.status === "working" && event?.text === "Left the desk to start work.") {
    return { kind: "working" as const, eventKey, jobId: job.id };
  }
  if (job?.finishedAt !== null && event?.text.startsWith("Returned ")) {
    return { kind: job?.status === "failed" ? "failed" as const : "returned" as const, eventKey, jobId: job?.id };
  }
  return { kind: "at_desk" as const, eventKey, jobId: job?.id };
}

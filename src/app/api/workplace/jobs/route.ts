import { getDb } from "@/lib/workplace/db.server";
import { errorJson, currentState, readJson, scheduleJobs, serviceDeps } from "@/lib/workplace/runtime.server";
import { submitJob, WORKSPACE_ID } from "@/lib/workplace/service.server";

export async function POST(request: Request) {
  const body = await readJson(request);
  if (typeof body !== "object" || body === null) return errorJson(400, "INVALID_REQUEST", "Request body must be a JSON object.");
  const { clientRequestId, type, input } = body as Record<string, unknown>;

  const result = submitJob(getDb(), serviceDeps(), WORKSPACE_ID, { clientRequestId, type, input });
  if (!result.ok) return errorJson(result.status, result.error.code, result.error.message);
  scheduleJobs(result.runJobIds);
  return Response.json({ ok: true, jobId: result.jobId, state: currentState() });
}

import { getDb } from "@/lib/workplace/db.server";
import { errorJson, currentState, readJson, scheduleJobs, serviceDeps } from "@/lib/workplace/runtime.server";
import { approveHire, WORKSPACE_ID } from "@/lib/workplace/service.server";

export async function POST(request: Request) {
  const body = await readJson(request);
  if (typeof body !== "object" || body === null) return errorJson(400, "INVALID_REQUEST", "Request body must be a JSON object.");
  const { profileId, jobId } = body as Record<string, unknown>;

  const result = approveHire(getDb(), serviceDeps(), WORKSPACE_ID, { profileId, jobId });
  if (!result.ok) return errorJson(result.status, result.error.code, result.error.message);
  scheduleJobs(result.runJobIds);
  return Response.json({ ok: true, hireId: result.hireId, created: result.created, state: currentState() });
}

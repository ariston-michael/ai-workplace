import { getDb } from "@/lib/workplace/db.server";
import { errorJson, currentState, readJson, scheduleJobs, serviceDeps } from "@/lib/workplace/runtime.server";
import { submitRequest, WORKSPACE_ID } from "@/lib/workplace/service.server";

/**
 * Body: { clientRequestId, request: "What do you need help with?", pending?: <from a follow-up> }
 * Returns kind "job" (job created), "follow_up" (Dispatcher needs details) or "unsupported".
 */
export async function POST(request: Request) {
  const body = await readJson(request);
  if (typeof body !== "object" || body === null) return errorJson(400, "INVALID_REQUEST", "Request body must be a JSON object.");
  const { clientRequestId, request: text, pending } = body as Record<string, unknown>;

  const result = submitRequest(getDb(), serviceDeps(), WORKSPACE_ID, { clientRequestId, request: text, pending });
  if (!result.ok) return errorJson(result.status, result.error.code, result.error.message);
  if (result.kind !== "job") return Response.json(result);
  scheduleJobs(result.runJobIds);
  return Response.json({ ok: true, kind: "job", jobId: result.jobId, understood: result.understood, state: currentState() });
}

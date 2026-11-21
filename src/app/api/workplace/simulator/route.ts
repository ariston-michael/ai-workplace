import { getDb } from "@/lib/workplace/db.server";
import { errorJson, currentState, readJson } from "@/lib/workplace/runtime.server";
import { setCameraFault, WORKSPACE_ID } from "@/lib/workplace/service.server";

/** Simulator controls: which fault the simulated Packing Station 1 camera will show. */
export async function POST(request: Request) {
  const body = await readJson(request);
  const cameraFault = typeof body === "object" && body !== null ? (body as Record<string, unknown>).cameraFault : undefined;
  const result = setCameraFault(getDb(), WORKSPACE_ID, cameraFault);
  if (!result.ok) return errorJson(result.status, result.error.code, result.error.message);
  return Response.json({ ok: true, state: currentState() });
}

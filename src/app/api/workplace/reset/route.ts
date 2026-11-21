import { getDb } from "@/lib/workplace/db.server";
import { currentState } from "@/lib/workplace/runtime.server";
import { resetWorkspace, WORKSPACE_ID } from "@/lib/workplace/service.server";

export async function POST() {
  resetWorkspace(getDb(), WORKSPACE_ID, Date.now());
  return Response.json({ ok: true, state: currentState() });
}

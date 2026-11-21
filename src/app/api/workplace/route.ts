import { DEFAULT_WORKSPACE_ID } from "@/lib/workplace/db.server";
import { handleGetState } from "@/lib/workplace/runtime.server";

/** Legacy alias for GET /api/workspaces/default. */
export function GET() {
  return handleGetState(DEFAULT_WORKSPACE_ID);
}

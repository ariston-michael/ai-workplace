import { DEFAULT_WORKSPACE_ID } from "@/lib/workplace/db.server";
import { handleReset } from "@/lib/workplace/runtime.server";

/** Legacy alias for POST /api/workspaces/default/reset. */
export function POST() {
  return handleReset(DEFAULT_WORKSPACE_ID);
}

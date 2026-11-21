import { DEFAULT_WORKSPACE_ID } from "@/lib/workplace/db.server";
import { handleHires } from "@/lib/workplace/runtime.server";

/** Legacy alias for POST /api/workspaces/default/hires. */
export function POST(request: Request) {
  return handleHires(request, DEFAULT_WORKSPACE_ID);
}

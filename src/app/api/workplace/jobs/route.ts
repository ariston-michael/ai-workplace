import { DEFAULT_WORKSPACE_ID } from "@/lib/workplace/db.server";
import { handleJobs } from "@/lib/workplace/runtime.server";

/** Legacy alias for POST /api/workspaces/default/jobs. */
export function POST(request: Request) {
  return handleJobs(request, DEFAULT_WORKSPACE_ID);
}

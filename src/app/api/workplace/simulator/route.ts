import { DEFAULT_WORKSPACE_ID } from "@/lib/workplace/db.server";
import { handleSimulator } from "@/lib/workplace/runtime.server";

/** Legacy alias for POST /api/workspaces/default/simulator. */
export function POST(request: Request) {
  return handleSimulator(request, DEFAULT_WORKSPACE_ID);
}

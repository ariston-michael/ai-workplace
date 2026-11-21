import { handleGetState, LEGACY } from "@/lib/workplace/runtime.server";

/** Legacy alias for GET /api/workspaces/{your primary office}. Same sign-in and ownership checks. */
export function GET() {
  return handleGetState(LEGACY);
}

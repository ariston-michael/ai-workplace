import { handleReset, LEGACY } from "@/lib/workplace/runtime.server";

/** Legacy alias for POST /api/workspaces/{your primary office}/reset. Same sign-in and ownership checks. */
export function POST() {
  return handleReset(LEGACY);
}

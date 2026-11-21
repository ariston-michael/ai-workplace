import { handleHires, LEGACY } from "@/lib/workplace/runtime.server";

/** Legacy alias for POST /api/workspaces/{your primary office}/hires. Same sign-in and ownership checks. */
export function POST(request: Request) {
  return handleHires(request, LEGACY);
}

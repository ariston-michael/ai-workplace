import { handleSimulator, LEGACY } from "@/lib/workplace/runtime.server";

/** Legacy alias for POST /api/workspaces/{your primary office}/simulator. Same sign-in and ownership checks. */
export function POST(request: Request) {
  return handleSimulator(request, LEGACY);
}

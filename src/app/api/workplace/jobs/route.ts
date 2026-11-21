import { handleJobs, LEGACY } from "@/lib/workplace/runtime.server";

/** Legacy alias for POST /api/workspaces/{your primary office}/jobs. Same sign-in and ownership checks. */
export function POST(request: Request) {
  return handleJobs(request, LEGACY);
}

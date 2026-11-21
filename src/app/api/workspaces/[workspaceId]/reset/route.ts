import { handleReset } from "@/lib/workplace/runtime.server";

/** Deletes this office's hires, jobs, reports and simulator settings, then reseeds staff. Other offices are untouched. */
export async function POST(_request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  return handleReset((await params).workspaceId);
}

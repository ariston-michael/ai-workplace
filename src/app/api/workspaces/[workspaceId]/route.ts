import { handleGetState } from "@/lib/workplace/runtime.server";

export async function GET(_request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  return handleGetState((await params).workspaceId);
}

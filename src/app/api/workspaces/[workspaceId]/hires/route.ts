import { handleHires } from "@/lib/workplace/runtime.server";

export async function POST(request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  return handleHires(request, (await params).workspaceId);
}

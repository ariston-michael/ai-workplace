import { handleSimulator } from "@/lib/workplace/runtime.server";

export async function POST(request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  return handleSimulator(request, (await params).workspaceId);
}

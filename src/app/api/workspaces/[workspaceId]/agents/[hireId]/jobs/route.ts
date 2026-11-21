import { handleAgentJob } from "@/lib/workplace/runtime.server";
export async function POST(request: Request, { params }: { params: Promise<{ workspaceId: string; hireId: string }> }) {
  const { workspaceId, hireId } = await params;
  return handleAgentJob(request, workspaceId, hireId);
}

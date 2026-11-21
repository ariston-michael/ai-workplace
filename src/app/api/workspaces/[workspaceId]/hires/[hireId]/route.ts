import { handleUpdateHire } from "@/lib/workplace/runtime.server";

// Body: { retention?: "team" | "job", instructions?: string }
export async function POST(request: Request, { params }: { params: Promise<{ workspaceId: string; hireId: string }> }) {
  const { workspaceId, hireId } = await params;
  return handleUpdateHire(request, workspaceId, hireId);
}

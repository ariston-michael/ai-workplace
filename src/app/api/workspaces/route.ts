import { handleCreateWorkspace, handleListWorkspaces } from "@/lib/workplace/runtime.server";

/** List offices (workspaces). */
export function GET() {
  return handleListWorkspaces();
}

/** Create an office: { name }. It starts with the Quality Inspector only. */
export function POST(request: Request) {
  return handleCreateWorkspace(request);
}

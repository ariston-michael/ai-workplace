import { handleSmsSettings } from "@/lib/workplace/runtime.server";

// GET: SMS status and linked phones. POST { action: "link_code" } or { action: "unlink", linkId }.
export async function GET(_request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  return handleSmsSettings(null, (await params).workspaceId);
}
export async function POST(request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  return handleSmsSettings(request, (await params).workspaceId);
}

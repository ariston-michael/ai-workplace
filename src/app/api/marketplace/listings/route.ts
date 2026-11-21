import { handlePublish } from "@/lib/workplace/runtime.server";

export async function POST(request: Request) {
  return handlePublish(request);
}

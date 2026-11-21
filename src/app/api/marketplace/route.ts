import { handleMarketplace } from "@/lib/workplace/runtime.server";

export async function GET() {
  return handleMarketplace();
}

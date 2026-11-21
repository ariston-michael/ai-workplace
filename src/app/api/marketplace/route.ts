import { handleMarketplace } from "@/lib/workplace/runtime.server";
export async function GET() { return handleMarketplace(); }
export async function POST(request: Request) { return handleMarketplace(request); }

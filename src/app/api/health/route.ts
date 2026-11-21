import { connection } from "next/server";
import { getDb } from "@/lib/workplace/db.server";
export async function GET() {
  await connection();
  try {
    getDb().prepare("SELECT 1").get();
    return Response.json({ ok: true, commit: process.env.NEXT_PUBLIC_PREVIEW_COMMIT, procurement: process.env.PROCUREMENT_MODE ?? "sample", sms: process.env.SMS_MODE ?? "twilio" }, { headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ ok: false }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
}

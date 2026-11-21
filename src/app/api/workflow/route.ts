import { connection } from "next/server";
import { readSavedJobs } from "@/lib/workflow/read-jobs.server";

export async function GET() {
  await connection();
  try {
    return Response.json({ ok: true, jobs: readSavedJobs() }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ ok: false, error: "Saved jobs could not be loaded. Try refreshing." }, {
      status: 503, headers: { "Cache-Control": "no-store" },
    });
  }
}

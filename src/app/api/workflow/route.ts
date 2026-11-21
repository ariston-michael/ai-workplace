import { connection } from "next/server";
import { DEFAULT_WORKSPACE_ID } from "@/lib/workplace/db.server";
import { readSavedJobs } from "@/lib/workflow/read-jobs.server";

export async function GET(request: Request) {
  await connection();
  try {
    const workspace = new URL(request.url).searchParams.get("workspace") || DEFAULT_WORKSPACE_ID;
    return Response.json({ ok: true, jobs: readSavedJobs(undefined, workspace) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ ok: false, error: "Saved jobs could not be loaded. Try refreshing." }, {
      status: 503, headers: { "Cache-Control": "no-store" },
    });
  }
}

import { connection } from "next/server";
import { auth0 } from "@/lib/auth0";
import { readSavedJobs } from "@/lib/workflow/read-jobs.server";

export async function GET(request: Request) {
  await connection();
  try {
    const session = await auth0.getSession();
    if (!session?.user?.sub) return Response.json({ ok: false, error: "Sign in to view saved jobs." }, { status: 401, headers: { "Cache-Control": "no-store" } });
    const workspace = new URL(request.url).searchParams.get("workspace") || undefined;
    const jobs = readSavedJobs(undefined, workspace, session.user.sub);
    if (jobs === null) return Response.json({ ok: false, error: "Workspace not found or unavailable." }, { status: 404, headers: { "Cache-Control": "no-store" } });
    return Response.json({ ok: true, jobs }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ ok: false, error: "Saved jobs could not be loaded. Try refreshing." }, {
      status: 503, headers: { "Cache-Control": "no-store" },
    });
  }
}

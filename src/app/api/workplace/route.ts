import { connection } from "next/server";
import { currentState } from "@/lib/workplace/runtime.server";

export async function GET() {
  await connection(); // always read the database at request time
  return Response.json({ ok: true, state: currentState() });
}

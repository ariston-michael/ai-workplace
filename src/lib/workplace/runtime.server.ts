// Wires the workplace service to the real clock, SQLite file and procurement
// provider (fixture by default) for use inside Next.js route handlers.

import { after } from "next/server";
import { getDb } from "./db.server.ts";
import { defaultIds, getState, recoverJobs, runJob, WORKSPACE_ID, type ServiceDeps } from "./service.server.ts";
import { lookupPart, procurementMode } from "../procurement-provider.server.ts";

export function serviceDeps(): ServiceDeps {
  return { now: () => Date.now(), newId: defaultIds, lookup: (partName, supplier) => lookupPart(partName, supplier) };
}

/** Run jobs after the response is sent. runJob's claim step makes repeats harmless. */
export function scheduleJobs(jobIds: string[]) {
  for (const id of jobIds) {
    after(async () => {
      try {
        await runJob(getDb(), serviceDeps(), id);
      } catch (err) {
        console.error(`[workplace] job ${id} crashed`, err);
      }
    });
  }
}

export function currentState() {
  const db = getDb();
  const now = Date.now();
  scheduleJobs(recoverJobs(db, WORKSPACE_ID, now));
  return getState(db, WORKSPACE_ID, procurementMode(), now);
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

export function errorJson(status: number, code: string, message: string) {
  return Response.json({ ok: false, error: { code, message } }, { status });
}

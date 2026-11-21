// Wires the workplace service to the real clock, SQLite file and procurement
// provider (fixture by default), and holds the request handlers shared by
// /api/workspaces/[workspaceId]/* and the legacy /api/workplace/* aliases.

import { after, connection } from "next/server";
import { getDb } from "./db.server.ts";
import {
  approveHire,
  createWorkspace,
  defaultIds,
  getState,
  getWorkspace,
  listWorkspaces,
  recoverJobs,
  resetWorkspace,
  runJob,
  setCameraFault,
  submitRequest,
  type ServiceDeps,
} from "./service.server.ts";
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

export function currentState(ws: string) {
  const db = getDb();
  const now = Date.now();
  if (!getWorkspace(db, ws)) return null;
  scheduleJobs(recoverJobs(db, ws, now));
  return getState(db, ws, procurementMode(), now);
}

async function readObject(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    return typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function errorJson(status: number, code: string, message: string) {
  return Response.json({ ok: false, error: { code, message } }, { status });
}

const notFound = (ws: string) => errorJson(404, "WORKSPACE_NOT_FOUND", `Workspace "${ws.slice(0, 64)}" does not exist.`);
const badBody = () => errorJson(400, "INVALID_REQUEST", "Request body must be a JSON object.");

function withState(ws: string, extra: Record<string, unknown> = {}) {
  const state = currentState(ws);
  return state ? Response.json({ ok: true, ...extra, state }) : notFound(ws);
}

// --- handlers -----------------------------------------------------------------

export async function handleListWorkspaces() {
  await connection();
  return Response.json({ ok: true, workspaces: listWorkspaces(getDb()) });
}

export async function handleCreateWorkspace(request: Request) {
  const body = await readObject(request);
  if (!body) return badBody();
  const r = createWorkspace(getDb(), serviceDeps(), { name: body.name });
  if (!r.ok) return errorJson(r.status, r.error.code, r.error.message);
  return Response.json({ ok: true, workspace: r.workspace }, { status: 201 });
}

export async function handleGetState(ws: string) {
  await connection(); // always read the database at request time
  return withState(ws);
}

export async function handleJobs(request: Request, ws: string) {
  const body = await readObject(request);
  if (!body) return badBody();
  const r = submitRequest(getDb(), serviceDeps(), ws, { clientRequestId: body.clientRequestId, request: body.request, pending: body.pending });
  if (!r.ok) return errorJson(r.status, r.error.code, r.error.message);
  if (r.kind !== "job") return Response.json(r);
  scheduleJobs(r.runJobIds);
  return withState(ws, { kind: "job", jobId: r.jobId, understood: r.understood });
}

export async function handleHires(request: Request, ws: string) {
  const body = await readObject(request);
  if (!body) return badBody();
  const r = approveHire(getDb(), serviceDeps(), ws, { profileId: body.profileId, jobId: body.jobId });
  if (!r.ok) return errorJson(r.status, r.error.code, r.error.message);
  scheduleJobs(r.runJobIds);
  return withState(ws, { hireId: r.hireId, created: r.created });
}

export async function handleSimulator(request: Request, ws: string) {
  const body = await readObject(request);
  if (!body) return badBody();
  const r = setCameraFault(getDb(), ws, body.cameraFault);
  if (!r.ok) return errorJson(r.status, r.error.code, r.error.message);
  return withState(ws);
}

export async function handleReset(ws: string) {
  const r = resetWorkspace(getDb(), ws, Date.now());
  if (!r.ok) return errorJson(r.status, r.error.code, r.error.message);
  return withState(ws);
}

// Wires the workplace service to the real clock, SQLite file and procurement
// provider (fixture by default), and holds the request handlers shared by
// /api/workspaces/[workspaceId]/* and the legacy /api/workplace/* aliases.
//
// Every handler requires an Auth0 session and only touches offices the
// signed-in user owns. Other users' offices answer 404 so their ids are not confirmed.

import { after, connection } from "next/server";
import { auth0 } from "../auth0.ts";
import { getDb } from "./db.server.ts";
import {
  approveHire,
  claimUnownedWorkspaces,
  createWorkspace,
  defaultIds,
  ensurePersonalWorkspace,
  getOwnedWorkspace,
  getState,
  getWorkspace,
  hireTargets,
  listMarketplace,
  listWorkspaces,
  publishListing,
  primaryWorkspaceId,
  recoverJobs,
  resetWorkspace,
  runJob,
  setCameraFault,
  submitRequest,
  type ServiceDeps,
  type Viewer,
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

// --- identity and ownership ---------------------------------------------------

/** Workspace id from the URL, or LEGACY for /api/workplace/* (the user's primary office). */
export const LEGACY = Symbol("legacy-primary-workspace");
export type WorkspaceRef = string | typeof LEGACY;

async function currentViewer(): Promise<Viewer | null> {
  const session = await auth0.getSession();
  const u = session?.user;
  if (!u?.sub) return null;
  return {
    sub: u.sub,
    name: typeof u.name === "string" ? u.name : null,
    email: typeof u.email === "string" ? u.email : null,
    emailVerified: u.email_verified === true,
  };
}

/** 401 unless signed in. Also claims demo offices for their owner and creates a personal office on first use. */
export async function requireViewer(): Promise<Viewer | Response> {
  const viewer = await currentViewer();
  if (!viewer) return errorJson(401, "UNAUTHENTICATED", "Sign in to use the workplace.");
  const db = getDb();
  claimUnownedWorkspaces(db, viewer, process.env.WORKPLACE_DEMO_OWNER_EMAIL);
  ensurePersonalWorkspace(db, serviceDeps(), viewer);
  return viewer;
}

/** The workspace id the signed-in user may act on, or a 401/404 response. */
async function authorize(ref: WorkspaceRef): Promise<{ viewer: Viewer; ws: string } | Response> {
  const viewer = await requireViewer();
  if (viewer instanceof Response) return viewer;
  const db = getDb();
  if (ref === LEGACY) return { viewer, ws: primaryWorkspaceId(db, viewer.sub)! };
  if (!getOwnedWorkspace(db, ref, viewer.sub)) return notFound(ref);
  return { viewer, ws: ref };
}

// --- handlers -----------------------------------------------------------------

export async function handleListWorkspaces() {
  await connection();
  const viewer = await requireViewer();
  if (viewer instanceof Response) return viewer;
  const db = getDb();
  return Response.json({
    ok: true,
    viewer: { name: viewer.name, email: viewer.email },
    primaryWorkspaceId: primaryWorkspaceId(db, viewer.sub),
    workspaces: listWorkspaces(db, viewer.sub),
  });
}

export async function handleCreateWorkspace(request: Request) {
  const viewer = await requireViewer();
  if (viewer instanceof Response) return viewer;
  const body = await readObject(request);
  if (!body) return badBody();
  const r = createWorkspace(getDb(), serviceDeps(), { name: body.name, ownerSub: viewer.sub });
  if (!r.ok) return errorJson(r.status, r.error.code, r.error.message);
  return Response.json({ ok: true, workspace: r.workspace }, { status: 201 });
}

export async function handleGetState(ref: WorkspaceRef) {
  await connection(); // always read the database at request time
  const auth = await authorize(ref);
  if (auth instanceof Response) return auth;
  return withState(auth.ws);
}

export async function handleJobs(request: Request, ref: WorkspaceRef) {
  const auth = await authorize(ref);
  if (auth instanceof Response) return auth;
  const { ws } = auth;
  const body = await readObject(request);
  if (!body) return badBody();
  const r = submitRequest(getDb(), serviceDeps(), ws, { clientRequestId: body.clientRequestId, request: body.request, pending: body.pending });
  if (!r.ok) return errorJson(r.status, r.error.code, r.error.message);
  if (r.kind !== "job") return Response.json(r);
  scheduleJobs(r.runJobIds);
  return withState(ws, { kind: "job", jobId: r.jobId, understood: r.understood });
}

export async function handleHires(request: Request, ref: WorkspaceRef) {
  const auth = await authorize(ref);
  if (auth instanceof Response) return auth;
  const { ws } = auth;
  const body = await readObject(request);
  if (!body) return badBody();
  const r = approveHire(getDb(), serviceDeps(), ws, { profileId: body.profileId, jobId: body.jobId });
  if (!r.ok) return errorJson(r.status, r.error.code, r.error.message);
  scheduleJobs(r.runJobIds);
  return withState(ws, { hireId: r.hireId, created: r.created });
}

export async function handleSimulator(request: Request, ref: WorkspaceRef) {
  const auth = await authorize(ref);
  if (auth instanceof Response) return auth;
  const { ws } = auth;
  const body = await readObject(request);
  if (!body) return badBody();
  const r = setCameraFault(getDb(), ws, body.cameraFault);
  if (!r.ok) return errorJson(r.status, r.error.code, r.error.message);
  return withState(ws);
}

export async function handleReset(ref: WorkspaceRef) {
  const auth = await authorize(ref);
  if (auth instanceof Response) return auth;
  const r = resetWorkspace(getDb(), auth.ws, Date.now());
  if (!r.ok) return errorJson(r.status, r.error.code, r.error.message);
  return withState(auth.ws);
}

// --- marketplace (global listings; hiring still goes through a workspace) ------

export async function handleMarketplace() {
  await connection();
  const viewer = await requireViewer();
  if (viewer instanceof Response) return viewer;
  const db = getDb();
  // Suggested publisher name: the first word of the profile name, never the email address.
  const first = viewer.name && !viewer.name.includes("@") ? viewer.name.trim().split(/\s+/)[0].slice(0, 40) : "";
  return Response.json({
    ok: true,
    listings: listMarketplace(db, viewer.sub),
    workspaces: hireTargets(db, viewer.sub),
    viewer: { name: viewer.name, suggestedPublisherName: first },
  });
}

export async function handlePublish(request: Request) {
  const viewer = await requireViewer();
  if (viewer instanceof Response) return viewer;
  const body = await readObject(request);
  if (!body) return badBody();
  const r = publishListing(getDb(), serviceDeps(), viewer.sub, { clientRequestId: body.clientRequestId, listing: body.listing });
  if (!r.ok) return Response.json({ ok: false, error: r.error }, { status: r.status });
  return Response.json({ ok: true, listing: r.listing, created: r.created }, { status: r.created ? 201 : 200 });
}

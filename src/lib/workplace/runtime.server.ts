import { simulatedSmsEnabled, simulateSms, simulationMessages } from "../sms/simulated.server.ts";
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
  submitAgentJob,
  submitRequest,
  updateHire,
  hasCsv,
  type ServiceDeps,
  type Viewer,
} from "./service.server.ts";
import { lookupPart, procurementMode } from "../procurement-provider.server.ts";
import { geminiConfig } from "../gemini.server.ts";
import { dispatch } from "./dispatcher-ai.server.ts";
import { sendSms, twilioConfig, twiml, validTwilioSignature } from "../sms/twilio.server.ts";
import { createLinkCode, handleInboundSms, listLinks, notifySmsResult, unlinkPhone } from "../sms/sms.server.ts";
import type { DispatcherInfo } from "./types.ts";

/** Which engine the Dispatcher uses on this server (shown as a badge in the office). */
export function dispatcherInfo(): DispatcherInfo {
  const g = geminiConfig();
  return g ? { engine: "gemini", model: g.model } : { engine: "rules", model: null };
}

export function serviceDeps(): ServiceDeps {
  return { now: () => Date.now(), newId: defaultIds, lookup: (partName, supplier) => lookupPart(partName, supplier) };
}

/** Run jobs after the response is sent. runJob's claim step makes repeats harmless. */
export function scheduleJobs(jobIds: string[]) {
  for (const id of jobIds) {
    after(async () => {
      try {
        await runJob(getDb(), serviceDeps(), id);
        // If the job was requested by text, send its result once.
        const twilio = twilioConfig();
        if (simulatedSmsEnabled()) await notifySmsResult(getDb(), Date.now(), id, async () => ({ ok: true, sid: `SIMULATED_${id}`, status: "simulated" }));
        else if (twilio) await notifySmsResult(getDb(), Date.now(), id, (to, body) => sendSms(twilio, to, body));
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
  return getState(db, ws, procurementMode(), now, dispatcherInfo());
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
  const db = getDb();
  // A retried submission returns its original job without asking Gemini again.
  if (typeof body.clientRequestId === "string") {
    const existing = db.prepare("SELECT id FROM jobs WHERE workspace_id = ? AND client_request_id = ?").get(ws, body.clientRequestId) as { id: string } | undefined;
    if (existing) return withState(ws, { kind: "job", jobId: existing.id, understood: "your earlier request" });
  }
  // The CSV stays on this server; Gemini only learns that one is attached.
  const csvAttached = hasCsv(body.csv);
  const d = await dispatch(body.request, body.pending, { csvAttached }, geminiConfig());
  if (d.fallback) console.warn(`[dispatcher] Gemini unavailable, used rules: ${d.fallback.code}`);
  const r = submitRequest(db, serviceDeps(), ws, { clientRequestId: body.clientRequestId, request: body.request, pending: body.pending, csv: body.csv }, d.interpretation, d.engine);
  if (!r.ok) return errorJson(r.status, r.error.code, r.error.message);
  const dispatcher = { ...d.engine, fallback: d.fallback?.code ?? null };
  if (r.kind !== "job") return Response.json({ ...r, dispatcher });
  scheduleJobs(r.runJobIds);
  return withState(ws, { kind: "job", jobId: r.jobId, understood: r.understood, dispatcher });
}

export async function handleHires(request: Request, ref: WorkspaceRef) {
  const auth = await authorize(ref);
  if (auth instanceof Response) return auth;
  const { ws } = auth;
  const body = await readObject(request);
  if (!body) return badBody();
  const r = approveHire(getDb(), serviceDeps(), ws, { profileId: body.profileId, jobId: body.jobId, retention: body.retention, instructions: body.instructions });
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

/** Keep on team, release, or save instructions for one hire in this office. */
export async function handleUpdateHire(request: Request, ref: WorkspaceRef, hireId: string) {
  const auth = await authorize(ref);
  if (auth instanceof Response) return auth;
  const body = await readObject(request);
  if (!body) return badBody();
  const r = updateHire(getDb(), serviceDeps(), auth.ws, hireId, { retention: body.retention, instructions: body.instructions });
  if (!r.ok) return errorJson(r.status, r.error.code, r.error.message);
  return withState(auth.ws, { hireId: r.hireId });
}

/** Run a hired worker's inventory action from its profile. Ownership and hire membership are checked first. */
export async function handleAgentJob(request: Request, ref: WorkspaceRef, hireId: string) {
  const auth = await authorize(ref);
  if (auth instanceof Response) return auth;
  const body = await readObject(request);
  if (!body) return badBody();
  const result = submitAgentJob(getDb(), serviceDeps(), auth.ws, hireId, { clientRequestId: body.clientRequestId, csv: body.csv });
  if (!result.ok) return errorJson(result.status, result.error.code, result.error.message);
  scheduleJobs(result.runJobIds);
  return withState(auth.ws, { jobId: result.jobId });
}

// --- SMS (Twilio) ---------------------------------------------------------------

/** Public Twilio webhook. Only requests signed with TWILIO_AUTH_TOKEN for TWILIO_WEBHOOK_URL are accepted. */
export async function handleTwilioWebhook(request: Request) {
  const twilio = twilioConfig();
  if (!twilio) return new Response("SMS is not configured.", { status: 503 });
  const raw = await request.text();
  const params = [...new URLSearchParams(raw).entries()];
  if (!validTwilioSignature(twilio.authToken, twilio.webhookUrl, params, request.headers.get("x-twilio-signature"))) {
    console.warn("[sms] rejected a webhook with an invalid signature");
    return new Response("Invalid signature.", { status: 403 });
  }
  const get = (k: string) => params.find(([key]) => key === k)?.[1] ?? "";
  if (get("AccountSid") !== twilio.accountSid) return new Response("Wrong account.", { status: 403 });
  const result = await handleInboundSms(getDb(), { ...serviceDeps(), dispatch: (text, pending, opts) => dispatch(text, pending, opts, geminiConfig()) }, {
    messageSid: get("MessageSid"),
    from: get("From"),
    body: get("Body"),
  });
  scheduleJobs(result.runJobIds);
  return new Response(twiml(result.reply), { headers: { "Content-Type": "text/xml; charset=utf-8" } });
}

/** Office side: SMS status, a new link code, or unlinking a phone. */
export async function handleSmsSettings(request: Request | null, ref: WorkspaceRef) {
  await connection();
  const auth = await authorize(ref);
  if (auth instanceof Response) return auth;
  const db = getDb();
  if (simulatedSmsEnabled()) return Response.json({ ok: true, sms: { configured: true, mode: "simulated", number: null, links: [], code: null, messages: simulationMessages(db, auth.ws, auth.viewer.sub) } }, { headers: { "Cache-Control": "no-store" } });
  const twilio = twilioConfig();
  let code: { code: string; expiresAt: number } | null = null;
  if (request) {
    const body = await readObject(request);
    if (!body) return badBody();
    if (body.action === "link_code") {
      if (!twilio) return errorJson(503, "SMS_NOT_CONFIGURED", "Add the Twilio settings to .env.local and restart to text the Dispatcher.");
      code = createLinkCode(db, Date.now(), auth.ws, auth.viewer.sub);
    } else if (body.action === "unlink") {
      if (!unlinkPhone(db, auth.ws, body.linkId)) return errorJson(404, "LINK_NOT_FOUND", "That phone is not linked to this office.");
    } else return errorJson(400, "INVALID_REQUEST", "action must be link_code or unlink.");
  }
  return Response.json({ ok: true, sms: { configured: !!twilio, number: twilio?.phoneNumber ?? null, links: listLinks(db, auth.ws), code } }, { headers: { "Cache-Control": "no-store" } });
}


export async function handleSimulatedSms(request: Request, ref: WorkspaceRef) {
  const auth = await authorize(ref);
  if (auth instanceof Response) return auth;
  if (!simulatedSmsEnabled()) return errorJson(404, "NOT_FOUND", "Simulated SMS is not enabled.");
  const body = await readObject(request);
  if (!body || typeof body.text !== "string" || !body.text.trim() || body.text.length > 500 || typeof body.clientRequestId !== "string" || !/^[A-Za-z0-9_-]{8,100}$/.test(body.clientRequestId)) return errorJson(400, "INVALID_REQUEST", "Supply a text of 1–500 characters and a valid request ID.");
  const result = await simulateSms(getDb(), { ...serviceDeps(), dispatch: (text, pending, opts) => dispatch(text, pending, opts, geminiConfig()) }, auth.ws, auth.viewer.sub, body.text, body.clientRequestId);
  scheduleJobs(result.runJobIds);
  return Response.json({ ok: true, reply: result.reply, mode: "simulated" }, { headers: { "Cache-Control": "no-store" } });
}

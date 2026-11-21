"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import OfficeMap from "./office-map";
import PixelCharacter, { ListingBadge } from "./pixel-character";
import InventoryReport from "./inventory-report";
import AgentAction from "./agent-action";
import SmsPanel from "./sms-panel";
import { CHARACTERS, characterVoice, characterTask, inventoryVoice } from "@/lib/workplace/characters";
import type { MarketplaceListing } from "@/lib/workplace/marketplace";
import type { SpriteSpec } from "@/lib/workplace/sprites";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import "./office.css";
import { CameraIncidentReport } from "./repair-incident";
import { SCENARIOS } from "@/lib/camera-incident";
import type { LookupResult } from "@/lib/procurement";
import {
  JOB_TYPES,
  SKILLS,
  demoCostCents,
  formatCost,
  formatRate,
} from "@/lib/workplace/catalog";
import type { HireView, JobStatus, JobView, ReportMode, Retention, WorkplaceState, WorkspaceSummary } from "@/lib/workplace/types";
import { CSV_MAX_LENGTH } from "@/lib/marketplace/types";

const apiBase = (ws: string) => `/api/workspaces/${encodeURIComponent(ws)}`;

type Selection = null | "dispatcher" | { hireId: string; jobId?: string } | { desk: string };

const DESKS = [
  { desk: "workstation-01", label: "Cubicle 01", className: "office-inspection" },
  { desk: "desk-02", label: "Cubicle 02", className: "office-openDesk" },
  { desk: "desk-03", label: "Cubicle 03", className: "office-deskThree" },
] as const;

const STATUS_LABEL: Record<JobStatus, string> = {
  needs_worker: "Needs a worker",
  queued: "Assigned",
  working: "Working",
  completed: "Report ready",
  failed: "Failed",
};

// Module-level so it is never treated as a render-time side effect.
function newRequestId() {
  return crypto.randomUUID();
}

function Avatar({ worker, small = false, away = false }: { worker: { color: string; sprite: SpriteSpec }; small?: boolean; away?: boolean }) {
  return <span aria-hidden="true" className={`office-avatar office-${worker.color} ${small ? "office-smallAvatar" : ""} ${away ? "office-away" : ""}`}><PixelCharacter sprite={worker.sprite} /></span>;
}


/** Community characters borrow the line set of their main skill; idle, they use their own greeting. */
function workerVoice(hire: HireView, job: JobView | undefined, greeting: string | undefined): string {
  if (hire.sprite.kind === "cast" && hire.listingKind !== "community") return characterVoice(hire.sprite.id, job);
  if (hire.skills.includes("inventory_audit")) return job ? inventoryVoice(job) : greeting ?? inventoryVoice();
  const like = hire.skills.includes("supplier_research") ? "procurement_researcher" : hire.skills.includes("camera_diagnostics") ? "quality_inspector" : "catalog_assistant";
  const line = characterVoice(like, job);
  return line === CHARACTERS[like].voice ? greeting ?? hire.specialty : line;
}

const marketplaceHref = (params: Record<string, string | undefined>) => {
  const q = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1]));
  return `/marketplace${q.size ? `?${q}` : ""}`;
};

function ModeBadge({ mode }: { mode: ReportMode }) {
  const text = mode === "local" ? "EXECUTED LOCALLY" : mode === "live" ? "LIVE" : mode === "sample" ? "SAMPLE · fixture" : "SIMULATED";
  return <span className={`office-modeBadge office-mode-${mode}`}>{text}</span>;
}


async function api(path: string, body?: unknown): Promise<{ ok: true; state: WorkplaceState } | { ok: false; error: { code: string; message: string } }> {
  try {
    const res = await fetch(path, body === undefined ? { cache: "no-store" } : {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    return await res.json();
  } catch {
    return { ok: false, error: { code: "NETWORK", message: "Could not reach the local task service." } };
  }
}

/** Reads ?workspace= and renders that office. Keyed so switching offices starts from clean state. */
export default function Office() {
  const params = useSearchParams();
  const ws = params.get("workspace");
  // ?arrived=<hireId>: just hired from /marketplace, so that worker walks in through the entrance.
  return ws ? <OfficeView key={ws} workspaceId={ws} arrivedHireId={params.get("arrived")} /> : <OpenPrimaryOffice />;
}

/** /office with no ?workspace= opens the signed-in user's primary office. */
function OpenPrimaryOffice() {
  const router = useRouter();
  const pathname = usePathname();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/workspaces", { cache: "no-store" }).then(r => r.json()).then(r => {
      if (cancelled) return;
      if (r.ok && r.primaryWorkspaceId) router.replace(`${pathname}?workspace=${encodeURIComponent(r.primaryWorkspaceId)}`);
      else setError(r.error?.message ?? "Could not open your office.");
    }).catch(() => { if (!cancelled) setError("Could not reach the local task service."); });
    return () => { cancelled = true; };
  }, [router, pathname]);
  return <main className="office-loading">{error ? <span role="alert">{error} <a href="/auth/login?returnTo=/office">Sign in</a></span> : "Opening your office…"}</main>;
}

function OfficeSwitcher({ current, currentName }: { current: string; currentName?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [offices, setOffices] = useState<WorkspaceSummary[]>([]);
  const [viewer, setViewer] = useState<{ name: string | null; email: string | null } | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/workspaces", { cache: "no-store" }).then(r => r.json()).then(r => { if (!cancelled && r.ok) { setOffices(r.workspaces); setViewer(r.viewer); } }).catch(() => {});
    return () => { cancelled = true; };
  }, [current]);

  const go = (id: string) => router.push(`${pathname}?workspace=${encodeURIComponent(id)}`);

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const res = await fetch("/api/workspaces", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }).then(r => r.json()).catch(() => null);
    if (!res?.ok) { setError(res?.error?.message ?? "Could not create the office."); return; }
    setCreating(false);
    setName("");
    go(res.workspace.id);
  }

  const known = offices.some(o => o.id === current);
  return (
    <div className="office-switcher">
      <label className="office-switcherLabel">
        <span>Office</span>
        <select name="workspace" value={current} onChange={e => go(e.target.value)}>
          {!known && <option value={current}>{currentName ?? current}</option>}
          {offices.map(o => <option key={o.id} value={o.id}>{o.name} ({o.teamSize} on team · {o.totalJobs} jobs)</option>)}
        </select>
      </label>
      {creating ? (
        <form className="office-newOffice" onSubmit={create}>
          <input name="officeName" aria-label="New office name" placeholder="Office name" value={name} maxLength={60} required autoFocus onChange={e => setName(e.target.value)} />
          <button type="submit" className="office-reset">Create</button>
          <button type="button" className="office-reset" onClick={() => { setCreating(false); setError(null); }}>Cancel</button>
          {error && <span className="office-errorText" role="alert">{error}</span>}
        </form>
      ) : (
        <button type="button" className="office-reset" onClick={() => setCreating(true)}>New office <span aria-hidden="true">+</span></button>
      )}
      {viewer && (
        <span className="office-viewer">
          Signed in as <strong>{viewer.name ?? viewer.email ?? "you"}</strong>
          {/* Plain <a>: /auth/* routes are handled by the Auth0 proxy, not client navigation. */}
          <a className="office-reset" href="/auth/logout">Log out</a>
        </span>
      )}
    </div>
  );
}

function OfficeView({ workspaceId, arrivedHireId }: { workspaceId: string; arrivedHireId: string | null }) {
  const base = apiBase(workspaceId);
  const router = useRouter();
  const [state, setState] = useState<WorkplaceState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [announcement, setAnnouncement] = useState("");
  const [arrivals, setArrivals] = useState<Set<string>>(() => new Set(arrivedHireId ? [arrivedHireId] : []));
  // Workers who left while this page was open: they walk out before disappearing.
  const [leaving, setLeaving] = useState<HireView[]>([]);
  const teamIds = useRef<Set<string> | null>(null);
  const apply = useCallback((next: WorkplaceState) => {
    const before = teamIds.current;
    if (before) {
      const gone = next.formerHires.filter(h => before.has(h.id));
      if (gone.length) setLeaving(list => [...list.filter(l => !gone.some(g => g.id === l.id)), ...gone]);
    }
    teamIds.current = new Set(next.team.map(h => h.id));
    setState(next);
  }, []);
  const panelHeading = useRef<HTMLHeadingElement>(null);
  const floorHeading = useRef<HTMLHeadingElement>(null);
  const focusMapOnHire = useRef(false);

  const refresh = useCallback(async () => {
    const r = await api(base);
    if (r.ok) { apply(r.state); setLoadError(null); } else setLoadError(r.error.message);
  }, [base, apply]);

  useEffect(() => {
    let cancelled = false;
    api(base).then(r => {
      if (cancelled) return;
      if (r.ok) {
        apply(r.state);
        const arrived = arrivedHireId ? r.state.team.find(h => h.id === arrivedHireId) : undefined;
        if (arrived) setAnnouncement(`${arrived.characterName}, ${arrived.role}, hired from the marketplace and walking in to ${DESKS.find(d => d.desk === arrived.desk)?.label}.`);
      } else setLoadError(r.error.message);
    });
    return () => { cancelled = true; };
  }, [base, arrivedHireId, apply]);

  // Drop ?arrived= so a reload places the worker at its desk instead of replaying the entrance.
  useEffect(() => {
    if (arrivedHireId) router.replace(`/office?workspace=${encodeURIComponent(workspaceId)}`, { scroll: false });
  }, [arrivedHireId, router, workspaceId]);

  // Poll while any job is assigned or running.
  const busy = state?.jobs.some(j => j.status === "queued" || j.status === "working") ?? false;
  useEffect(() => {
    if (!busy) return;
    const id = setInterval(refresh, 1000);
    return () => clearInterval(id);
  }, [busy, refresh]);

  useEffect(() => {
    if (focusMapOnHire.current) { focusMapOnHire.current = false; return; }
    if (selection) panelHeading.current?.focus();
  }, [selection]);

  // Announce reports as they come back.
  const completedRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!state) return;
    const done = state.jobs.filter(j => j.status === "completed" || j.status === "failed");
    if (completedRef.current) {
      const fresh = done.find(j => !completedRef.current!.has(j.id));
      if (fresh) {
        const left = state.formerHires.some(h => h.id === fresh.hireId && h.jobId === fresh.id);
        const after = left ? " Hired for this job only, so it is leaving the office." : "";
        setAnnouncement((fresh.report ? `${fresh.hireRole} returned to reception with a ${fresh.report.mode.toUpperCase()} report: ${fresh.report.summary}` : `${fresh.hireRole} could not finish: ${fresh.error?.message ?? "failed"}`) + after);
      }
    }
    completedRef.current = new Set(done.map(j => j.id));
  }, [state]);

  function onRequestReply(r: RequestReply) {
    if (!r.ok || r.kind !== "job") return;
    apply(r.state);
    const job = r.state.jobs.find(j => j.id === r.jobId);
    if (job && (job.status === "queued" || job.status === "working")) requestAnimationFrame(() => floorHeading.current?.focus());
    setAnnouncement(job?.status === "needs_worker" ? "Dispatcher: nobody on the team has this skill. Review the recommended hire." : `Dispatcher assigned the job to ${job?.hireRole}.`);
  }

  async function setFault(cameraFault: string) {
    const r = await api(`${base}/simulator`, { cameraFault });
    if (r.ok) { apply(r.state); setAnnouncement(`SIMULATED camera fault set: ${SCENARIOS.find(sc => sc.id === cameraFault)?.title}.`); }
    else setAnnouncement(r.error.message);
  }

  async function hire(profileId: string, jobId?: string, terms: { retention?: Retention; instructions?: string } = {}) {
    const r = await api(`${base}/hires`, { profileId, jobId, ...terms }) as Awaited<ReturnType<typeof api>> & { hireId?: string };
    if (!r.ok) { setAnnouncement(r.error.message); return; }
    const h = r.state.team.find(t => t.id === r.hireId) ?? r.state.team.find(t => t.profileId === profileId);
    if (h && !state?.team.some(previous => previous.id === h.id)) setArrivals(previous => new Set(previous).add(h.id));
    apply(r.state);
    const kept = h?.retention === "team" ? "Kept on the team." : "Hired for this job only: it leaves after the report.";
    setAnnouncement(`${h?.characterName}, ${h?.role}, hired and walking in to ${DESKS.find(d => d.desk === h?.desk)?.label}. ${kept}${jobId ? " The original job resumed automatically." : ""}`);
    if (!jobId && h) { focusMapOnHire.current = true; setSelection({ hireId: h.id }); }
    requestAnimationFrame(() => floorHeading.current?.focus());
  }

  /** Keep on team, release, or save instructions. */
  async function updateHire(hireId: string, change: { retention?: Retention; instructions?: string }): Promise<string | null> {
    const r = await api(`${base}/hires/${encodeURIComponent(hireId)}`, change);
    if (!r.ok) { setAnnouncement(r.error.message); return r.error.message; }
    apply(r.state);
    const h = [...r.state.team, ...r.state.formerHires].find(x => x.id === hireId);
    setAnnouncement(change.instructions !== undefined ? `Instructions saved for ${h?.characterName}.`
      : change.retention === "team" ? `${h?.characterName} will stay on the team after this job.`
      : h?.departedAt ? `${h?.characterName} was released and left the office.` : `${h?.characterName} will leave after the current job.`);
    return null;
  }

  async function resetDemo() {
    const officeName = state?.workspace.name ?? workspaceId;
    if (!window.confirm(`Reset “${officeName}”? This deletes this office’s hires, jobs, reports and simulator settings. Other offices are not affected.`)) return;
    const r = await api(`${base}/reset`, {});
    if (r.ok) { setArrivals(new Set()); setLeaving([]); teamIds.current = null; apply(r.state); setSelection(null); setAnnouncement(`${officeName} reset. Only the Quality Inspector remains on the team.`); }
    else setAnnouncement(r.error.message);
  }

  function select(next: Selection) {
    if (JSON.stringify(next) === JSON.stringify(selection)) panelHeading.current?.focus();
    else setSelection(next);
  }

  const team = state?.team ?? [];
  const hireAt = (desk: string) => team.find(h => h.desk === desk);
  const formerHires = state?.formerHires ?? [];
  const selectedHire = selection && typeof selection === "object" && "hireId" in selection ? [...team, ...formerHires].find(h => h.id === selection.hireId) : undefined;
  const selectedReportId = selection && typeof selection === "object" && "hireId" in selection ? selection.jobId : undefined;
  const selectedDesk = selection && typeof selection === "object" && "desk" in selection ? selection.desk : undefined;
  const openDesks = DESKS.filter(d => !hireAt(d.desk)).length;

  return (
    <main className="office-office" data-preview-branch={process.env.NEXT_PUBLIC_PREVIEW_BRANCH} data-preview-commit={process.env.NEXT_PUBLIC_PREVIEW_COMMIT}>
      <header className="office-header">
        <Link className="office-brand" href="/"><span className="office-logo" aria-hidden="true">a<span>i</span></span> AI Workplace</Link>
        <OfficeSwitcher current={workspaceId} currentName={state?.workspace.name} />
        <div className="office-headerBadges">
          {state && (state.dispatcher.engine === "gemini"
            ? <span className="office-demoBadge office-geminiBadge" title="Requests are interpreted by Gemini; routing, hiring and permissions stay on the server."><span /> DISPATCHER: GEMINI · {state.dispatcher.model}</span>
            : <span className="office-demoBadge" title="Set GEMINI_API_KEY on the server to use Gemini."><span /> DISPATCHER: BUILT-IN RULES</span>)}
          {state && (state.procurementMode === "live"
            ? <span className="office-demoBadge office-liveBadge"><span /> PROCUREMENT: LIVE TINYFISH</span>
            : <span className="office-demoBadge office-sampleBadge"><span /> PROCUREMENT: SAMPLE FIXTURE · 0 CREDITS</span>)}
          <span className="office-demoBadge"><span /> LOCAL DEMO · SAVED</span>
        </div>
      </header>

      {!state && loadError ? (
        // Not found, not yours, or signed out: show nothing of the office itself.
        <div className="office-workspace">
          <p className="office-eyebrow">OFFICE UNAVAILABLE</p>
          <p className="office-errorText" role="alert">{loadError}</p>
          <p className="office-jobMeta"><a href="/office">Go to your office</a></p>
        </div>
      ) : (
      <div className="office-workspace">
        <div className="office-pageHeading">
          <div><p className="office-eyebrow">WORKSPACE / {(state?.workspace.name ?? workspaceId).toUpperCase()}</p><h1>{state?.workspace.name ?? "Your office"}</h1><p>Give the Dispatcher a job. It checks your team’s skills, assigns a qualified worker, or recommends a hire.</p></div>
          <Link className="office-reset" href="/">← Workspaces</Link>
        </div>

        {loadError && <p className="office-errorText" role="alert">{loadError}</p>}

        <div className="office-layout">
          <section className="office-officeCard" aria-labelledby="floor-title">
            <div className="office-floorHeader"><div><span className="office-liveDot" /><h2 id="floor-title" ref={floorHeading} tabIndex={-1}>Your office</h2></div><span>{team.length} {team.length === 1 ? "worker" : "workers"} + Dispatcher <span className="office-separator">/</span> {openDesks} open {openDesks === 1 ? "desk" : "desks"}</span></div>
            <OfficeMap team={team} leaving={leaving} onGone={id => setLeaving(list => list.filter(h => h.id !== id))} jobs={state?.jobs ?? []} loaded={state !== null} arrivals={arrivals}
              selectedHire={selectedHire?.id} selectedDesk={selectedDesk} dispatcherSelected={selection === null || selection === "dispatcher"}
              onWorker={(hireId, jobId) => select({ hireId, jobId })} onDesk={desk => select({ desk })} onDispatcher={() => select("dispatcher")} />
            <div className="office-floorFooter"><span aria-hidden="true">↖</span> Empty desk: hire a worker. Workers bring reports to reception: job-only hires then leave, kept workers return to their desk.</div>
          </section>

          <aside id="office-panel" className="office-panel" aria-labelledby="panel-title">
            {selectedDesk && state ? (
              <>
                <div className="office-panelHeader"><p className="office-eyebrow">FIND YOUR NEXT TEAMMATE</p><h2 id="panel-title" ref={panelHeading} tabIndex={-1}>The marketplace</h2></div>
                <div className="office-panelBody">
                  <DeskDetails desk={selectedDesk} />
                  <p className="office-muted">Hire a worker for {DESKS.find(d => d.desk === selectedDesk)?.label}. Hiring is saved and later jobs that need the worker’s skill go to it.</p>
                  <Link className="office-marketLink" href={marketplaceHref({ workspace: workspaceId })}>Browse the full marketplace: official and community agents <span aria-hidden="true">↗</span></Link>
                  {state.marketplace.map(p => <CandidateCard key={p.id} profile={p} hired={p.hired} onHire={() => hire(p.id)} />)}
                  <p className="office-finePrint">Demo hourly rates. Demo charges are calculated per second of run time and are not billed.</p>
                </div>
              </>
            ) : selectedHire && state ? (
              <WorkerPanel key={`${selectedHire.id}:${selectedReportId ?? ""}`} hire={selectedHire} state={state} reportJobId={selectedReportId} headingRef={panelHeading}
                onUpdate={change => updateHire(selectedHire.id, change)}
                onRun={next => { apply(next); setAnnouncement("Inventory audit assigned. Its report will appear when execution finishes."); }} />
            ) : (selection === "dispatcher" || selection === null) ? (
              <>
                <div className="office-panelHeader"><p className="office-eyebrow">WORKER DETAILS</p><h2 id="panel-title" ref={panelHeading} tabIndex={-1}>Dispatcher</h2></div>
                <div className="office-panelBody">
                  <div className="office-characterIdentity"><PixelCharacter id="dispatcher" portrait gesture="wave" /><div><h3>Milo</h3><p>Dispatcher · reception</p><span className="office-status"><span /> Ready to help</span></div></div>
                  <blockquote className="office-characterVoice">“{CHARACTERS.dispatcher.voice}”</blockquote>
                  <ul className="office-skills"><li>Task routing</li><li>Team skill matching</li><li>Hiring recommendations</li></ul>
                  <dl className="office-details"><div><dt>Hourly rate</dt><dd>Included · built-in staff</dd></div><div><dt>Current task</dt><dd>{state?.jobs.find(job => job.status === "needs_worker") ? "Waiting for your hiring decision" : "Reception · ready for your next request"}</dd></div></dl>
                </div>
              </>
            ) : (
              <>
                <div className="office-panelHeader"><p className="office-eyebrow">A PLACE TO GET THINGS DONE</p><h2 id="panel-title" ref={panelHeading} tabIndex={-1}>Good teams start here.</h2></div>
                <div className="office-panelBody">
                  <div className="office-welcomeArt" aria-hidden="true"><span>✳</span><span>↗</span><span>✦</span></div>
                  <ol className="office-steps">
                    <li><span>01</span><p><strong>Submit a job</strong>The Dispatcher checks which skills your team has.</p></li>
                    <li><span>02</span><p><strong>Approve a hire if needed</strong>See the recommended worker’s skills and hourly rate.</p></li>
                    <li><span>03</span><p><strong>Get the report</strong>The original job resumes automatically, and later jobs reuse the hire.</p></li>
                  </ol>
                  <button className="office-hireButton" type="button" onClick={() => select("dispatcher")}>Meet the Dispatcher <span aria-hidden="true">↗</span></button>
                </div>
              </>
            )}
            <div className="office-requestDock" hidden={selection !== null && selection !== "dispatcher"}>
              <RequestForm base={base} onReply={onRequestReply} disabled={!state} engine={state?.dispatcher.engine ?? "rules"} />
              <SmsPanel workspaceId={workspaceId} />
              <h3 className="office-sectionLabel">RECENT DECISIONS</h3>
              <ul className="office-eventList">
                {(state?.jobs ?? []).flatMap(j => j.events.filter(e => e.actor === "Dispatcher").map(e => ({ ...e, job: j.title }))).sort((a, b) => b.at - a.at).slice(0, 5)
                  .map((e, i) => <li key={i}><strong>{e.job}</strong>{e.text}</li>)}
              </ul>
              {!state?.jobs.length && <p className="office-muted">No decisions yet.</p>}
            </div>
          </aside>
        </div>
        <section className="office-incident office-jobDesk" aria-labelledby="jobs-title">
          <div className="office-savedJobsHeading"><h2 id="jobs-title" className="office-jobsTitle">Jobs and reports</h2><Link href={`/workflow?workspace=${encodeURIComponent(state?.workspaceId ?? workspaceId)}`}>View workflow history ↗</Link></div>
          {!state ? <p className="office-muted">Loading saved workspace…</p>
            : state.jobs.length === 0 ? <p className="office-muted">No jobs yet. Give the Dispatcher a request at reception.</p>
            : <ol className="office-jobList">{state.jobs.map(job => <JobCard key={job.id} job={job} state={state} onHire={hire} onKeep={hireId => updateHire(hireId, { retention: "team" })} />)}</ol>}
        </section>
        <details className="office-demoControls"><summary>Demo controls</summary>
          {state && <SimulatorControls fault={state.simulator.cameraFault} onChange={setFault} />}
          <button className="office-reset" type="button" onClick={resetDemo}>Reset demo</button>
          <p className="office-finePrint">Reset deletes this workspace’s saved hires, jobs and reports.</p>
        </details>
        <p className="office-announcement" role="status">{announcement}</p>
        <footer className="office-pageFooter"><span>Built around the work. And the people directing it.</span><span>Team, jobs and reports are saved locally in SQLite.</span></footer>
      </div>
      )}
    </main>
  );
}

type DispatcherReply = { engine: "gemini" | "rules"; model: string | null; fallback: string | null };
type RequestReply =
  | { ok: true; kind: "job"; jobId: string; understood: string; state: WorkplaceState; dispatcher?: DispatcherReply }
  | { ok: true; kind: "follow_up"; question: string; pending: { transcript: { actor: "You" | "Dispatcher"; text: string }[] }; dispatcher?: DispatcherReply }
  | { ok: true; kind: "unsupported"; message: string; dispatcher?: DispatcherReply }
  | { ok: false; error: { code: string; message: string } };

const EXAMPLES = [
  "Find a Raspberry Pi 5 4GB on Adafruit",
  "The camera feed at Packing Station 1 stopped",
  "I need a replacement part",
  "Which items in our inventory are low on stock?",
];

const fallbackNote = (d?: DispatcherReply) => d?.fallback ? ` (Gemini was unavailable: ${d.fallback.replace("GEMINI_", "").toLowerCase().replaceAll("_", " ")}. The built-in rules answered.)` : "";

function RequestForm({ base, onReply, disabled, engine }: { base: string; onReply: (reply: RequestReply) => void; disabled: boolean; engine: "gemini" | "rules" }) {
  const [text, setText] = useState("");
  // Private inventory CSV: sent to this office's server only, never to Gemini.
  const [csv, setCsv] = useState("");
  const [csvOpen, setCsvOpen] = useState(false);
  const [pending, setPending] = useState<Extract<RequestReply, { kind: "follow_up" }>["pending"] | null>(null);
  const [reply, setReply] = useState<{ tone: "info" | "unsupported" | "error"; text: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // One id per conversation, so a retried submit cannot create a duplicate job.
  const requestId = useRef<string | null>(null);

  function startOver() {
    setPending(null);
    setReply(null);
    setText("");
    setCsv("");
    requestId.current = null;
  }

  async function readFile(file: File | undefined) {
    if (!file) return;
    if (file.size > CSV_MAX_LENGTH) { setReply({ tone: "error", text: `That file is larger than ${CSV_MAX_LENGTH.toLocaleString()} characters.` }); return; }
    setCsv(await file.text());
  }

  async function handle(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || (!text.trim() && !csv.trim())) return;
    setSubmitting(true);
    requestId.current ??= newRequestId();
    let r: RequestReply;
    try {
      const res = await fetch(`${base}/jobs`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientRequestId: requestId.current, request: text, pending: pending ?? undefined, csv: csv.trim() ? csv : undefined }),
      });
      r = await res.json();
    } catch {
      r = { ok: false, error: { code: "NETWORK", message: "Could not reach the local task service." } };
    }
    setSubmitting(false);
    onReply(r);
    if (!r.ok) { setReply({ tone: "error", text: r.error.message }); return; }
    if (r.kind === "follow_up") {
      setPending(r.pending); setText("");
      if (/inventory CSV/i.test(r.question)) setCsvOpen(true);
      setReply(r.dispatcher?.fallback ? { tone: "info", text: fallbackNote(r.dispatcher).trim() } : null);
      return;
    }
    if (r.kind === "unsupported") { setPending(null); setReply({ tone: "unsupported", text: r.message + fallbackNote(r.dispatcher) }); requestId.current = null; return; }
    setPending(null);
    setText("");
    setCsv("");
    setCsvOpen(false);
    requestId.current = null;
    setReply({ tone: "info", text: `Understood as ${r.understood}${fallbackNote(r.dispatcher)}` });
  }

  const asking = pending !== null;
  const lastQuestion = asking ? [...pending.transcript].reverse().find(l => l.actor === "Dispatcher")?.text : undefined;

  return (
    <form className="office-jobForm" onSubmit={handle} aria-labelledby="job-form-title">
      <p className="office-eyebrow">RECEPTION · DISPATCHER</p>
      <h2 id="job-form-title">Give the Dispatcher a job</h2>
      {asking && (
        <ol className="office-conversation" aria-label="Conversation with the Dispatcher">
          {pending.transcript.map((line, i) => (
            <li key={i} className={line.actor === "You" ? "office-saidYou" : "office-saidDispatcher"}><strong>{line.actor}</strong>{line.text}</li>
          ))}
        </ol>
      )}
      <label className="office-field">
        {asking ? "Your answer" : "What do you need help with?"}
        <textarea name="request" rows={asking ? 2 : 3} value={text} maxLength={500} required={!csv.trim()}
          aria-describedby={asking ? "dispatcher-question" : undefined}
          placeholder={asking ? "Answer the Dispatcher’s question" : "e.g. Find a Raspberry Pi 5 4GB on Adafruit"}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} />
      </label>
      {asking && <p id="dispatcher-question" className="office-visuallyHidden">{lastQuestion}</p>}
      <details className="office-csvAttach" open={csvOpen} onToggle={e => setCsvOpen(e.currentTarget.open)}>
        <summary>{csv.trim() ? `Inventory CSV attached · ${csv.trim().split(/\r?\n/).length - 1} rows` : "Attach an inventory CSV (optional)"}</summary>
        <label className="office-field">Inventory CSV (header sku,quantity)
          <textarea name="csv" rows={4} value={csv} maxLength={CSV_MAX_LENGTH} spellCheck={false} placeholder={"sku,quantity\nPART-A,3\nPART-B,12"} onChange={e => setCsv(e.target.value)} />
        </label>
        <label className="office-csvFile">Or choose a .csv file <input type="file" accept=".csv,text/csv,text/plain" onChange={e => void readFile(e.target.files?.[0])} /></label>
        <p className="office-finePrint">Stays private to this office. {engine === "gemini" ? "Gemini is told only that a CSV is attached, never its contents." : "Read only by the worker who audits it."}</p>
      </details>
      <div className="office-formActions">
        <button className="office-hireButton" type="submit" disabled={disabled || submitting || (!text.trim() && !csv.trim())}>
          {submitting ? "Dispatcher is reading…" : asking ? "Answer the Dispatcher" : "Send to Dispatcher"} <span aria-hidden="true">↗</span>
        </button>
        {(asking || reply) && <button type="button" className="office-reset" onClick={startOver}>Start over</button>}
      </div>
      {reply && <p className={`office-dispatcherReply office-reply-${reply.tone}`} role={reply.tone === "error" ? "alert" : "status"}><strong>Dispatcher:</strong> {reply.text}</p>}
      {!asking && (
        <div className="office-examples" aria-label="Example requests">
          <span>Try:</span>
          {EXAMPLES.map(ex => <button key={ex} type="button" onClick={() => { setText(ex); setReply(null); requestId.current = null; }}>{ex}</button>)}
        </div>
      )}
      <p className="office-finePrint">{engine === "gemini" ? "Gemini reads your request and proposes a job; the server checks it and decides who does it." : "The Dispatcher matches your request to a skill with built-in rules."} Supplier lookups use the SAMPLE fixture unless the server runs with PROCUREMENT_MODE=live.</p>
    </form>
  );
}

function SimulatorControls({ fault, onChange }: { fault: string; onChange: (fault: string) => void }) {
  return (
    <section className="office-simControls" aria-labelledby="sim-title">
      <div>
        <p className="office-eyebrow"><span className="office-modeBadge office-mode-simulated">SIMULATED</span> SIMULATOR CONTROLS · PACKING STATION 1</p>
        <h2 id="sim-title">Camera fault for the next camera job</h2>
        <p className="office-jobMeta">This sets what the simulated station reports. The Quality Inspector never sees this choice. It receives only the station’s observations and decides from those.</p>
      </div>
      <fieldset className="office-faults">
        <legend className="office-visuallyHidden">Simulated camera fault</legend>
        {SCENARIOS.map(sc => (
          <label key={sc.id} className="office-jobType">
            <input type="radio" name="cameraFault" value={sc.id} checked={fault === sc.id} onChange={() => onChange(sc.id)} />
            <span><strong>{sc.title}</strong><small>{sc.description}</small></span>
          </label>
        ))}
      </fieldset>
    </section>
  );
}

function CandidateCard({ profile, hired, onHire, highlightSkill, cta, children }: { profile: MarketplaceListing; hired: boolean; onHire: () => void; highlightSkill?: string; cta?: string; children?: React.ReactNode }) {
  return (
    <article className="office-candidate" data-listing-id={profile.id}>
      <div className="office-candidateHeading"><Avatar worker={profile} /><div><h3>{profile.characterName} · {profile.role}</h3><ListingBadge kind={profile.kind} publisher={profile.publisher.name} /><span className="office-rate">{formatRate(profile.hourlyRateCents).replace(" / hour", "")}<small> / hour</small></span></div></div>
      <p>{profile.specialty}</p>
      <ul className="office-skills" aria-label="Skills">{profile.skills.map(s => <li key={s} className={s === highlightSkill ? "office-skillMatch" : ""}>{SKILLS[s]}{s === highlightSkill ? " ✓" : ""}</li>)}</ul>
      {profile.actionConfig && <p className="office-candidateMeta"><strong>Action:</strong> Inventory CSV audit, executed locally. Low stock below {profile.actionConfig.minimumQuantity}; restock to {profile.actionConfig.targetQuantity}.</p>}
      <p className="office-candidateMeta"><strong>Sample work:</strong> {profile.sampleWork}</p>
      <p className="office-candidateMeta"><strong>Permissions:</strong> {profile.permissions.join("; ")}.</p>
      {children}
      <button className="office-hireButton" type="button" disabled={hired} onClick={onHire}>{hired ? "Already on your team" : cta ?? `Hire ${profile.role}`} <span aria-hidden="true">↗</span></button>
    </article>
  );
}

const clockNow = () => Date.now();

/** Live demo meter: runs while the job executes, stops at the saved finish time. Display only; the saved report holds the charge. */
function DemoMeter({ job, rateCents }: { job: JobView; rateCents: number | null }) {
  const running = job.status === "working" && job.startedAt !== null;
  const [now, setNow] = useState(clockNow);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(clockNow()), 500);
    return () => clearInterval(id);
  }, [running]);
  if (job.startedAt === null) return null;
  if (rateCents === null) return <p className="office-meter" data-meter="staff">Staff time · not billed</p>;
  const ms = running ? Math.max(0, now - job.startedAt) : job.report?.runtimeMs ?? Math.max(0, (job.finishedAt ?? job.startedAt) - job.startedAt);
  const cents = running ? demoCostCents(rateCents, ms) : job.report?.demoCostCents ?? (job.status === "failed" ? 0 : demoCostCents(rateCents, ms));
  return <p className="office-meter" data-meter={running ? "running" : "stopped"} role={running ? undefined : "status"}>
    <span className="office-meterDot" aria-hidden="true" />
    Demo meter {running ? "running" : "stopped"}: <strong>{formatCost(cents)}</strong> · {(ms / 1000).toFixed(1)} s at {formatRate(rateCents)}{!running && job.status === "failed" ? " · failed runs are not billed" : ""}
  </p>;
}

function ReportBodyView({ report }: { report: NonNullable<JobView["report"]> }) {
  const body = report.body;
  if (body.type === "inventory_audit") return <InventoryReport result={body.result} />;
  if (body.type === "supplier_lookup") return <SupplierReport result={body.result} />;
  return <>
    {body.simulatorFault && <p className="office-jobMeta office-simNote">SIMULATED fault from simulator controls (not shown to the Inspector): {SCENARIOS.find(sc => sc.id === body.simulatorFault)?.title}</p>}
    <CameraIncidentReport incident={body.incident} />
  </>;
}

type HireTerms = { retention?: Retention; instructions?: string };

/** Approval terms: "For this job" is the default; "Keep on team" reuses the worker later. */
function HireTermsFields({ name, retention, onRetention, instructions, onInstructions }: { name: string; retention: Retention; onRetention: (r: Retention) => void; instructions: string; onInstructions: (v: string) => void }) {
  return <fieldset className="office-terms">
    <legend>How long should {name} stay?</legend>
    <label><input type="radio" name={`terms-${name}`} checked={retention === "job"} onChange={() => onRetention("job")} /> <span><strong>For this job</strong><small>Returns the report at reception, then leaves. Its report stays in workflow history.</small></span></label>
    <label><input type="radio" name={`terms-${name}`} checked={retention === "team"} onChange={() => onRetention("team")} /> <span><strong>Keep on team</strong><small>Returns to its desk; later jobs needing its skills go to it first.</small></span></label>
    <label className="office-field">Instructions for {name} (optional, saved with this hire)
      <textarea rows={2} maxLength={1000} value={instructions} onChange={e => onInstructions(e.target.value)} placeholder="e.g. Prefer listings that are in stock and note the price." />
    </label>
  </fieldset>;
}

function JobCard({ job, state, onHire, onKeep }: { job: JobView; state: WorkplaceState; onHire: (profileId: string, jobId: string, terms: HireTerms) => void; onKeep: (hireId: string) => void }) {
  const recommended = job.status === "needs_worker" ? state.marketplace.find(p => p.id === job.recommendedProfileId) : undefined;
  const posting = JOB_TYPES[job.type].posting;
  const [retention, setRetention] = useState<Retention>("job");
  const [instructions, setInstructions] = useState("");
  const worker = [...state.team, ...state.formerHires].find(h => h.id === job.hireId);
  const jobOnly = worker && worker.retention === "job" && worker.jobId === job.id;
  return (
    <li className={`office-jobCard office-job-${job.status}`} data-job-id={job.id}>
      <div className="office-jobHead">
        <strong>{job.title}</strong>
        <span className={`office-jobStatus office-jobStatus-${job.status}`}>{STATUS_LABEL[job.status]}</span>
        {job.report && <ModeBadge mode={job.report.mode} />}
      </div>
      {job.input.request && <p className="office-jobRequest">“{job.input.request}”</p>}
      {job.sms && <p className="office-jobMeta office-smsJob">📱 Requested by text from {job.sms.phone} · job code <strong>{job.sms.code}</strong></p>}
      {"csv" in job.input && <p className="office-jobMeta">Input: private inventory CSV ({job.input.csv.trim().split(/\r?\n/).length - 1} rows), kept in this office.</p>}
      <p className="office-jobMeta">
        Needs {SKILLS[job.requiredSkill]} · {job.hireRole ? <>Assigned to <strong>{job.hireName ? `${job.hireName}, ` : ""}{job.hireRole}</strong>{worker ? (worker.departedAt ? " · left the office" : jobOnly ? " · for this job" : " · on the team") : ""}</> : "Unassigned"}
      </p>

      {recommended && (
        <div className="office-recommendation" aria-label="Dispatcher recommendation">
          <p className="office-eyebrow">DISPATCHER RECOMMENDS A HIRE</p>
          <p className="office-jobMeta">Nobody kept on your team has <strong>{SKILLS[job.requiredSkill]}</strong>. Job posting: {posting.deliverable} Sources: {posting.allowedSources} Needs approval: {posting.needsApproval}</p>
          <CandidateCard profile={recommended} hired={false} highlightSkill={job.requiredSkill}
            cta={`Approve hire at ${formatRate(recommended.hourlyRateCents)} and resume job`} onHire={() => onHire(recommended.id, job.id, { retention, instructions })}>
            <HireTermsFields name={recommended.characterName} retention={retention} onRetention={setRetention} instructions={instructions} onInstructions={setInstructions} />
          </CandidateCard>
          <Link className="office-marketLink" href={marketplaceHref({ workspace: state.workspaceId, job: job.id, skill: job.requiredSkill })}>Compare every qualified worker in the marketplace <span aria-hidden="true">↗</span></Link>
        </div>
      )}
      {job.status === "needs_worker" && !recommended && <p className="office-errorText">No marketplace worker has this skill yet. <Link href="/marketplace?filter=community">Publish or find a community agent ↗</Link></p>}

      {(job.status === "queued" || job.status === "working") && <p className="office-jobMeta" role="status">{job.status === "working" ? `${job.hireRole} is working on it…` : `${job.hireRole} is about to start.`}</p>}
      {(job.status === "queued" || job.status === "working") && jobOnly && !worker.departedAt && (
        <p className="office-keepRow">Hired for this job only. <button type="button" className="office-reset" onClick={() => onKeep(worker.id)}>Keep {worker.characterName} on team</button></p>
      )}
      <DemoMeter job={job} rateCents={worker?.hourlyRateCents ?? job.report?.hourlyRateCents ?? null} />

      {job.status === "failed" && job.error && <p className="office-errorText">{job.error.code}: {job.error.message}</p>}

      {job.report && (
        <div className="office-reportSummary">
          <p><strong>{job.report.summary}</strong></p>
          <p className="office-jobMeta">Runtime {(job.report.runtimeMs / 1000).toFixed(1)}s · Demo cost {job.report.demoCostCents === null ? "not billed (staff)" : `${formatCost(job.report.demoCostCents)} at ${formatRate(job.report.hourlyRateCents)}`}</p>
          <details>
            <summary>Open report</summary>
            <ReportBodyView report={job.report} />
          </details>
        </div>
      )}

      <p className="office-workflowLink"><Link href={`/workflow?workspace=${encodeURIComponent(state.workspaceId)}&job=${encodeURIComponent(job.id)}`}>View this job’s workflow ↗</Link></p>
      <details className="office-jobHistory">
        <summary>Job history ({job.events.length})</summary>
        <ol>{job.events.map((e, i) => <li key={i}><strong>{e.actor}:</strong> {e.text}</li>)}</ol>
      </details>
    </li>
  );
}

function SupplierReport({ result }: { result: LookupResult }) {
  return (
    <section className="office-repairReport" aria-label="Sourcing brief">
      <p className="office-eyebrow">{result.mode === "live" ? "LIVE · observed via TinyFish" : "SAMPLE · fixture, not observed on the live site"}</p>
      <h3>Sourcing brief · {result.supplier.name}</h3>
      <h4>Requested</h4><p>{result.partName}</p>
      <h4>Item</h4><p>{result.itemName ?? "—"} ({result.match.replace("_", " ")})</p>
      <h4>Availability</h4><p>{result.availability.replace("_", " ")}{result.availabilityText ? ` — “${result.availabilityText}”` : ""}</p>
      {result.price && <><h4>Price</h4><p>{result.price}</p></>}
      <h4>Source</h4><p><a href={result.sourceUrl} target="_blank" rel="noopener noreferrer">{result.sourceIsProductPage ? "Open product page" : "Open supplier search page"}</a></p>
      {result.candidates.length > 0 && <><h4>Possible listings</h4><ul>{result.candidates.map((c, i) => <li key={i}>{c.url ? <a href={c.url} target="_blank" rel="noopener noreferrer">{c.name}</a> : c.name}</li>)}</ul></>}
      <h4>Uncertainties</h4><ul>{result.uncertainties.map((u, i) => <li key={i}>{u}</li>)}</ul>
    </section>
  );
}

function DeskDetails({ desk, hire }: { desk: string; hire?: HireView }) {
  return <section className="office-deskDetails" aria-label="Desk details">
    <h3>{DESKS.find(item => item.desk === desk)?.label ?? "Workstation"} · {hire ? hire.departedAt ? "Vacant" : "Occupied" : "Vacant"}</h3>
    <p>CRT display · keyboard · task notebook · filing tray · desk lamp</p>
    <p>{hire ? `${hire.characterName} / ${hire.role}. ${hire.retention === "job" ? "Hired for one job; reports at reception, then leaves." : "Retained on the team; reports at reception, then returns here."}` : "Ready for a new teammate. Review skills and permissions before hiring."}</p>
  </section>;
}

function WorkerPanel({ hire, state, headingRef, reportJobId, onUpdate, onRun }: {
  hire: HireView; state: WorkplaceState; reportJobId?: string; headingRef: React.RefObject<HTMLHeadingElement | null>;
  onUpdate: (change: HireTerms) => Promise<string | null>; onRun: (next: WorkplaceState) => void;
}) {
  const jobs = state.jobs.filter(j => j.hireId === hire.id);
  const active = jobs.find(j => j.status === "working") ?? jobs.find(j => j.id === hire.activeJobId);
  const latest = reportJobId ? jobs.find(j => j.id === reportJobId) : jobs.find(j => j.report);
  const [draft, setDraft] = useState(hire.instructions);
  const [saving, setSaving] = useState(false);
  const left = hire.departedAt !== null;
  const status = left ? "Left the office" : active ? (active.status === "working" ? "Working" : "Job assigned") : latest?.report ? "Report ready" : "Ready";
  async function save(change: HireTerms) { setSaving(true); await onUpdate(change); setSaving(false); }
  return (
    <>
      <div className="office-panelHeader"><p className="office-eyebrow">WORKER PROFILE</p><h2 id="panel-title" ref={headingRef} tabIndex={-1}>{hire.role}</h2></div>
      <div className="office-panelBody">
        <div className="office-characterIdentity"><PixelCharacter sprite={hire.sprite} portrait /><div><h3>{hire.characterName}</h3><p>{hire.role}</p><ListingBadge kind={hire.listingKind} publisher={hire.publisherName} /><span className="office-status"><span /> {status}</span></div></div>
        <blockquote className="office-characterVoice">“{workerVoice(hire, active ?? jobs[0], hire.greeting)}”</blockquote>
        {latest?.report && <a className="office-viewReport" href="#worker-saved-report" onClick={event => { event.preventDefault(); const report = document.getElementById("worker-report-details") as HTMLDetailsElement | null; if (report) { report.open = true; document.getElementById("worker-saved-report")?.focus(); } }}>View report <span aria-hidden="true">↗</span></a>}
        <DeskDetails desk={hire.desk} hire={hire} />
        <h3 className="office-sectionLabel">SKILLS</h3><ul className="office-skills">{hire.skills.map(s => <li key={s}>{SKILLS[s]}</li>)}</ul>
        <dl className="office-details">
          <div><dt>Demo hourly rate</dt><dd>{formatRate(hire.hourlyRateCents)}</dd></div>
          <div><dt>Current task</dt><dd>{left ? "None · left the office" : characterTask(active ?? jobs[0])}</dd></div>
          {hire.source === "marketplace" && <div><dt>Hired</dt><dd>{left ? "Left the office" : hire.retention === "team" ? "Kept on team" : "For one job, then leaves"}</dd></div>}
        </dl>
        {hire.source === "marketplace" && !left && (hire.retention === "job"
          ? <button type="button" className="office-hireButton" disabled={saving} onClick={() => save({ retention: "team" })}>Keep {hire.characterName} on team <span aria-hidden="true">↗</span></button>
          : <button type="button" className="office-reset" disabled={saving} onClick={() => { if (window.confirm(`Release ${hire.characterName}? ${active ? "It leaves after the current job." : "It leaves the office now."} Its reports stay in workflow history.`)) void save({ retention: "job" }); }}>Release from team</button>)}
        {!left && <AgentAction hire={hire} workspaceId={state.workspaceId} busy={!!active} onRun={onRun} />}
        {hire.source === "marketplace" && <form className="office-instructions" onSubmit={e => { e.preventDefault(); void save({ instructions: draft }); }}>
          <label className="office-field">Instructions (saved with this hire)
            <textarea rows={2} maxLength={1000} value={draft} disabled={left} onChange={e => setDraft(e.target.value)} placeholder="Added to every job brief for this worker." />
          </label>
          {!left && <button type="submit" className="office-reset" disabled={saving || draft === hire.instructions}>Save instructions</button>}
        </form>}
        <details className="office-permissions"><summary className="office-sectionLabel">Permissions</summary><ul className="office-jobMeta">{hire.permissions.map(p => <li key={p}>{p}</li>)}</ul></details>
        <details className="office-hireHistory" open={left}>
          <summary className="office-sectionLabel">History in this office ({hire.history.length})</summary>
          <ol>{hire.history.map((e, i) => <li key={i} data-kind={e.kind}>{e.text}</li>)}</ol>
        </details>
        {latest && <p className="office-workflowLink"><Link href={`/workflow?workspace=${encodeURIComponent(state.workspaceId)}&job=${encodeURIComponent(latest.id)}`}>View latest job’s workflow ↗</Link></p>}
        {latest?.error && <p className="office-errorText">{latest.error.code}: {latest.error.message}</p>}
        {latest?.report && <details id="worker-report-details" className="office-reportDetails"><summary>Saved report · {latest.report.mode === "local" ? "EXECUTED LOCALLY" : latest.report.mode === "sample" ? "SAMPLE fixture" : latest.report.mode.toUpperCase()}</summary><section id="worker-saved-report" tabIndex={-1} className="office-workerReport" aria-label="Saved worker report">
          <h3>{latest.report.body.type === "camera_incident" && latest.report.body.incident.status === "open" ? "Report ready · incident still open" : "Report ready"}</h3>
          <ModeBadge mode={latest.report.mode} /><p className="office-jobMeta">{latest.report.summary}</p>
          <ReportBodyView report={latest.report} />
        </section></details>}
      </div>
    </>
  );
}

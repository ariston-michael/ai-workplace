"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import OfficeMap from "./office-map";
import InventoryReport from "./inventory-report";
import AgentAction from "./agent-action";
import PixelCharacter from "./pixel-character";
import { CHARACTERS, characterId, characterVoice, characterTask, inventoryVoice, type CharacterId } from "@/lib/workplace/characters";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import "./office.css";
import { CameraIncidentReport } from "./repair-incident";
import { SCENARIOS } from "@/lib/camera-incident";
import type { LookupResult } from "@/lib/procurement";
import {
  JOB_TYPES,
  SKILLS,
  formatCost,
  formatRate,
  type WorkerProfile,
} from "@/lib/workplace/catalog";
import type { HireView, JobStatus, JobView, ReportMode, WorkplaceState, WorkspaceSummary } from "@/lib/workplace/types";

const apiBase = (ws: string) => `/api/workspaces/${encodeURIComponent(ws)}`;

type Selection = null | "dispatcher" | { hireId: string; jobId?: string } | { desk: string };

const DESKS = [
  { desk: "workstation-01", label: "Workstation 01", className: "office-inspection" },
  { desk: "desk-02", label: "Desk 02", className: "office-openDesk" },
  { desk: "desk-03", label: "Desk 03", className: "office-deskThree" },
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

type AvatarLike = { initials: string; color: string; id?: string; profileId?: string; avatarId?: CharacterId };

function Avatar({ worker, small = false, away = false }: { worker: AvatarLike; small?: boolean; away?: boolean }) {
  return <span aria-hidden="true" className={`office-avatar office-${worker.color} ${small ? "office-smallAvatar" : ""} ${away ? "office-away" : ""}`}><PixelCharacter id={worker.avatarId ?? characterId(worker.profileId ?? worker.id ?? (worker.initials === "DI" ? "dispatcher" : "catalog_assistant"))} /></span>;
}

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
  return ws ? <OfficeView key={ws} workspaceId={ws} /> : <OpenPrimaryOffice />;
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

function OfficeView({ workspaceId }: { workspaceId: string }) {
  const base = apiBase(workspaceId);
  const [state, setState] = useState<WorkplaceState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const candidate = useSearchParams().get("candidate");
  const [selection, setSelection] = useState<Selection>(() => candidate ? { desk: "desk-02" } : null);
  const [announcement, setAnnouncement] = useState("");
  const [arrivals, setArrivals] = useState<Set<string>>(() => new Set());
  const panelHeading = useRef<HTMLHeadingElement>(null);
  const floorHeading = useRef<HTMLHeadingElement>(null);
  const focusMapOnHire = useRef(false);

  const refresh = useCallback(async () => {
    const r = await api(base);
    if (r.ok) { setState(r.state); setLoadError(null); } else setLoadError(r.error.message);
  }, [base]);

  useEffect(() => {
    let cancelled = false;
    api(base).then(r => {
      if (cancelled) return;
      if (r.ok) {
        setState(r.state);
        if (candidate) setSelection({ desk: DESKS.find(d => !r.state.team.some(h => h.desk === d.desk))?.desk ?? "desk-02" });
      } else setLoadError(r.error.message);
    });
    return () => { cancelled = true; };
  }, [base, candidate]);

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
      if (fresh) setAnnouncement(fresh.report ? `${fresh.hireRole} returned with a ${fresh.report.mode.toUpperCase()} report: ${fresh.report.summary}` : `${fresh.hireRole} could not finish: ${fresh.error?.message ?? "failed"}`);
    }
    completedRef.current = new Set(done.map(j => j.id));
  }, [state]);

  function onRequestReply(r: RequestReply) {
    if (!r.ok || r.kind !== "job") return;
    setState(r.state);
    const job = r.state.jobs.find(j => j.id === r.jobId);
    if (job && (job.status === "queued" || job.status === "working")) requestAnimationFrame(() => floorHeading.current?.focus());
    setAnnouncement(job?.status === "needs_worker" ? "Dispatcher: nobody on the team has this skill. Review the recommended hire." : `Dispatcher assigned the job to ${job?.hireRole}.`);
  }

  async function setFault(cameraFault: string) {
    const r = await api(`${base}/simulator`, { cameraFault });
    if (r.ok) { setState(r.state); setAnnouncement(`SIMULATED camera fault set: ${SCENARIOS.find(sc => sc.id === cameraFault)?.title}.`); }
    else setAnnouncement(r.error.message);
  }

  async function hire(profileId: string, jobId?: string) {
    const r = await api(`${base}/hires`, { profileId, jobId });
    if (!r.ok) { setAnnouncement(r.error.message); return; }
    const h = r.state.team.find(t => t.profileId === profileId);
    if (h && !state?.team.some(previous => previous.id === h.id)) setArrivals(previous => new Set(previous).add(h.id));
    setState(r.state);
    setAnnouncement(`${h?.role} hired and walking in to ${DESKS.find(d => d.desk === h?.desk)?.label}.${jobId ? " The original job resumed automatically." : ""}`);
    if (!jobId && h) { focusMapOnHire.current = true; setSelection({ hireId: h.id }); }
    requestAnimationFrame(() => floorHeading.current?.focus());
  }

  async function resetDemo() {
    const officeName = state?.workspace.name ?? workspaceId;
    if (!window.confirm(`Reset “${officeName}”? This deletes this office’s hires, jobs, reports and simulator settings. Other offices are not affected.`)) return;
    const r = await api(`${base}/reset`, {});
    if (r.ok) { setArrivals(new Set()); setState(r.state); setSelection(null); setAnnouncement(`${officeName} reset. Only the Quality Inspector remains on the team.`); }
    else setAnnouncement(r.error.message);
  }

  function select(next: Selection) {
    if (JSON.stringify(next) === JSON.stringify(selection)) panelHeading.current?.focus();
    else setSelection(next);
  }

  const team = state?.team ?? [];
  const hireAt = (desk: string) => team.find(h => h.desk === desk);
  const selectedHire = selection && typeof selection === "object" && "hireId" in selection ? team.find(h => h.id === selection.hireId) : undefined;
  const selectedReportId = selection && typeof selection === "object" && "hireId" in selection ? selection.jobId : undefined;
  const selectedDesk = selection && typeof selection === "object" && "desk" in selection ? selection.desk : undefined;
  const openDesks = DESKS.filter(d => !hireAt(d.desk)).length;

  return (
    <main className="office-office">
      <header className="office-header">
        <Link className="office-brand" href="/"><span className="office-logo" aria-hidden="true">a<span>i</span></span> AI Workplace</Link>
        <OfficeSwitcher current={workspaceId} currentName={state?.workspace.name} />
        <div className="office-headerBadges">
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
            <OfficeMap team={team} jobs={state?.jobs ?? []} loaded={state !== null} arrivals={arrivals}
              selectedHire={selectedHire?.id} selectedDesk={selectedDesk} dispatcherSelected={selection === null || selection === "dispatcher"}
              onWorker={(hireId, jobId) => select({ hireId, jobId })} onDesk={desk => select({ desk })} onDispatcher={() => select("dispatcher")} />
            <div className="office-floorFooter"><span aria-hidden="true">↖</span> Empty desk: hire a worker. Paper badge: a report is ready for pickup at reception.</div>
          </section>

          <aside id="office-panel" className="office-panel" aria-labelledby="panel-title">
            {selectedDesk && state ? (
              <>
                <div className="office-panelHeader"><p className="office-eyebrow">FIND YOUR NEXT TEAMMATE</p><h2 id="panel-title" ref={panelHeading} tabIndex={-1}>The marketplace</h2></div>
                <div className="office-panelBody">
                  <p className="office-workflowLink"><Link href="/marketplace">Browse or publish community agents ↗</Link></p>
                  <p className="office-muted">Hire a worker for {DESKS.find(d => d.desk === selectedDesk)?.label}. Hiring is saved and later jobs that need the worker’s skill go to it.</p>
                  {[...state.marketplace].sort((a, b) => Number(b.id === candidate) - Number(a.id === candidate)).map(p => <CandidateCard key={p.id} profile={p} hired={p.hired} onHire={() => hire(p.id)} />)}
                  <p className="office-finePrint">Demo hourly rates. Demo charges are calculated per second of run time and are not billed.</p>
                </div>
              </>
            ) : selectedHire && state ? (
              <WorkerPanel key={`${selectedHire.id}:${selectedReportId ?? ""}`} hire={selectedHire} state={state} onRun={next => { setState(next); setSelection({ hireId: selectedHire.id }); setAnnouncement("Inventory audit assigned. Its report will appear when execution finishes."); }} reportJobId={selectedReportId} headingRef={panelHeading} />
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
              <RequestForm base={base} onReply={onRequestReply} disabled={!state} />
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
            : <ol className="office-jobList">{state.jobs.map(job => <JobCard key={job.id} job={job} state={state} onHire={hire} />)}</ol>}
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

type RequestReply =
  | { ok: true; kind: "job"; jobId: string; understood: string; state: WorkplaceState }
  | { ok: true; kind: "follow_up"; question: string; pending: { transcript: { actor: "You" | "Dispatcher"; text: string }[] } }
  | { ok: true; kind: "unsupported"; message: string }
  | { ok: false; error: { code: string; message: string } };

const EXAMPLES = [
  "Find a Raspberry Pi 5 4GB on Adafruit",
  "The camera feed at Packing Station 1 stopped",
  "I need a replacement part",
];

function RequestForm({ base, onReply, disabled }: { base: string; onReply: (reply: RequestReply) => void; disabled: boolean }) {
  const [text, setText] = useState("");
  const [pending, setPending] = useState<Extract<RequestReply, { kind: "follow_up" }>["pending"] | null>(null);
  const [reply, setReply] = useState<{ tone: "info" | "unsupported" | "error"; text: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // One id per conversation, so a retried submit cannot create a duplicate job.
  const requestId = useRef<string | null>(null);

  function startOver() {
    setPending(null);
    setReply(null);
    setText("");
    requestId.current = null;
  }

  async function handle(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || !text.trim()) return;
    setSubmitting(true);
    requestId.current ??= newRequestId();
    let r: RequestReply;
    try {
      const res = await fetch(`${base}/jobs`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientRequestId: requestId.current, request: text, pending: pending ?? undefined }),
      });
      r = await res.json();
    } catch {
      r = { ok: false, error: { code: "NETWORK", message: "Could not reach the local task service." } };
    }
    setSubmitting(false);
    onReply(r);
    if (!r.ok) { setReply({ tone: "error", text: r.error.message }); return; }
    if (r.kind === "follow_up") { setPending(r.pending); setReply(null); setText(""); return; }
    if (r.kind === "unsupported") { setPending(null); setReply({ tone: "unsupported", text: r.message }); requestId.current = null; return; }
    setPending(null);
    setText("");
    requestId.current = null;
    setReply({ tone: "info", text: `Understood as ${r.understood}` });
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
        <textarea name="request" rows={asking ? 2 : 3} value={text} maxLength={500} required
          aria-describedby={asking ? "dispatcher-question" : undefined}
          placeholder={asking ? "Answer the Dispatcher’s question" : "e.g. Find a Raspberry Pi 5 4GB on Adafruit"}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} />
      </label>
      {asking && <p id="dispatcher-question" className="office-visuallyHidden">{lastQuestion}</p>}
      <div className="office-formActions">
        <button className="office-hireButton" type="submit" disabled={disabled || submitting || !text.trim()}>
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
      <p className="office-finePrint">The Dispatcher matches your request to a skill. Supplier lookups use the SAMPLE fixture unless the server runs with PROCUREMENT_MODE=live.</p>
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

function CandidateCard({ profile, hired, onHire, highlightSkill, cta }: { profile: WorkerProfile; hired: boolean; onHire: () => void; highlightSkill?: string; cta?: string }) {
  return (
    <article className="office-candidate">
      <div className="office-candidateHeading"><Avatar worker={profile} /><div><h3>{profile.role}</h3><span className="office-rate">{formatRate(profile.hourlyRateCents).replace(" / hour", "")}<small> / hour</small></span></div></div>
      <p>{profile.specialty}</p>
      {profile.listing && <p className="office-candidateMeta">{profile.listing.official ? "✓ Official · AI Workplace" : `Community agent · by ${profile.listing.creatorName}`}</p>}
      {profile.listing?.configuration && <p className="office-candidateMeta"><strong>Supported action:</strong> Inventory CSV audit · executed locally. Low-stock minimum {profile.listing.configuration.minimumQuantity}; restock target {profile.listing.configuration.targetQuantity}.</p>}
      <ul className="office-skills" aria-label="Skills">{profile.skills.map(s => <li key={s} className={s === highlightSkill ? "office-skillMatch" : ""}>{SKILLS[s]}{s === highlightSkill ? " ✓" : ""}</li>)}</ul>
      <p className="office-candidateMeta"><strong>Sample work:</strong> {profile.sampleWork}</p>
      <p className="office-candidateMeta"><strong>Permissions:</strong> {profile.permissions.join("; ")}.</p>
      <button className="office-hireButton" type="button" disabled={hired} onClick={onHire}>{hired ? "Already on your team" : cta ?? `Hire ${profile.role}`} <span aria-hidden="true">↗</span></button>
    </article>
  );
}

function JobCard({ job, state, onHire }: { job: JobView; state: WorkplaceState; onHire: (profileId: string, jobId: string) => void }) {
  const recommended = job.status === "needs_worker" ? state.marketplace.find(p => p.id === job.recommendedProfileId) : undefined;
  const posting = JOB_TYPES[job.type].posting;
  return (
    <li className={`office-jobCard office-job-${job.status}`} data-job-id={job.id}>
      <div className="office-jobHead">
        <strong>{job.title}</strong>
        <span className={`office-jobStatus office-jobStatus-${job.status}`}>{STATUS_LABEL[job.status]}</span>
        {job.report && <ModeBadge mode={job.report.mode} />}
      </div>
      {job.input.request && <p className="office-jobRequest">“{job.input.request}”</p>}
      <p className="office-jobMeta">
        Needs {SKILLS[job.requiredSkill]} · {job.hireRole ? <>Assigned to <strong>{job.hireRole}</strong></> : "Unassigned"}
      </p>

      {recommended && (
        <div className="office-recommendation" aria-label="Dispatcher recommendation">
          <p className="office-eyebrow">DISPATCHER RECOMMENDS A HIRE</p>
          <p className="office-jobMeta">Nobody on your team has <strong>{SKILLS[job.requiredSkill]}</strong>. Job posting: {posting.deliverable} Sources: {posting.allowedSources} Needs approval: {posting.needsApproval}</p>
          <CandidateCard profile={recommended} hired={recommended.hired} highlightSkill={job.requiredSkill}
            cta={`Approve hire at ${formatRate(recommended.hourlyRateCents)} and resume job`} onHire={() => onHire(recommended.id, job.id)} />
        </div>
      )}
      {job.status === "needs_worker" && !recommended && <p className="office-errorText">No marketplace worker has this skill yet.</p>}

      {(job.status === "queued" || job.status === "working") && <p className="office-jobMeta" role="status">{job.status === "working" ? `${job.hireRole} is working on it…` : `${job.hireRole} is about to start.`}</p>}

      {job.status === "failed" && job.error && <p className="office-errorText">{job.error.code}: {job.error.message}</p>}

      {job.report && (
        <div className="office-reportSummary">
          <p><strong>{job.report.summary}</strong></p>
          <p className="office-jobMeta">Runtime {(job.report.runtimeMs / 1000).toFixed(1)}s · Demo cost {job.report.demoCostCents === null ? "not billed (staff)" : `${formatCost(job.report.demoCostCents)} at ${formatRate(job.report.hourlyRateCents)}`}</p>
          <details>
            <summary>Open report</summary>
            {job.report.body.type === "inventory_audit" ? <InventoryReport result={job.report.body.result} /> : job.report.body.type === "supplier_lookup" ? <SupplierReport result={job.report.body.result} /> : <>
              {job.report.body.simulatorFault && <p className="office-jobMeta office-simNote">SIMULATED fault from simulator controls (not shown to the Inspector): {SCENARIOS.find(sc => sc.id === (job.report!.body as { simulatorFault?: string }).simulatorFault)?.title}</p>}
              <CameraIncidentReport incident={job.report.body.incident} />
            </>}
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

function WorkerPanel({ hire, state, headingRef, reportJobId, onRun }: { onRun: (state: WorkplaceState) => void; hire: HireView; state: WorkplaceState; reportJobId?: string; headingRef: React.RefObject<HTMLHeadingElement | null> }) {
  const jobs = state.jobs.filter(j => j.hireId === hire.id);
  const active = jobs.find(j => j.status === "working") ?? jobs.find(j => j.id === hire.activeJobId);
  const latest = reportJobId ? jobs.find(j => j.id === reportJobId) : jobs.find(j => j.report);
  const id = hire.avatarId ?? characterId(hire.profileId);
  const character = CHARACTERS[id];
  return (
    <>
      <div className="office-panelHeader"><p className="office-eyebrow">WORKER PROFILE</p><h2 id="panel-title" ref={headingRef} tabIndex={-1}>{hire.role}</h2></div>
      <div className="office-panelBody">
        <div className="office-characterIdentity"><PixelCharacter id={id} portrait /><div><h3>{hire.listing?.publisherKind === "community" ? hire.role : character.name}</h3><p>{hire.role}</p><span className="office-status"><span /> {active ? (active.status === "working" ? "Working" : "Job assigned") : latest?.report ? "Report ready" : "Ready"}</span></div></div>
        <blockquote className="office-characterVoice">“{hire.listing?.publisherKind === "community" ? inventoryVoice(active ?? jobs[0]) : characterVoice(id, active ?? jobs[0])}”</blockquote>
        {latest?.report && <a className="office-viewReport" href="#worker-saved-report" onClick={event => { event.preventDefault(); const report = document.getElementById("worker-report-details") as HTMLDetailsElement | null; if (report) { report.open = true; document.getElementById("worker-saved-report")?.focus(); } }}>View report <span aria-hidden="true">↗</span></a>}
        <h3 className="office-sectionLabel">SKILLS</h3><ul className="office-skills">{hire.skills.map(s => <li key={s}>{SKILLS[s]}</li>)}</ul>
        <dl className="office-details">
          <div><dt>Demo hourly rate</dt><dd>{formatRate(hire.hourlyRateCents)}</dd></div>
          <div><dt>Current task</dt><dd>{characterTask(active ?? jobs[0])}</dd></div>
        </dl>
        {hire.listing && <p className="office-finePrint">{hire.listing.official ? "✓ Official · AI Workplace" : `Community agent by ${hire.listing.creatorName}`}</p>}
        {hire.permissions && <details><summary className="office-sectionLabel">Permissions</summary><ul className="office-jobMeta">{hire.permissions.map(p => <li key={p}>{p}</li>)}</ul></details>}
        <AgentAction hire={hire} workspaceId={state.workspaceId} busy={!!active} onRun={onRun} />
        {latest && <p className="office-workflowLink"><Link href={`/workflow?workspace=${encodeURIComponent(state.workspaceId)}&job=${encodeURIComponent(latest.id)}`}>View latest job’s workflow ↗</Link></p>}
        {latest?.error && <p className="office-errorText">{latest.error.code}: {latest.error.message}</p>}
        {latest?.report && <details id="worker-report-details" className="office-reportDetails"><summary>Saved report · {latest.report.mode === "local" ? "EXECUTED LOCALLY" : latest.report.mode === "sample" ? "SAMPLE fixture" : latest.report.mode.toUpperCase()}</summary><section id="worker-saved-report" tabIndex={-1} className="office-workerReport" aria-label="Saved worker report">
          <h3>{latest.report.body.type === "camera_incident" && latest.report.body.incident.status === "open" ? "Report ready · incident still open" : "Report ready"}</h3>
          <ModeBadge mode={latest.report.mode} /><p className="office-jobMeta">{latest.report.summary}</p>
          {latest.report.body.type === "inventory_audit" ? <InventoryReport result={latest.report.body.result} /> : latest.report.body.type === "supplier_lookup" ? <SupplierReport result={latest.report.body.result} /> : <CameraIncidentReport incident={latest.report.body.incident} />}
        </section></details>}
      </div>
    </>
  );
}

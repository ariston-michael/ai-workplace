"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { workerMovement } from "@/lib/workplace/movement";
import "./office.css";
import { CameraIncidentReport } from "./repair-incident";
import { SCENARIOS } from "@/lib/camera-incident";
import type { LookupResult } from "@/lib/procurement";
import {
  DISPATCHER,
  JOB_TYPES,
  SKILLS,
  formatCost,
  formatRate,
  type WorkerProfile,
} from "@/lib/workplace/catalog";
import type { HireView, JobStatus, JobView, ReportMode, WorkplaceState } from "@/lib/workplace/types";

type Selection = null | "dispatcher" | { hireId: string } | { desk: string };

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

type AvatarLike = { initials: string; color: string };

function Avatar({ worker, small = false, away = false }: { worker: AvatarLike; small?: boolean; away?: boolean }) {
  return <span aria-hidden="true" className={`office-avatar office-${worker.color} ${small ? "office-smallAvatar" : ""} ${away ? "office-away" : ""}`}>{worker.initials}</span>;
}

function ModeBadge({ mode }: { mode: ReportMode }) {
  const text = mode === "live" ? "LIVE" : mode === "sample" ? "SAMPLE · fixture" : "SIMULATED";
  return <span className={`office-modeBadge office-mode-${mode}`}>{text}</span>;
}

function Station({ worker, station, label, selected, onClick, status, away, hideWorker }: {
  worker?: AvatarLike & { role: string }; station: string; label: string; selected: boolean; onClick: () => void; status?: string; away?: boolean; hideWorker?: boolean;
}) {
  return (
    <button type="button" className={`office-station ${station} ${selected ? "office-selected" : ""} ${!worker ? "office-vacant" : ""}`}
      onClick={onClick} aria-label={worker ? `${label}: ${worker.role}${status ? `, ${status}` : ""}. View role and status` : `${label}, empty desk: open marketplace`}
      aria-pressed={selected} aria-controls="office-panel">
      <span className="office-stationArt" aria-hidden="true">
        <span className="office-chair" />
        {worker && !hideWorker && <Avatar key={worker.initials} worker={worker} small away={away} />}
        <span className="office-desk"><span className="office-monitor" /><span className="office-keyboard" /><span className="office-notebook" /><span className="office-cup" /></span>
        {!worker && <span className="office-add">+</span>}
      </span>
      <span className="office-stationLabel"><span>{worker?.role ?? "Your next teammate"}</span><small>{worker ? `${label}${status ? ` · ${status}` : ""}` : `${label} · hire a worker`}</small></span>
    </button>
  );
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

export default function Office() {
  const [state, setState] = useState<WorkplaceState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [announcement, setAnnouncement] = useState("");
  const panelHeading = useRef<HTMLHeadingElement>(null);

  const refresh = useCallback(async () => {
    const r = await api("/api/workplace");
    if (r.ok) { setState(r.state); setLoadError(null); } else setLoadError(r.error.message);
  }, []);

  useEffect(() => {
    let cancelled = false;
    api("/api/workplace").then(r => {
      if (cancelled) return;
      if (r.ok) setState(r.state); else setLoadError(r.error.message);
    });
    return () => { cancelled = true; };
  }, []);

  // Poll while any job is assigned or running.
  const busy = state?.jobs.some(j => j.status === "queued" || j.status === "working") ?? false;
  useEffect(() => {
    if (!busy) return;
    const id = setInterval(refresh, 1000);
    return () => clearInterval(id);
  }, [busy, refresh]);

  useEffect(() => {
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
    setAnnouncement(job?.status === "needs_worker" ? "Dispatcher: nobody on the team has this skill. Review the recommended hire." : `Dispatcher assigned the job to ${job?.hireRole}.`);
  }

  async function setFault(cameraFault: string) {
    const r = await api("/api/workplace/simulator", { cameraFault });
    if (r.ok) { setState(r.state); setAnnouncement(`SIMULATED camera fault set: ${SCENARIOS.find(sc => sc.id === cameraFault)?.title}.`); }
    else setAnnouncement(r.error.message);
  }

  async function hire(profileId: string, jobId?: string) {
    const r = await api("/api/workplace/hires", { profileId, jobId });
    if (!r.ok) { setAnnouncement(r.error.message); return; }
    setState(r.state);
    const h = r.state.team.find(t => t.profileId === profileId);
    setAnnouncement(`${h?.role} hired and seated at ${DESKS.find(d => d.desk === h?.desk)?.label}.${jobId ? " The original job resumed automatically." : ""}`);
    if (!jobId && h) setSelection({ hireId: h.id });
  }

  async function resetDemo() {
    if (!window.confirm("Reset the demo? This deletes saved hires, jobs and reports.")) return;
    const r = await api("/api/workplace/reset", {});
    if (r.ok) { setState(r.state); setSelection(null); setAnnouncement("Demo reset. Only the Quality Inspector remains on the team."); }
  }

  function select(next: Selection) {
    if (JSON.stringify(next) === JSON.stringify(selection)) panelHeading.current?.focus();
    else setSelection(next);
  }

  const team = state?.team ?? [];
  const hireAt = (desk: string) => team.find(h => h.desk === desk);
  const jobOf = (h: HireView) => state?.jobs.find(j => j.id === h.activeJobId);
  const selectedHire = selection && typeof selection === "object" && "hireId" in selection ? team.find(h => h.id === selection.hireId) : undefined;
  const selectedDesk = selection && typeof selection === "object" && "desk" in selection ? selection.desk : undefined;
  const openDesks = DESKS.filter(d => !hireAt(d.desk)).length;

  return (
    <main className="office-office">
      <header className="office-header">
        <Link className="office-brand" href="/"><span className="office-logo" aria-hidden="true">a<span>i</span></span> AI Workplace</Link>
        <div className="office-headerBadges">
          {state && (state.procurementMode === "live"
            ? <span className="office-demoBadge office-liveBadge"><span /> PROCUREMENT: LIVE TINYFISH</span>
            : <span className="office-demoBadge office-sampleBadge"><span /> PROCUREMENT: SAMPLE FIXTURE · 0 CREDITS</span>)}
          <span className="office-demoBadge"><span /> LOCAL DEMO · SAVED</span>
        </div>
      </header>

      <div className="office-workspace">
        <div className="office-pageHeading">
          <div><p className="office-eyebrow">WORKSPACE / OFFICE 01</p><h1>A little space. A capable team.</h1><p>Give the Dispatcher a job. It checks your team’s skills, assigns a qualified worker, or recommends a hire.</p></div>
          <Link className="office-reset" href="/">← Workspaces</Link>
        </div>

        {loadError && <p className="office-errorText" role="alert">{loadError}</p>}

        <div className="office-layout">
          <section className="office-officeCard" aria-labelledby="floor-title">
            <div className="office-floorHeader"><div><span className="office-liveDot" /><h2 id="floor-title">Your office</h2></div><span>{team.length} {team.length === 1 ? "worker" : "workers"} + Dispatcher <span className="office-separator">/</span> {openDesks} open {openDesks === 1 ? "desk" : "desks"}</span></div>
            <div className="office-floor">
              <div className="office-window" aria-hidden="true"><i /><i /><i /></div>
              <div className="office-plant office-plantOne" aria-hidden="true">✦</div>
              <div className="office-plant office-plantTwo" aria-hidden="true">✦</div>
              <span className="office-roomLabel">THE WORKROOM</span>
              <div className="office-rug" aria-hidden="true" />
              {DESKS.map(d => {
                const h = hireAt(d.desk);
                const active = h ? jobOf(h) : undefined;
                const status = active ? (active.status === "working" ? "Out on a job" : "Job assigned") : h ? "Ready" : undefined;
                return <Station key={d.desk} worker={h} station={d.className} label={d.label} status={status} hideWorker
                  selected={h ? selectedHire?.id === h.id : selectedDesk === d.desk}
                  onClick={() => select(h ? { hireId: h.id } : { desk: d.desk })} />;
              })}
              {team.map(hire => <WorkerMarker key={hire.id} hire={hire} jobs={state?.jobs ?? []} onSelect={() => select({ hireId: hire.id })} />)}
              <div className="office-divider" aria-hidden="true" />
              <span className="office-receptionLabel">RECEPTION</span>
              <Station worker={DISPATCHER} station="office-reception" label="Reception" status={state?.jobs.some(j => j.status === "needs_worker") ? "Waiting for your hire approval" : undefined}
                selected={selection === "dispatcher" || selection === null} onClick={() => select("dispatcher")} />
              <span className="office-door" aria-hidden="true" />
              <span className="office-entry" aria-hidden="true">WELCOME IN ↑</span>
            </div>
            <div className="office-floorFooter"><span aria-hidden="true">↖</span> Select a desk to meet a worker or an empty desk to open the marketplace.</div>
          </section>

          <aside id="office-panel" className="office-panel" aria-labelledby="panel-title">
            {selectedDesk && state ? (
              <>
                <div className="office-panelHeader"><p className="office-eyebrow">FIND YOUR NEXT TEAMMATE</p><h2 id="panel-title" ref={panelHeading} tabIndex={-1}>The marketplace</h2></div>
                <div className="office-panelBody">
                  <p className="office-muted">Hire a worker for {DESKS.find(d => d.desk === selectedDesk)?.label}. Hiring is saved and later jobs that need the worker’s skill go to it.</p>
                  {state.marketplace.map(p => <CandidateCard key={p.id} profile={p} hired={p.hired} onHire={() => hire(p.id)} />)}
                  <p className="office-finePrint">Demo hourly rates. Demo charges are calculated per second of run time and are not billed.</p>
                </div>
              </>
            ) : selectedHire && state ? (
              <WorkerPanel hire={selectedHire} state={state} headingRef={panelHeading} />
            ) : (selection === "dispatcher" || selection === null) ? (
              <>
                <div className="office-panelHeader"><p className="office-eyebrow">WORKER DETAILS</p><h2 id="panel-title" ref={panelHeading} tabIndex={-1}>Dispatcher</h2></div>
                <div className="office-panelBody">
                  <div className="office-profile"><Avatar worker={DISPATCHER} /><span className="office-status"><span /> Reception · always on</span></div>
                  <p className="office-description">{DISPATCHER.specialty}</p>
                  <RequestForm onReply={onRequestReply} disabled={!state} />
                  <h3 className="office-sectionLabel">RECENT DECISIONS</h3>
                  <ul className="office-eventList">
                    {(state?.jobs ?? []).flatMap(j => j.events.filter(e => e.actor === "Dispatcher").map(e => ({ ...e, job: j.title }))).sort((a, b) => b.at - a.at).slice(0, 5)
                      .map((e, i) => <li key={i}><strong>{e.job}</strong>{e.text}</li>)}
                  </ul>
                  {!state?.jobs.length && <p className="office-muted">No decisions yet.</p>}
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
          </aside>
        </div>
        <section className="office-incident office-jobDesk" aria-labelledby="jobs-title">
          <div className="office-savedJobsHeading"><h2 id="jobs-title" className="office-jobsTitle">Jobs and reports</h2><Link href={`/workflow?workspace=${encodeURIComponent(state?.workspaceId ?? "demo")}`}>View workflow history ↗</Link></div>
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
    </main>
  );
}

function WorkerMarker({ hire, jobs, onSelect }: { hire: HireView; jobs: JobView[]; onSelect: () => void }) {
  const movement = workerMovement(hire, jobs);
  const observed = useRef<{ initialized: boolean; key: string | null }>({ initialized: false, key: null });
  const [returnEvent, setReturnEvent] = useState<string | null>(null);
  useEffect(() => {
    const isNew = observed.current.initialized && observed.current.key !== movement.eventKey;
    observed.current = { initialized: true, key: movement.eventKey };
    if (!isNew || (movement.kind !== "returned" && movement.kind !== "failed")) return;
    const frame = requestAnimationFrame(() => setReturnEvent(movement.eventKey));
    return () => cancelAnimationFrame(frame);
  }, [movement.eventKey, movement.kind]);
  const style = {
    "--desk-x": hire.desk === "workstation-01" ? "27%" : "73%",
    "--desk-y": hire.desk === "desk-03" ? "calc(100% - 150px)" : "var(--office-chair-y, 120px)",
    "--task-x": hire.desk === "workstation-01" ? "40%" : "64%",
    "--task-y": "54%",
  } as CSSProperties;
  const returning = returnEvent !== null && returnEvent === movement.eventKey && movement.kind !== "working";
  return <button type="button" style={style} onClick={onSelect}
    className={`office-workerMarker ${movement.kind === "working" ? "office-markerWorking" : ""} ${returning ? "office-markerReturned" : ""}`}
    data-movement={movement.kind} aria-label={`${hire.role}: ${movement.kind === "working" ? "working on a job" : "at their desk"}. View worker`}>
    <Avatar worker={hire} small />
    {movement.kind === "working" && <span className="office-markerCaption">Working</span>}
  </button>;
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

function RequestForm({ onReply, disabled }: { onReply: (reply: RequestReply) => void; disabled: boolean }) {
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
      const res = await fetch("/api/workplace/jobs", {
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
            {job.report.body.type === "supplier_lookup" ? <SupplierReport result={job.report.body.result} /> : <>
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

function WorkerPanel({ hire, state, headingRef }: { hire: HireView; state: WorkplaceState; headingRef: React.RefObject<HTMLHeadingElement | null> }) {
  const jobs = state.jobs.filter(j => j.hireId === hire.id);
  const active = jobs.find(j => j.id === hire.activeJobId);
  const latest = jobs.find(j => j.report);
  return (
    <>
      <div className="office-panelHeader"><p className="office-eyebrow">WORKER DETAILS</p><h2 id="panel-title" ref={headingRef} tabIndex={-1}>{hire.role}</h2></div>
      <div className="office-panelBody">
        <div className="office-profile"><Avatar worker={hire} /><span className="office-status"><span /> {active ? (active.status === "working" ? "Out on a job" : "Job assigned") : "Ready"}</span></div>
        <p className="office-description">{hire.specialty}</p>
        <h3 className="office-sectionLabel">SKILLS</h3><ul className="office-skills">{hire.skills.map(s => <li key={s}>{SKILLS[s]}</li>)}</ul>
        <dl className="office-details">
          <div><dt>Station</dt><dd>{DESKS.find(d => d.desk === hire.desk)?.label}</dd></div>
          <div><dt>Hired</dt><dd>{hire.source === "staff" ? "Built-in staff" : "From marketplace"}</dd></div>
          <div><dt>Demo hourly rate</dt><dd>{formatRate(hire.hourlyRateCents)}</dd></div>
          <div><dt>Jobs completed</dt><dd>{hire.completedJobs}</dd></div>
          <div><dt>Current job</dt><dd>{active?.title ?? "None"}</dd></div>
        </dl>
        {latest && <p className="office-workflowLink"><Link href={`/workflow?workspace=${encodeURIComponent(state.workspaceId)}&job=${encodeURIComponent(latest.id)}`}>View latest job’s workflow ↗</Link></p>}
        {latest?.report && <div className="office-note"><span aria-hidden="true">↳</span><p>Latest report ({latest.report.mode.toUpperCase()}): {latest.report.summary}</p></div>}
      </div>
    </>
  );
}

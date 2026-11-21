"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import "./office.css";
import { CameraIncidentReport } from "./repair-incident";
import { SCENARIOS } from "@/lib/camera-incident";
import type { LookupResult, PublicSupplier } from "@/lib/procurement";
import {
  DISPATCHER,
  JOB_TYPES,
  SKILLS,
  formatCost,
  formatRate,
  type JobType,
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

function Station({ worker, station, label, selected, onClick, status, away }: {
  worker?: AvatarLike & { role: string }; station: string; label: string; selected: boolean; onClick: () => void; status?: string; away?: boolean;
}) {
  return (
    <button type="button" className={`office-station ${station} ${selected ? "office-selected" : ""} ${!worker ? "office-vacant" : ""}`}
      onClick={onClick} aria-label={worker ? `${label}: ${worker.role}${status ? `, ${status}` : ""}. View role and status` : `${label}, empty desk: open marketplace`}
      aria-pressed={selected} aria-controls="office-panel">
      <span className="office-stationArt" aria-hidden="true">
        <span className="office-chair" />
        {worker && <Avatar key={worker.initials} worker={worker} small away={away} />}
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

export default function Office({ suppliers }: { suppliers: PublicSupplier[] }) {
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

  async function submitJob(type: JobType, input: unknown, clientRequestId: string): Promise<string | null> {
    const r = await api("/api/workplace/jobs", { clientRequestId, type, input });
    if (!r.ok) return r.error.message;
    setState(r.state);
    const job = r.state.jobs[0];
    setAnnouncement(job?.status === "needs_worker" ? "Dispatcher: nobody on the team has this skill. Review the recommended hire." : `Dispatcher assigned the job to ${job?.hireRole}.`);
    return null;
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
        <a className="office-brand" href="/office"><span className="office-logo" aria-hidden="true">a<span>i</span></span> AI Workplace</a>
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
          <button className="office-reset" type="button" onClick={resetDemo}>Reset demo <span aria-hidden="true">↺</span></button>
        </div>

        {loadError && <p className="office-errorText" role="alert">{loadError}</p>}

        <section className="office-incident office-jobDesk" aria-labelledby="jobs-title">
          <div className="office-jobDeskGrid">
            <JobForm suppliers={suppliers} onSubmit={submitJob} disabled={!state} />
            <div>
              <h2 id="jobs-title" className="office-jobsTitle">Jobs and reports</h2>
              {!state ? <p className="office-muted">Loading saved workspace…</p>
                : state.jobs.length === 0 ? <p className="office-muted">No jobs yet. Submit one to the Dispatcher.</p>
                : <ol className="office-jobList">{state.jobs.map(job => <JobCard key={job.id} job={job} state={state} onHire={hire} />)}</ol>}
            </div>
          </div>
        </section>

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
                return <Station key={d.desk} worker={h} station={d.className} label={d.label} status={status} away={active?.status === "working"}
                  selected={h ? selectedHire?.id === h.id : selectedDesk === d.desk}
                  onClick={() => select(h ? { hireId: h.id } : { desk: d.desk })} />;
              })}
              <div className="office-divider" aria-hidden="true" />
              <span className="office-receptionLabel">RECEPTION</span>
              <Station worker={DISPATCHER} station="office-reception" label="Reception" status={state?.jobs.some(j => j.status === "needs_worker") ? "Waiting for your hire approval" : undefined}
                selected={selection === "dispatcher"} onClick={() => select("dispatcher")} />
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
            ) : selection === "dispatcher" ? (
              <>
                <div className="office-panelHeader"><p className="office-eyebrow">WORKER DETAILS</p><h2 id="panel-title" ref={panelHeading} tabIndex={-1}>Dispatcher</h2></div>
                <div className="office-panelBody">
                  <div className="office-profile"><Avatar worker={DISPATCHER} /><span className="office-status"><span /> Reception · always on</span></div>
                  <p className="office-description">{DISPATCHER.specialty}</p>
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
        <p className="office-announcement" role="status">{announcement}</p>
        <footer className="office-pageFooter"><span>Built around the work. And the people directing it.</span><span>Team, jobs and reports are saved locally in SQLite.</span></footer>
      </div>
    </main>
  );
}

function JobForm({ suppliers, onSubmit, disabled }: { suppliers: PublicSupplier[]; onSubmit: (type: JobType, input: unknown, clientRequestId: string) => Promise<string | null>; disabled: boolean }) {
  const [type, setType] = useState<JobType>("supplier_lookup");
  const [partName, setPartName] = useState("");
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? "");
  const [scenarioId, setScenarioId] = useState(SCENARIOS[0].id);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One id per draft, so a retried submit cannot create a duplicate job.
  const requestId = useRef<string | null>(null);

  async function handle(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    requestId.current ??= newRequestId();
    const input = type === "supplier_lookup" ? { partName, supplierId } : { scenarioId };
    const err = await onSubmit(type, input, requestId.current);
    setSubmitting(false);
    if (err) { setError(err); return; }
    requestId.current = null;
    if (type === "supplier_lookup") setPartName("");
  }

  const changeDraft = () => { requestId.current = null; };

  return (
    <form className="office-jobForm" onSubmit={handle} aria-labelledby="job-form-title">
      <p className="office-eyebrow">RECEPTION · DISPATCHER</p>
      <h2 id="job-form-title">Give the Dispatcher a job</h2>
      <fieldset className="office-jobTypes">
        <legend>Job type</legend>
        {(Object.keys(JOB_TYPES) as JobType[]).map(t => (
          <label key={t} className="office-jobType">
            <input type="radio" name="jobType" value={t} checked={type === t} onChange={() => { setType(t); changeDraft(); }} />
            <span><strong>{JOB_TYPES[t].label}</strong><small>Needs: {SKILLS[JOB_TYPES[t].requiredSkill]}</small></span>
          </label>
        ))}
      </fieldset>
      {type === "supplier_lookup" ? (
        <>
          <label className="office-field">Part name
            <input name="partName" value={partName} onChange={e => { setPartName(e.target.value); changeDraft(); }} placeholder="e.g. Raspberry Pi 5 4GB" required minLength={2} maxLength={100} />
          </label>
          <label className="office-field">Supplier
            <select name="supplierId" value={supplierId} onChange={e => { setSupplierId(e.target.value); changeDraft(); }}>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
        </>
      ) : (
        <label className="office-field">SIMULATED case
          <select name="scenarioId" value={scenarioId} onChange={e => { setScenarioId(e.target.value); changeDraft(); }}>
            {SCENARIOS.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
          </select>
        </label>
      )}
      <button className="office-hireButton" type="submit" disabled={disabled || submitting}>{submitting ? "Sending to the Dispatcher…" : "Submit job"} <span aria-hidden="true">↗</span></button>
      {error && <p className="office-errorText" role="alert">{error}</p>}
      <p className="office-finePrint">{type === "camera_incident" ? "Camera observations are SIMULATED. No hardware is contacted." : "Supplier lookups use the SAMPLE fixture unless the server runs with PROCUREMENT_MODE=live."}</p>
    </form>
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
            {job.report.body.type === "supplier_lookup" ? <SupplierReport result={job.report.body.result} /> : <CameraIncidentReport incident={job.report.body.incident} />}
          </details>
        </div>
      )}

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
        {latest?.report && <div className="office-note"><span aria-hidden="true">↳</span><p>Latest report ({latest.report.mode.toUpperCase()}): {latest.report.summary}</p></div>}
      </div>
    </>
  );
}

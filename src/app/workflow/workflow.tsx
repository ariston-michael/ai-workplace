"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import BrandMark from "../brand-mark";
import InventoryReport from "../office/inventory-report";
import { ACTION_LABEL } from "@/lib/camera-incident";
import { SKILLS } from "@/lib/workplace/catalog";
import type { JobView, ReportMode } from "@/lib/workplace/types";
import "./workflow.css";

const statusLabels = {
  needs_worker: "Needs a worker", queued: "Queued", working: "Working", completed: "Report ready", failed: "Failed",
};

function Mode({ mode }: { mode: ReportMode }) {
  return <span className={`workflow-mode workflow-mode-${mode}`}>{mode === "local" ? "EXECUTED LOCALLY" : mode === "sample" ? "SAMPLE · FIXTURE" : mode === "simulated" ? "SIMULATED" : "LIVE"}</span>;
}

const savedTime = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Toronto", year: "numeric", month: "short", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", timeZoneName: "short",
});

function timestamp(at: number) {
  return savedTime.format(at);
}

function Source({ href, children }: { href: string; children: React.ReactNode }) {
  // Saved text stays visible even when it cannot safely become a browser link.
  const safe = /^https?:\/\//i.test(href);
  return safe ? <a href={href} target="_blank" rel="noopener noreferrer">{children} ↗</a> : <span>{children}: {href}</span>;
}

function WorkerEvidence({ job }: { job: JobView }) {
  const report = job.report;
  if (!report) return <p className="workflow-muted">No worker report is saved for this job.</p>;
  if (report.body.type === "supplier_lookup") {
    const result = report.body.result;
    return <>
      <Mode mode={result.mode} />
      {result.mode === "sample" && <p className="workflow-callout">Fixture data · these findings were not observed on a live supplier site.</p>}
      <dl className="workflow-facts">
        {result.itemName !== null && <div><dt>Item</dt><dd>{result.itemName}</dd></div>}
        <div><dt>Match</dt><dd>{result.match.replaceAll("_", " ")}</dd></div>
        <div><dt>Availability</dt><dd>{result.availability.replaceAll("_", " ")}{result.availabilityText && <> · “{result.availabilityText}”</>}</dd></div>
        {result.price !== null && <div><dt>Price</dt><dd>{result.price}</dd></div>}
        {result.sku !== null && <div><dt>SKU</dt><dd>{result.sku}</dd></div>}
        <div><dt>Source</dt><dd><Source href={result.sourceUrl}>{result.sourceIsProductPage ? "Product page" : "Supplier search page"}</Source></dd></div>
        <div><dt>Checked at</dt><dd>{result.checkedAt}</dd></div>
      </dl>
      {result.candidates.length > 0 && <><h4>Possible listings</h4><ul>{result.candidates.map((item, index) => <li key={index}>{item.url ? <Source href={item.url}>{item.name}</Source> : item.name}</li>)}</ul></>}
      {result.uncertainties.length > 0 && <><h4>Saved uncertainties</h4><ul>{result.uncertainties.map((item, index) => <li key={index}>{item}</li>)}</ul></>}
    </>;
  }
  if (report.body.type === "inventory_audit") return <InventoryReport result={report.body.result} />;
  const incident = report.body.incident;
  return <>
    <dl className="workflow-facts"><div><dt>Station</dt><dd>{incident.station}</dd></div><div><dt>Incident status</dt><dd>{incident.status}</dd></div><div><dt>Saved phase</dt><dd>{incident.phase.replaceAll("_", " ")}</dd></div></dl>
    <h4>Saved observations</h4>
    <ol className="workflow-evidence">{incident.timeline.filter(entry => entry.kind === "observation").map((entry, index) => <li key={index}><span className="workflow-eventMeta">+{(entry.at - incident.openedAt) / 1000}s {entry.source && <Mode mode={entry.source} />}</span>{entry.text}</li>)}</ol>
    <h4>Saved actions and visit requests</h4>
    {incident.actions.length ? <ul className="workflow-actions">{incident.actions.map(action => <li key={action.id}><strong>{ACTION_LABEL[action.kind]}</strong><span className="workflow-actionStatus">{action.status}</span><p>{action.reason}</p></li>)}</ul> : <p className="workflow-muted">No action is saved.</p>}
    {incident.timeline.some(entry => entry.kind !== "observation") && <><h4>Saved decision notes</h4><ul>{incident.timeline.filter(entry => entry.kind !== "observation").map((entry, index) => <li key={index}>{entry.text}</li>)}</ul></>}
  </>;
}

function JobDetail({ job, headingRef }: { job: JobView; headingRef: React.RefObject<HTMLHeadingElement | null> }) {
  const decisions = job.events.filter(event => event.actor === "Dispatcher");
  const body = job.report?.body;
  const openIncident = body?.type === "camera_incident" && body.incident.status === "open";
  return <article className="workflow-detail" aria-labelledby="selected-job-title">
    <header className="workflow-detailHeader"><div className="workflow-badges"><span className="workflow-status">{statusLabels[job.status]}</span>{openIncident && <span className="workflow-openLabel">Incident still open</span>}{job.report && <Mode mode={job.report.mode} />}{!job.report && job.type === "camera_incident" && <Mode mode="simulated" />}</div><h2 ref={headingRef} tabIndex={-1} id="selected-job-title">{job.title}</h2><p className="workflow-id">{job.id} · {timestamp(job.createdAt)}</p></header>
    <div className="workflow-story">
      <section aria-labelledby="request-title"><p className="workflow-step">01 / THE REQUEST</p><h3 id="request-title">What the user asked</h3>
        <dl className="workflow-facts">{"partName" in job.input ? <><div><dt>Part</dt><dd>{job.input.partName}</dd></div><div><dt>Supplier</dt><dd>{job.input.supplierName}</dd></div></> : "csv" in job.input ? <div><dt>Input</dt><dd>Private inventory CSV · submitted to this job</dd></div> : <div><dt>Station</dt><dd>{job.input.station ?? job.title}</dd></div>}<div><dt>Required skill</dt><dd>{SKILLS[job.requiredSkill]}</dd></div></dl>
        {"csv" in job.input && <details><summary>Submitted inventory CSV</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{job.input.csv}</pre></details>}
        {job.sms && <p className="workflow-id">📱 Requested by text from {job.sms.phone} · job code {job.sms.code}</p>}
        {job.input.request && <blockquote>{job.input.request}</blockquote>}
        {job.events.filter(event => event.actor === "You").map((event, index) => <blockquote key={index}>{event.text}</blockquote>)}
      </section>
      <section aria-labelledby="dispatcher-title"><p className="workflow-step">02 / THE DISPATCHER</p><h3 id="dispatcher-title">Why this worker or hire</h3>
        {job.hireRole && <p className="workflow-assignee">Assigned worker: <strong>{job.hireRole}</strong></p>}

        {decisions.length ? <ol className="workflow-decisions">{decisions.map((event, index) => <li key={index}><time dateTime={new Date(event.at).toISOString()}>{timestamp(event.at)}</time><p>{event.text}</p></li>)}</ol> : <p className="workflow-muted">No Dispatcher explanation is saved.</p>}
      </section>
      <section aria-labelledby="evidence-title"><p className="workflow-step">03 / THE WORKER</p><h3 id="evidence-title">What the worker observed</h3><WorkerEvidence job={job} /></section>
      <section aria-labelledby="outcome-title"><p className="workflow-step">04 / THE OUTCOME</p><h3 id="outcome-title">{openIncident ? "Report ready · incident still open" : "Outcome"}</h3>
        {openIncident && <p className="workflow-openIncident">The Inspector’s report is saved. The camera incident remains open. Report completion does not mean the feed recovered.</p>}
        {job.report ? <><Mode mode={job.report.mode} /><p className="workflow-summary">{job.report.summary}</p><dl className="workflow-facts"><div><dt>Saved outcome</dt><dd>{job.report.outcome.replaceAll("_", " ")}</dd></div><div><dt>Report received</dt><dd>{timestamp(job.report.createdAt)}</dd></div>{body?.type === "camera_incident" && <div><dt>Incident</dt><dd>{body.incident.status}{body.incident.resolvedAt !== null && ` · ${timestamp(body.incident.resolvedAt)}`}</dd></div>}</dl></> : <p className="workflow-muted">No report outcome is saved. Job status: {statusLabels[job.status]}.</p>}
        {job.error && <p className="workflow-error">{job.error.code}: {job.error.message}</p>}
      </section>
      <section aria-labelledby="history-title"><p className="workflow-step">SAVED HISTORY</p><h3 id="history-title">The full job trail</h3>
        {job.events.length ? <ol className="workflow-history">{job.events.map((event, index) => <li key={index}><div><strong>{event.actor}</strong><time dateTime={new Date(event.at).toISOString()}>{timestamp(event.at)}</time></div><p>{event.text}</p></li>)}</ol> : <p className="workflow-muted">No history entries are saved.</p>}
      </section>
    </div>
  </article>;
}

export default function Workflow() {
  const query = useSearchParams();
  const workspaceId = query.get("workspace") || "";
  return <WorkflowContent key={workspaceId} workspaceId={workspaceId} requestedJobId={query.get("job")} />;
}

function WorkflowContent({ workspaceId, requestedJobId }: { workspaceId: string; requestedJobId: string | null }) {
  const router = useRouter();
  const [jobs, setJobs] = useState<JobView[] | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const heading = useRef<HTMLHeadingElement>(null);
  const focusOnLoad = useRef(false);
  const selected = requestedJobId ? jobs?.find(job => job.id === requestedJobId) : jobs?.[0];
  const officeHref = `/office?workspace=${encodeURIComponent(workspaceId)}`;

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(`/api/workflow?workspace=${encodeURIComponent(workspaceId)}`, { cache: "no-store", signal: controller.signal });
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error(data.error || "Saved jobs could not be loaded.");
        setJobs(data.jobs);
        setError(null);
      } catch (err) {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Saved jobs could not be loaded.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [refreshKey, workspaceId]);

  useEffect(() => {
    if (focusOnLoad.current) { heading.current?.focus(); focusOnLoad.current = false; }
  }, [requestedJobId]);

  function selectJob(id: string) {
    if (requestedJobId === id || selected?.id === id) { heading.current?.focus(); return; }
    focusOnLoad.current = true;
    router.replace(`/workflow?workspace=${encodeURIComponent(workspaceId)}&job=${encodeURIComponent(id)}`, { scroll: false });
  }

  return <main className="workflow-page">
    <header className="workflow-header"><Link href={officeHref} className="workflow-brand"><BrandMark /> AI Workplace</Link><span className="workflow-readonly">READ-ONLY · SAVED HISTORY</span></header>
    <div className="workflow-workspace">
      <div className="workflow-intro"><div><p className="workflow-eyebrow">WORKSPACE / WORKFLOW</p><h1>Follow the work.</h1><p>From the user’s request to the worker’s findings. Every detail comes from saved jobs and history.</p></div><button type="button" className="workflow-refresh" disabled={loading} onClick={() => { setLoading(true); setRefreshKey(value => value + 1); }}>{loading ? "Loading…" : "Refresh saved jobs"}</button></div>
      <div className="workflow-loadStatus" role="status">{loading ? "Loading saved jobs…" : jobs ? `${jobs.length} saved ${jobs.length === 1 ? "job" : "jobs"} loaded.` : ""}</div>
      {error && <p className="workflow-error" role="alert">{error}{jobs && " Showing the last loaded snapshot."}</p>}
      {jobs && jobs.length === 0 && <section className="workflow-empty"><span aria-hidden="true">↳</span><h2>No saved jobs yet.</h2><p>Jobs submitted in the office will appear here with their saved decisions and reports.</p><Link href={officeHref}>Open the office ↗</Link></section>}
      {jobs && requestedJobId && !selected && <p className="workflow-error" role="alert">That job is not in this workspace’s saved history. Select another saved job below.</p>}
      {jobs && jobs.length > 0 && <div className="workflow-layout"><nav className="workflow-jobNav" aria-label="Saved jobs"><div className="workflow-navHeading"><h2>Job history</h2><span>Latest 50</span></div><ol>{jobs.map(job => <li key={job.id}><button type="button" aria-current={selected?.id === job.id ? "true" : undefined} aria-controls="selected-job-title" onClick={() => selectJob(job.id)}><div className="workflow-jobMeta"><span>{statusLabels[job.status]}</span>{job.report && <Mode mode={job.report.mode} />}{!job.report && job.type === "camera_incident" && <Mode mode="simulated" />}</div><strong>{job.title}</strong><small>{timestamp(job.createdAt)}</small>{job.report?.body.type === "camera_incident" && job.report.body.incident.status === "open" && <span className="workflow-openLabel">Report ready · incident open</span>}</button></li>)}</ol></nav>{selected && <JobDetail job={selected} headingRef={heading} />}</div>}
      <footer className="workflow-footer"><Link href={officeHref}>← Back to the office</Link><span>Saved records only · refresh to see changes</span></footer>
    </div>
  </main>;
}

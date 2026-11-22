"use client";
import { useRef, useState } from "react";
import type { HireView, WorkplaceState } from "@/lib/workplace/types";
import { DEMO_DIFF, DEMO_LOGS, DEMO_HEALTH, REVIEW_MAX_LENGTH, HEALTH_MAX_LENGTH, REVIEW_ACTIONS, type ReviewAction } from "@/lib/specialists/reviews";
export default function SpecialistAction({ hire, workspaceId, busy, onRun, action }: { hire: HireView; workspaceId: string; busy: boolean; onRun: (state: WorkplaceState) => void; action: ReviewAction }) {
  const [diff,setDiff] = useState(""); const [logs,setLogs] = useState(""); const [healthChecks,setHealth] = useState("");
  const [submitting,setSubmitting] = useState(false); const [error,setError] = useState("");
  const requestId = useRef<string | null>(null);
  if (hire.retention !== "team") return null;
  const spec = REVIEW_ACTIONS[action], isDiff = action === "pull_request_review";
  const demo = isDiff ? diff === DEMO_DIFF : logs === DEMO_LOGS && healthChecks === DEMO_HEALTH;
  const enabled = isDiff ? !!diff.trim() : !!(logs.trim() || healthChecks.trim());
  function useDemo() { setDiff(DEMO_DIFF); setLogs(DEMO_LOGS); setHealth(DEMO_HEALTH); setError(""); requestId.current = null; }
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (busy || submitting) return;
    requestId.current ??= crypto.randomUUID(); setSubmitting(true); setError("");
    try {
      const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/agents/${encodeURIComponent(hire.id)}/jobs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({type:action, diff,logs,healthChecks,clientRequestId:requestId.current}) });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error?.message ?? "Could not assign the review.");
      requestId.current = null; onRun(result.state);
    } catch(e) { setError(e instanceof Error ? e.message : "Could not assign the review."); }
    finally { setSubmitting(false); }
  }
  return <form className="office-actionForm" aria-label={spec.title} onSubmit={submit}>
    <h3 className="office-sectionLabel">{spec.title}</h3>
    <p className="office-jobMeta">{spec.inputs}</p>
    <p className="office-finePrint">Read-only local rules-based review. This text and its report stay private to this workspace. No code, tests, commands or live health checks are run.</p>
    <button type="button" className="office-reset" onClick={useDemo} disabled={submitting || busy}>Use demo input</button>
    {demo && <p className="office-jobMeta">DEMO INPUT · the review will execute locally on this example text.</p>}
    {isDiff ? <><label htmlFor={`diff-${hire.id}`}>Pull request diff</label><textarea id={`diff-${hire.id}`} value={diff} disabled={submitting} required maxLength={REVIEW_MAX_LENGTH} spellCheck={false} rows={10} onChange={e=>{setDiff(e.target.value);requestId.current=null;}} /></> : <>
      <label htmlFor={`logs-${hire.id}`}>Deployment logs</label><textarea id={`logs-${hire.id}`} value={logs} disabled={submitting} maxLength={REVIEW_MAX_LENGTH} spellCheck={false} rows={7} onChange={e=>{setLogs(e.target.value);requestId.current=null;}} />
      <label htmlFor={`health-${hire.id}`}>Health-check results</label><textarea id={`health-${hire.id}`} value={healthChecks} disabled={submitting} maxLength={HEALTH_MAX_LENGTH} spellCheck={false} rows={5} onChange={e=>{setHealth(e.target.value);requestId.current=null;}} />
      <p className="office-finePrint">If either input is missing, the report will flag the evidence gap.</p>
    </>}
    <button className="office-hireButton" disabled={busy || submitting || !enabled} type="submit">{submitting ? "Assigning…" : busy ? "Review assigned" : spec.button}</button>
    {error && <p className="office-errorText" role="alert">{error}</p>}
  </form>;
}

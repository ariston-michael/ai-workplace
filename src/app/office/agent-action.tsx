"use client";
import { useRef, useState } from "react";
import type { HireView, WorkplaceState } from "@/lib/workplace/types";
import { CSV_MAX_LENGTH } from "@/lib/marketplace/types";
export default function AgentAction({ hire, workspaceId, busy, onRun }: { hire: HireView; workspaceId: string; busy: boolean; onRun: (state: WorkplaceState) => void }) {
  const [csv, setCsv] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const requestId = useRef<string | null>(null);
  const config = hire.actionConfig;
  // Only workers kept on the team take direct work; a job-only hire is busy with its one job.
  if (!config || hire.retention !== "team") return null;
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting || busy) return;
    requestId.current ??= crypto.randomUUID();
    setSubmitting(true); setError("");
    try {
      const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/agents/${encodeURIComponent(hire.id)}/jobs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ csv, clientRequestId: requestId.current }) });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error?.message ?? "Could not start the audit.");
      requestId.current = null; setCsv(""); onRun(result.state);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not start the audit."); }
    finally { setSubmitting(false); }
  }
  return <form className="office-actionForm" onSubmit={submit}>
    <h3 className="office-sectionLabel">RUN INVENTORY AUDIT</h3>
    <p className="office-jobMeta">Real local execution. Minimum {config.minimumQuantity}; restock target {config.targetQuantity}. Your inventory and report stay in this office, private from the publisher.</p>
    <label htmlFor={`inventory-${hire.id}`}>Inventory CSV</label><textarea id={`inventory-${hire.id}`} value={csv} onChange={event => setCsv(event.target.value)} required maxLength={CSV_MAX_LENGTH} placeholder={'sku,quantity\nPART-A,3\nPART-B,12'} spellCheck={false} />
    <p className="office-finePrint">Header: sku,quantity. Up to 500 unique SKUs with whole, non-negative quantities.</p>
    <button className="office-hireButton" type="submit" disabled={submitting || busy || !csv.trim()}>{submitting ? "Assigning…" : busy ? "Audit assigned" : "Run inventory audit"}</button>
    {error && <p className="office-errorText" role="alert">{error}</p>}
  </form>;
}

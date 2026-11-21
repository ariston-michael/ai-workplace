"use client";

import { useEffect, useState } from "react";
import WorkspaceDashboard, { type WorkspaceCard } from "./dashboard";

type WorkspaceRecord = { id: string; name: string; teamSize: number; totalJobs: number; openJobs: number };

export default function DashboardLoader() {
  const [workspaces, setWorkspaces] = useState<WorkspaceCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch("/api/workspaces", { cache: "no-store", signal: controller.signal });
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error(data.error?.message ?? "Saved workspaces could not be loaded.");
        setWorkspaces(data.workspaces.map((workspace: WorkspaceRecord) => ({
          id: workspace.id, name: workspace.name, workerCount: workspace.teamSize,
          jobCount: workspace.totalJobs, activeJobCount: workspace.openJobs,
        })));
        setError(null);
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Saved workspaces could not be loaded.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [revision]);

  function refresh() { setLoading(true); setRevision(value => value + 1); }

  async function create(name: string): Promise<string | null> {
    try {
      const response = await fetch("/api/workspaces", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) return data.error?.message ?? "The workspace could not be created.";
      refresh();
      return null;
    } catch {
      return "Could not reach the local workspace service. Try again.";
    }
  }

  return <WorkspaceDashboard workspaces={workspaces} loading={loading} error={error} onRefresh={refresh} onCreate={create} />;
}

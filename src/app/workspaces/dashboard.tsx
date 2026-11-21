"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import OfficeThumbnail from "./office-thumbnail";
import "./dashboard.css";

// The persistence/API adapter supplies these card fields from saved workspace records.
export type WorkspaceCard = {
  id: string;
  name: string;
  workerCount: number;
  jobCount: number;
  activeJobCount: number;
};

export default function WorkspaceDashboard({ workspaces, loading, error, onRefresh, onCreate, viewer }: {
  viewer: string | null;
  workspaces: WorkspaceCard[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onCreate: (name: string) => Promise<string | null>;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const visible = workspaces.filter(item => item.name.toLocaleLowerCase().includes(query.toLocaleLowerCase().trim()));

  useEffect(() => {
    if (!creating) return;
    document.getElementById("workspace-name")?.focus();
  }, [creating]);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (submitting || !name.trim()) return;
    setSubmitting(true);
    setCreateError(null);
    const failure = await onCreate(name.trim());
    setSubmitting(false);
    if (failure) { setCreateError(failure); return; }
    setCreating(false);
    setName("");
  }

  return <main className="workspaces-page">
    <header className="workspaces-header"><Link href="/" className="workspaces-brand"><span aria-hidden="true">ai</span> AI Workplace</Link><nav className="workspaces-nav" aria-label="Main"><span className="workspaces-localBadge">YOUR WORKSPACES</span><Link className="workspaces-navLink" href="/marketplace">Marketplace</Link></nav>{viewer && <span className="workspaces-viewer">Signed in as <strong>{viewer}</strong> · <a href="/auth/logout">Log out</a></span>}</header>
    <div className="workspaces-content">
      <div className="workspaces-intro"><div><p className="workspaces-eyebrow">A HOME FOR YOUR TEAMS</p><h1>Workspaces</h1><p>A little space for each team. Step into an office, meet your workers, and pick up where the work left off.</p></div><div className="workspaces-introActions"><button className="workspaces-primary" type="button" aria-expanded={creating} aria-controls="workspace-create" onClick={() => { setCreating(value => !value); setCreateError(null); }}>+ New workspace</button><Link className="workspaces-secondary workspaces-marketCta" href="/marketplace">Browse the marketplace ↗</Link></div></div>
      {creating && <form id="workspace-create" className="workspaces-createForm" onSubmit={create}>
        <label htmlFor="workspace-name">Workspace name<input id="workspace-name" name="name" required maxLength={60} value={name} onChange={event => setName(event.target.value)} placeholder="Name your workspace" /></label>
        <button className="workspaces-primary" type="submit" disabled={submitting || !name.trim()}>{submitting ? "Creating…" : "Create workspace"}</button>
        <button className="workspaces-secondary" type="button" onClick={() => setCreating(false)}>Cancel</button>
        {createError && <p className="workspaces-error" role="alert">{createError}</p>}
      </form>}
      <div className="workspaces-toolbar"><h2>Your offices <span className="workspaces-count">{workspaces.length}</span></h2><div className="workspaces-tools"><label className="workspaces-search">Search workspaces<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search by name" /></label><button className="workspaces-secondary" type="button" onClick={onRefresh} disabled={loading}>{loading ? "Loading…" : "Refresh"}</button></div></div>
      <p className="workspaces-status" role="status">{loading ? "Loading saved workspaces…" : `${workspaces.length} saved ${workspaces.length === 1 ? "workspace" : "workspaces"}.`}</p>
      {error && <p className="workspaces-error" role="alert">{error}</p>}
      {!loading && !error && !workspaces.length && <section className="workspaces-empty"><h3>Make room for your first team.</h3><p>Create a workspace to open an office and give the Dispatcher a request.</p><button className="workspaces-primary" type="button" onClick={() => setCreating(true)}>Create your first workspace</button></section>}
      {workspaces.length > 0 && visible.length === 0 && <p className="workspaces-status">No workspaces match that name.</p>}
      <div className="workspaces-grid">{visible.map(workspace => <Link key={workspace.id} className="workspaces-card" href={`/office?workspace=${encodeURIComponent(workspace.id)}`}>
        <div className="workspaces-cardArt"><OfficeThumbnail /></div>
        <div className="workspaces-cardBody"><div className="workspaces-cardHeading"><h3>{workspace.name}</h3><span aria-hidden="true">↗</span></div><p>{workspace.activeJobCount ? `${workspace.activeJobCount} open ${workspace.activeJobCount === 1 ? "job" : "jobs"}.` : "Step inside your office."}</p><div className="workspaces-cardMeta"><span><i />{workspace.workerCount} {workspace.workerCount === 1 ? "worker" : "workers"}</span><span>{workspace.jobCount} saved {workspace.jobCount === 1 ? "job" : "jobs"}</span><span>Dispatcher at reception</span></div></div>
      </Link>)}</div>
      <footer className="workspaces-footer"><span>Built around the work. And the people directing it.</span><span>Offices and job history saved locally</span></footer>
    </div>
  </main>;
}

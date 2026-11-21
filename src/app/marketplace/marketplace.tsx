"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import PixelCharacter from "../office/pixel-character";
import { CHARACTERS, type CharacterId } from "@/lib/workplace/characters";
import { formatRate, SKILLS, type WorkerProfile } from "@/lib/workplace/catalog";
import type { WorkspaceSummary } from "@/lib/workplace/types";
import { INVENTORY_PERMISSIONS } from "@/lib/marketplace/types";
import "./marketplace.css";

export default function Marketplace() {
  const [listings, setListings] = useState<WorkerProfile[]>([]);
  const [offices, setOffices] = useState<WorkspaceSummary[]>([]);
  const [office, setOffice] = useState("");
  const [mine, setMine] = useState<string[]>([]);
  const [viewer, setViewer] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("Loading listings…");
  const [publishing, setPublishing] = useState(false);
  const [avatar, setAvatar] = useState<CharacterId>("catalog_assistant");
  const [revision, setRevision] = useState(0);
  const requestId = useRef<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([fetch("/api/marketplace", { cache: "no-store", signal: controller.signal }).then(r => r.json()), fetch("/api/workspaces", { cache: "no-store", signal: controller.signal }).then(r => r.json())]).then(([market, saved]) => {
      if (controller.signal.aborted) return;
      if (!market.ok || !saved.ok) throw new Error(market.error?.message ?? saved.error?.message ?? "Marketplace could not be loaded.");
      setListings(market.listings); setMine(market.ownListingIds); setViewer(market.viewer.name);
      setOffices(saved.workspaces); setOffice(current => current || saved.primaryWorkspaceId); setStatus(current => current === "Loading listings…" ? "" : current);
    }).catch(failure => { if (!controller.signal.aborted) { setError(failure.message); setStatus(""); } });
    return () => controller.abort();
  }, [revision]);

  async function publish(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (publishing) return;
    const form = event.currentTarget, data = new FormData(form);
    requestId.current ??= crypto.randomUUID();
    setPublishing(true); setError("");
    try {
      const response = await fetch("/api/marketplace", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        clientRequestId: requestId.current, name: data.get("name"), description: data.get("description"), avatarId: avatar,
        hourlyRateCents: Math.round(Number(data.get("rate")) * 100), skills: ["inventory_audit"], permissions: INVENTORY_PERMISSIONS,
        action: { id: "inventory_audit", config: { minimumQuantity: Number(data.get("minimum")), targetQuantity: Number(data.get("target")) } },
      }) });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error?.message ?? "Could not publish your agent.");
      setStatus(`${result.profile.role} published as a community agent.`); setRevision(value => value + 1); requestId.current = null; form.reset();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not publish your agent."); }
    finally { setPublishing(false); }
  }

  return <main className="marketplace-page">
    <header className="marketplace-header"><Link href="/" className="marketplace-brand">ai / AI Workplace</Link><nav><Link href="/">Workspaces</Link><a href="/auth/logout">Log out</a></nav></header>
    <div className="marketplace-content">
      <p className="marketplace-eyebrow">ROOM FOR YOUR NEXT TEAMMATE</p><h1>Agent marketplace</h1><p className="marketplace-intro">Hire a worker with a clear skill, price and supported action. Or publish one of your own.</p>
      <details className="marketplace-publish"><summary>Publish an agent</summary>
        <p>Published by {viewer || "your signed-in account"}. Community agents never carry the company’s official badge.</p>
        <form onSubmit={publish} className="marketplace-form">
          <div className="marketplace-avatarPicker"><PixelCharacter id={avatar} portrait /><label>Pixel avatar<select aria-label="Pixel avatar" value={avatar} onChange={event => setAvatar(event.target.value as CharacterId)}>{Object.entries(CHARACTERS).map(([id, character]) => <option value={id} key={id}>{character.detail}</option>)}</select></label></div>
          <label>Agent name<input name="name" required maxLength={60} placeholder="e.g. Shelf Scout" /></label>
          <label>Description<textarea name="description" required minLength={10} maxLength={500} rows={3} placeholder="Tell hirers what your worker does." /></label>
          <label>Demo hourly rate ($)<input name="rate" type="number" min="0" max="1000" step="0.01" required defaultValue="5.00" /></label>
          <label>Supported action<select aria-label="Supported action" name="action" defaultValue="inventory_audit"><option value="inventory_audit">Inventory CSV audit · real local execution</option></select></label>
          <p className="marketplace-help">Calculates which SKUs are below your minimum, then recommends units to reach your restock target. The hirer supplies their own CSV. No fixture or external provider is used.</p>
          <div className="marketplace-thresholds"><label>Low-stock minimum<input name="minimum" type="number" min="1" max="100000" step="1" defaultValue="5" required /></label><label>Restock target<input name="target" type="number" min="1" max="100000" step="1" defaultValue="10" required /></label></div>
          <fieldset><legend>Supported skill</legend><label className="marketplace-check"><input type="checkbox" checked disabled readOnly /> Inventory audit</label></fieldset>
          <fieldset><legend>Action permissions</legend><ul>{INVENTORY_PERMISSIONS.map(permission => <li key={permission}>{permission}</li>)}</ul><label className="marketplace-check"><input name="consent" type="checkbox" required /> Publish with these permissions</label></fieldset>
          <p className="marketplace-help">Published listings are fixed for this milestone. Every hire saves its own copy of the price, avatar, permissions and action configuration. No actual payments are collected.</p>
          <button type="submit" disabled={publishing}>{publishing ? "Publishing…" : "Publish community agent"}</button>
        </form>
      </details>
      {error && <p className="marketplace-error" role="alert">{error}</p>}<p role="status">{status}</p>
      <div className="marketplace-browseHeading"><h2>Meet the workers</h2><label>Hire into your office<select aria-label="Hire into your office" value={office} onChange={event => setOffice(event.target.value)}>{offices.map(ws => <option key={ws.id} value={ws.id}>{ws.name}</option>)}</select></label></div>
      <div className="marketplace-grid">{listings.map(profile => <article key={profile.id} className="marketplace-card" data-listing-id={profile.id}>
        <div className="marketplace-cardHeading"><PixelCharacter id={profile.avatarId ?? "catalog_assistant"} portrait /><div><span className={profile.listing?.official ? "marketplace-official" : "marketplace-community"}>{profile.listing?.official ? "✓ Official · AI Workplace" : "Community agent"}</span><h3>{profile.role}</h3><p>{formatRate(profile.hourlyRateCents)}</p></div></div>
        <p>By {profile.listing?.creatorName}{mine.includes(profile.id) && " · Your listing"}</p><p>{profile.specialty}</p>
        <ul className="marketplace-skills">{profile.skills.map(skill => <li key={skill}>{SKILLS[skill]}</li>)}</ul>
        <p><strong>Action:</strong> {profile.listing?.supportedAction === "inventory_audit" ? "Inventory CSV audit · executed locally" : profile.listing?.supportedAction === "supplier_lookup" ? "Approved supplier lookup · sample or live" : "Internal catalog search · not runnable yet"}</p>
        {profile.listing?.configuration && <p>Low stock below {profile.listing.configuration.minimumQuantity}; restock to {profile.listing.configuration.targetQuantity}.</p>}
        <details><summary>Permissions</summary><ul>{profile.permissions.map(p => <li key={p}>{p}</li>)}</ul></details>
        {office && <Link className="marketplace-hireLink" href={`/office?workspace=${encodeURIComponent(office)}&candidate=${encodeURIComponent(profile.id)}`}>Review hire in office ↗</Link>}
      </article>)}</div>
    </div>
  </main>;
}

"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import PixelCharacter, { ListingBadge, VerifiedCheck } from "../office/pixel-character";
import { SKILLS, formatRate, type SkillId } from "@/lib/workplace/catalog";
import { PUBLISH_LIMITS, type MarketplaceListing, type PublishField } from "@/lib/workplace/marketplace";
import {
  ACCESSORIES, HAIR_COLORS, HAIR_STYLES, OUTFIT_COLORS, SKIN_TONES, spriteFromSeed,
  type CustomSprite,
} from "@/lib/workplace/sprites";
import "./marketplace.css";

type Filter = "all" | "official" | "community";
const FILTERS: { id: Filter; label: string }[] = [{ id: "all", label: "All" }, { id: "official", label: "Official" }, { id: "community", label: "Community" }];

type HireTarget = { id: string; name: string; openDesks: number; hiredListingIds: string[] };
type Data = { listings: MarketplaceListing[]; workspaces: HireTarget[]; viewer: { name: string | null; suggestedPublisherName: string } };

// Module-level so they are never render-time side effects.
const newRequestId = () => crypto.randomUUID();
const randomSeed = () => Math.floor(Math.random() * 2 ** 31);

const isSkill = (s: string | null): s is SkillId => !!s && Object.hasOwn(SKILLS, s);

export default function Marketplace() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const raw = params.get("filter");
  const filter: Filter = raw === "official" || raw === "community" ? raw : "all";
  const contextWs = params.get("workspace");
  const jobId = params.get("job");
  const skillParam = params.get("skill");
  const skill = isSkill(skillParam) ? skillParam : null;

  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hiring, setHiring] = useState<MarketplaceListing | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/marketplace", { cache: "no-store", signal: controller.signal })
      .then(async res => {
        const body = await res.json();
        if (!res.ok || !body.ok) throw new Error(body.error?.message ?? "The marketplace could not be loaded.");
        setData(body); setError(null);
      })
      .catch(failure => {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "The marketplace could not be loaded.");
      });
    return () => controller.abort();
  }, [revision]);
  const load = () => setRevision(r => r + 1);

  function setFilter(next: Filter) {
    const q = new URLSearchParams(params);
    if (next === "all") q.delete("filter"); else q.set("filter", next);
    router.replace(`${pathname}${q.size ? `?${q}` : ""}`, { scroll: false });
  }

  const listings = data?.listings ?? [];
  const counts = { all: listings.length, official: listings.filter(l => l.kind === "official").length, community: listings.filter(l => l.kind === "community").length };
  const visible = listings
    .filter(l => filter === "all" || l.kind === filter)
    // With a skill in context, qualified workers come first (stable within each group).
    .sort((a, b) => skill ? Number(b.skills.includes(skill)) - Number(a.skills.includes(skill)) : 0);
  const contextOffice = data?.workspaces.find(w => w.id === contextWs);

  function onPublished(listing: MarketplaceListing) {
    setData(d => d && ({ ...d, listings: [...d.listings.filter(l => l.id !== listing.id), listing] }));
    setPublishing(false);
    setHighlight(listing.id);
    setAnnouncement(`${listing.characterName} is published as a community listing.`);
    if (filter === "official") setFilter("community");
    requestAnimationFrame(() => document.querySelector(`[data-listing-id="${CSS.escape(listing.id)}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" }));
  }

  return <main className="market-page">
    <header className="market-header">
      <Link href="/" className="market-brand"><span aria-hidden="true">ai</span> AI Workplace</Link>
      <nav className="market-nav" aria-label="Main"><Link href="/">Workspaces</Link><span aria-current="page">Marketplace</span></nav>
      {data?.viewer.name && <span className="market-viewer">Signed in as <strong>{data.viewer.name}</strong> · <a href="/auth/logout">Log out</a></span>}
    </header>

    <div className="market-content">
      <div className="market-intro">
        <div>
          <p className="market-eyebrow">HIRE BY THE HOUR</p>
          <h1>Marketplace</h1>
          <p>Every worker here is an original pixel character. Hire one into an office and that exact character walks in through the entrance. Official workers carry the blue check; community agents are published by other users.</p>
        </div>
        <button type="button" className="market-primary" onClick={() => setPublishing(true)} disabled={!data}>Publish agent <span aria-hidden="true">+</span></button>
      </div>

      {data && (contextWs || skill) && <section className="market-context" aria-label="Hiring context">
        {jobId && skill ? <p><strong>The Dispatcher is holding a job</strong> in {contextOffice?.name ?? "your office"} that needs <strong>{SKILLS[skill]}</strong>. Qualified workers are listed first. Hiring one resumes the job automatically.</p>
          : contextWs ? <p>Hiring for <strong>{contextOffice?.name ?? "your office"}</strong>. You can pick another office in the next step.</p>
          : skill ? <p>Showing workers with <strong>{SKILLS[skill]}</strong> first.</p> : null}
        {contextWs && <Link className="market-secondary" href={`/office?workspace=${encodeURIComponent(contextWs)}`}>← Back to the office</Link>}
      </section>}

      <div className="market-toolbar">
        <div className="market-filters" role="radiogroup" aria-label="Show listings">
          {FILTERS.map(f => <button key={f.id} type="button" role="radio" aria-checked={filter === f.id} className="market-filter" onClick={() => setFilter(f.id)}>
            {f.id === "official" && <VerifiedCheck label="" />}{f.label} <span className="market-count">{data ? counts[f.id] : "·"}</span>
          </button>)}
        </div>
        <p className="market-note">Demo hourly rates, billed per second of run time and never charged.</p>
      </div>

      {error && <p className="market-error" role="alert">{error} <button type="button" className="market-secondary" onClick={load}>Try again</button></p>}
      {!data && !error && <p className="market-status" role="status">Loading listings…</p>}
      {data && filter === "community" && counts.community === 0 && <section className="market-empty">
        <PixelCharacter sprite={spriteFromSeed(11)} portrait />
        <h2>No community agents yet.</h2>
        <p>Design a character, choose its skills and rate, and publish it for every signed-in user.</p>
        <button type="button" className="market-primary" onClick={() => setPublishing(true)}>Publish the first agent</button>
      </section>}

      <ul className="market-grid">
        {visible.map(l => {
          const qualified = skill ? l.skills.includes(skill) : true;
          return <li key={l.id} className="market-card" data-listing-id={l.id} data-kind={l.kind} data-highlight={highlight === l.id || undefined} data-qualified={skill ? qualified : undefined}>
            <div className="market-cardArt"><PixelCharacter sprite={l.sprite} portrait stroll /></div>
            <div className="market-cardBody">
              <div className="market-cardTitle"><h2>{l.characterName}{l.verified && <VerifiedCheck />}</h2><span className="market-rate">{formatRate(l.hourlyRateCents).replace(" / hour", "")}<small>/hr</small></span></div>
              <p className="market-role">{l.role}</p>
              <ListingBadge kind={l.kind} publisher={l.publisher.isYou ? `${l.publisher.name} (you)` : l.publisher.name} />
              <p className="market-specialty">{l.specialty}</p>
              <blockquote className="market-greeting">“{l.greeting}”</blockquote>
              <ul className="market-skills" aria-label="Skills">{l.skills.map(s => <li key={s} data-match={s === skill || undefined}>{SKILLS[s]}{s === skill ? " ✓" : ""}</li>)}</ul>
              <details className="market-more"><summary>Sample work and permissions</summary>
                <p><strong>Sample work:</strong> {l.sampleWork}</p>
                <p><strong>Permissions</strong> (set by the platform from the skills):</p>
                <ul>{l.permissions.map(p => <li key={p}>{p}</li>)}</ul>
              </details>
              <button type="button" className="market-hire" disabled={!qualified && !!jobId} onClick={() => setHiring(l)}>
                {!qualified && jobId ? `Lacks ${SKILLS[skill!]}` : `Hire ${l.characterName}`} <span aria-hidden="true">↗</span>
              </button>
            </div>
          </li>;
        })}
      </ul>
      <p className="market-announcement" role="status">{announcement}</p>
      <footer className="market-footer"><span>Built around the work. And the people directing it.</span><span>Community listings run on the platform’s tools for their skills.</span></footer>
    </div>

    {hiring && data && <HireDialog listing={hiring} workspaces={data.workspaces} initial={contextWs} jobId={jobId && contextWs ? jobId : null} onClose={() => setHiring(null)} />}
    {publishing && data && <PublishDialog suggestedPublisher={data.viewer.suggestedPublisherName} onClose={() => setPublishing(false)} onPublished={onPublished} />}
  </main>;
}

/** Native modal dialog: focus trap, Escape and backdrop come from the browser. */
function useModal() {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);
  return ref;
}

function HireDialog({ listing, workspaces, initial, jobId, onClose }: {
  listing: MarketplaceListing; workspaces: HireTarget[]; initial: string | null; jobId: string | null; onClose: () => void;
}) {
  const router = useRouter();
  const dialogRef = useModal();
  const cancel = (e: React.SyntheticEvent) => { e.preventDefault(); onClose(); };
  // A held job belongs to one office, so the picker is locked to it.
  const choices = jobId ? workspaces.filter(w => w.id === initial) : workspaces;
  const reason = (w: HireTarget) => w.hiredListingIds.includes(listing.id) ? "Already on this team" : w.openDesks === 0 ? "No open desk" : null;
  const firstFree = choices.find(w => !reason(w))?.id ?? null;
  const [choice, setChoice] = useState<string | null>(initial && choices.some(w => w.id === initial && !reason(w)) ? initial : firstFree);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function hire(event: React.FormEvent) {
    event.preventDefault();
    if (!choice || submitting) return;
    setSubmitting(true); setError(null);
    try {
      const res = await fetch(`/api/workspaces/${encodeURIComponent(choice)}/hires`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId: listing.id, jobId: jobId ?? undefined }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) { setError(body.error?.message ?? "The hire could not be saved."); setSubmitting(false); return; }
      const q = new URLSearchParams({ workspace: choice });
      if (body.created) q.set("arrived", body.hireId);
      router.push(`/office?${q}`);
    } catch {
      setError("Could not reach the local workspace service. Try again.");
      setSubmitting(false);
    }
  }

  return <dialog ref={dialogRef} className="market-dialog" aria-labelledby="hire-title" onCancel={cancel}>
    <form onSubmit={hire}>
      <div className="market-dialogHead">
        <PixelCharacter sprite={listing.sprite} portrait stroll />
        <div><p className="market-eyebrow">HIRE INTO AN OFFICE</p><h2 id="hire-title">Hire {listing.characterName}{listing.verified && <VerifiedCheck />}</h2><p>{listing.role} · {formatRate(listing.hourlyRateCents)}</p><ListingBadge kind={listing.kind} publisher={listing.publisher.name} /></div>
      </div>
      <fieldset className="market-picker">
        <legend>{jobId ? "The held job’s office" : "Choose a workspace"}</legend>
        {choices.length === 0 && <p className="market-error">That office is not available. <Link href="/">Go to your workspaces</Link></p>}
        {choices.map(w => {
          const blocked = reason(w);
          return <label key={w.id} className="market-pickerRow" data-blocked={blocked ? true : undefined}>
            <input type="radio" name="workspace" value={w.id} checked={choice === w.id} disabled={!!blocked} onChange={() => setChoice(w.id)} />
            <span><strong>{w.name}</strong><small>{blocked ?? `${w.openDesks} open ${w.openDesks === 1 ? "desk" : "desks"}`}</small></span>
          </label>;
        })}
      </fieldset>
      {listing.kind === "community" && <p className="market-fine">Community listing by {listing.publisher.name}. It is not verified by AI Workplace and runs on the platform’s tools for its skills, with the permissions listed on the card.</p>}
      <p className="market-fine">{listing.characterName} walks in through the entrance to the first open desk. The hire, its rate and this character are saved with the office.</p>
      {error && <p className="market-error" role="alert">{error}</p>}
      <div className="market-dialogActions">
        <button type="button" className="market-secondary" onClick={onClose}>Cancel</button>
        <button type="submit" className="market-primary" disabled={!choice || submitting}>{submitting ? "Hiring…" : choice ? `Hire into ${workspaces.find(w => w.id === choice)?.name}` : "No office has room"}</button>
      </div>
    </form>
  </dialog>;
}

type Draft = { characterName: string; role: string; specialty: string; greeting: string; skills: SkillId[]; rate: string; sampleWork: string; publisherName: string; sprite: CustomSprite };

const PART_LABEL: Record<string, string> = {
  crop: "Crop", long: "Long", bun: "Bun", curls: "Curls", cap: "Cap", beanie: "Beanie", shaved: "Shaved",
  none: "None", glasses: "Glasses", satchel: "Satchel", tablet: "Tablet", toolbelt: "Tool belt", badge: "Badge",
};
const title = (k: string) => k[0].toUpperCase() + k.slice(1);

function PublishDialog({ suggestedPublisher, onClose, onPublished }: { suggestedPublisher: string; onClose: () => void; onPublished: (l: MarketplaceListing) => void }) {
  const dialogRef = useModal();
  const cancel = (e: React.SyntheticEvent) => { e.preventDefault(); onClose(); };
  const [draft, setDraft] = useState<Draft>(() => ({
    characterName: "", role: "", specialty: "", greeting: "", skills: [], rate: "5.00", sampleWork: "",
    publisherName: suggestedPublisher, sprite: spriteFromSeed(7),
  }));
  const [errors, setErrors] = useState<Partial<Record<PublishField, string>>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // One id per dialog, so a double submit cannot publish twice.
  const requestId = useRef<string | null>(null);

  // Editing a field clears its error; the server re-checks everything on submit.
  const clearError = (key: PublishField) => setErrors(e => { if (!e[key]) return e; const next = { ...e }; delete next[key]; return next; });
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft(d => ({ ...d, [key]: value }));
    clearError(key === "rate" ? "hourlyRateCents" : key);
  };
  const setPart = <K extends keyof CustomSprite>(key: K, value: CustomSprite[K]) => { setDraft(d => ({ ...d, sprite: { ...d.sprite, [key]: value } })); clearError("sprite"); };
  const L = PUBLISH_LIMITS;

  async function publish(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true); setFailure(null);
    requestId.current ??= newRequestId();
    const { rate, ...rest } = draft;
    const cents = Math.round(Number(rate) * 100);
    try {
      const res = await fetch("/api/marketplace/listings", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientRequestId: requestId.current, listing: { ...rest, hourlyRateCents: Number.isFinite(cents) ? cents : null } }),
      });
      const body = await res.json();
      setSubmitting(false);
      if (!res.ok || !body.ok) {
        setErrors(body.error?.fields ?? {});
        setFailure(body.error?.message ?? "The listing could not be published.");
        // Field errors mean nothing was saved; let a corrected submit use a new id.
        if (body.error?.fields) requestId.current = null;
        return;
      }
      onPublished(body.listing);
    } catch {
      setSubmitting(false);
      setFailure("Could not reach the local marketplace service. Try again.");
    }
  }

  const field = (key: Exclude<PublishField, "skills" | "sprite" | "hourlyRateCents">, label: string, opts: { multiline?: boolean; placeholder: string; max: number }) => {
    const id = `publish-${key}`;
    const Input = opts.multiline ? "textarea" : "input";
    return <label className="market-field" htmlFor={id}>
      <span>{label}</span>
      <Input id={id} name={key} value={draft[key]} maxLength={opts.max} placeholder={opts.placeholder} rows={opts.multiline ? 2 : undefined}
        aria-invalid={errors[key] ? true : undefined} aria-describedby={errors[key] ? `${id}-error` : undefined}
        onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set(key, e.target.value)} />
      {errors[key] && <small id={`${id}-error`} className="market-fieldError">{errors[key]}</small>}
    </label>;
  };

  const swatches = <K extends "skin" | "outfit" | "trim" | "hairColor">(key: K, label: string, table: Record<string, string>) =>
    <fieldset className="market-parts"><legend>{label}</legend><div className="market-swatches">
      {Object.entries(table).map(([name, hex]) => <label key={name} className="market-swatch" title={title(name)}>
        <input type="radio" name={`sprite-${key}`} value={name} checked={draft.sprite[key] === name} onChange={() => setPart(key, name as CustomSprite[K])} />
        <span style={{ background: hex }} aria-hidden="true" /><span className="market-visuallyHidden">{title(name)}</span>
      </label>)}
    </div></fieldset>;

  const choices = <K extends "hair" | "accessory">(key: K, label: string, list: readonly string[]) =>
    <fieldset className="market-parts"><legend>{label}</legend><div className="market-chips">
      {list.map(name => <label key={name} className="market-chip">
        <input type="radio" name={`sprite-${key}`} value={name} checked={draft.sprite[key] === name} onChange={() => setPart(key, name as CustomSprite[K])} />
        <span>{PART_LABEL[name]}</span>
      </label>)}
    </div></fieldset>;

  return <dialog ref={dialogRef} className="market-dialog market-publish" aria-labelledby="publish-title" onCancel={cancel}>
    <form onSubmit={publish} noValidate>
      <div className="market-dialogHead"><div><p className="market-eyebrow">COMMUNITY LISTING</p><h2 id="publish-title">Publish an agent</h2><p>Your agent appears under Community for every signed-in user. Permissions come from the skills you choose; it cannot be given more.</p></div></div>
      <div className="market-publishGrid">
        <section className="market-builder" aria-labelledby="builder-title">
          <h3 id="builder-title">Character sprite</h3>
          <div className="market-preview" aria-label="Sprite preview: facing south, north, east and west" role="img">
            {(["south", "east", "north", "west"] as const).map(f => <PixelCharacter key={f} sprite={draft.sprite} facing={f} stroll />)}
          </div>
          <button type="button" className="market-secondary" onClick={() => set("sprite", spriteFromSeed(randomSeed()))}>Shuffle parts</button>
          {swatches("skin", "Skin", SKIN_TONES)}
          {swatches("outfit", "Outfit", OUTFIT_COLORS)}
          {swatches("trim", "Trim", OUTFIT_COLORS)}
          {choices("hair", "Hair", HAIR_STYLES)}
          {swatches("hairColor", "Hair colour", HAIR_COLORS)}
          {choices("accessory", "Accessory", ACCESSORIES)}
          {errors.sprite && <small className="market-fieldError">{errors.sprite}</small>}
        </section>
        <section className="market-fields" aria-label="Listing details">
          {field("characterName", "Character name", { placeholder: "e.g. Juno", max: L.characterName[1] })}
          {field("role", "Role", { placeholder: "e.g. Parts Scout", max: L.role[1] })}
          {field("specialty", "Specialty", { placeholder: "What this agent is good at", max: L.specialty[1], multiline: true })}
          {field("greeting", "Greeting", { placeholder: "A line your character says at its desk", max: L.greeting[1] })}
          <fieldset className="market-parts" aria-invalid={errors.skills ? true : undefined} aria-describedby={errors.skills ? "publish-skills-error" : undefined}>
            <legend>Skills (1–{L.maxSkills})</legend>
            <div className="market-chips">{(Object.keys(SKILLS) as SkillId[]).map(s => <label key={s} className="market-chip">
              <input type="checkbox" name="skills" value={s} checked={draft.skills.includes(s)}
                onChange={e => set("skills", e.target.checked ? [...draft.skills, s] : draft.skills.filter(x => x !== s))} />
              <span>{SKILLS[s]}</span>
            </label>)}</div>
            {errors.skills && <small id="publish-skills-error" className="market-fieldError">{errors.skills}</small>}
          </fieldset>
          <label className="market-field" htmlFor="publish-rate">
            <span>Hourly rate (USD, ${L.rateCents[0] / 100}–${L.rateCents[1] / 100})</span>
            <input id="publish-rate" name="rate" type="number" inputMode="decimal" min={L.rateCents[0] / 100} max={L.rateCents[1] / 100} step="0.5" value={draft.rate}
              aria-invalid={errors.hourlyRateCents ? true : undefined} aria-describedby={errors.hourlyRateCents ? "publish-rate-error" : undefined} onChange={e => set("rate", e.target.value)} />
            {errors.hourlyRateCents && <small id="publish-rate-error" className="market-fieldError">{errors.hourlyRateCents}</small>}
          </label>
          {field("sampleWork", "Sample work", { placeholder: "A short example of what it delivers", max: L.sampleWork[1], multiline: true })}
          {field("publisherName", "Publisher name (shown on the listing)", { placeholder: "Your name or team", max: L.publisherName[1] })}
        </section>
      </div>
      {failure && <p className="market-error" role="alert">{failure}</p>}
      <div className="market-dialogActions">
        <button type="button" className="market-secondary" onClick={onClose}>Cancel</button>
        <button type="submit" className="market-primary" disabled={submitting}>{submitting ? "Publishing…" : "Publish to Community"}</button>
      </div>
    </form>
  </dialog>;
}

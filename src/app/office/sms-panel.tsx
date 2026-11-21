"use client";

import { useEffect, useState } from "react";

type Link = { id: string; phone: string; linkedAt: number };
type Sms = { mode?: "simulated"; messages?: { id: string; body: string; at: number }[]; configured: boolean; number: string | null; links: Link[]; code: { code: string; expiresAt: number } | null };

const clockNow = () => Date.now();
const prettyNumber = (n: string) => n.startsWith("+1") && n.length === 12 ? `+1 (${n.slice(2, 5)}) ${n.slice(5, 8)}-${n.slice(8)}` : n;

/** "Text the Dispatcher": link a phone to this office with a single-use code. */
export default function SmsPanel({ workspaceId }: { workspaceId: string }) {
  const base = `/api/workspaces/${encodeURIComponent(workspaceId)}/sms`;
  const [sms, setSms] = useState<Sms | null>(null);
  const [code, setCode] = useState<Sms["code"]>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [now, setNow] = useState(clockNow);

  useEffect(() => {
    let cancelled = false;
    fetch(base, { cache: "no-store" }).then(r => r.json()).then(r => { if (!cancelled && r.ok) setSms(r.sms); }).catch(() => {});
    return () => { cancelled = true; };
  }, [base]);

  useEffect(() => {
    if (sms?.mode !== "simulated") return;
    const id = setInterval(() => {
      if (!document.hidden) fetch(base, { cache: "no-store" }).then(r => r.json()).then(r => { if (r.ok) setSms(r.sms); }).catch(() => {});
    }, 2000);
    return () => clearInterval(id);
  }, [base, sms?.mode]);

  async function sendSimulated(event: React.FormEvent) {
    event.preventDefault(); if (sending || !draft.trim()) return;
    setSending(true); setError(null);
    try {
      const response = await fetch(`${base}/simulate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: draft, clientRequestId: crypto.randomUUID() }) });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error?.message ?? "Could not simulate text.");
      setDraft("");
      const status = await fetch(base, { cache: "no-store" }).then(r => r.json()); if (status.ok) setSms(status.sms);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not simulate text."); }
    finally { setSending(false); }
  }

  // While a code is showing, count down and watch for the phone to link.
  useEffect(() => {
    if (!code) return;
    const tick = setInterval(() => setNow(clockNow()), 1000);
    const poll = setInterval(() => {
      fetch(base, { cache: "no-store" }).then(r => r.json()).then(r => {
        if (!r.ok) return;
        setSms(r.sms);
        if (r.sms.links.some((l: Link) => l.linkedAt >= code.expiresAt - 10 * 60_000)) setCode(null);
      }).catch(() => {});
    }, 3000);
    return () => { clearInterval(tick); clearInterval(poll); };
  }, [code, base]);

  async function post(body: Record<string, unknown>) {
    setError(null);
    const r = await fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(x => x.json()).catch(() => null);
    if (!r?.ok) { setError(r?.error?.message ?? "Could not reach the workspace service."); return; }
    setSms(r.sms);
    if (r.sms.code) { setCode(r.sms.code); setNow(clockNow()); }
  }

  if (!sms) return null;
  if (sms.mode === "simulated") return <section className="office-sms" aria-labelledby="sms-title">
    <h3 id="sms-title" className="office-sectionLabel">SIMULATED SMS · TEXT THE DISPATCHER</h3>
    <p className="office-finePrint">Demo only. Messages stay in this workspace; nothing is sent to a phone. Try a part request, then reply APPROVE followed by its job code.</p>
    <form onSubmit={sendSimulated}><label htmlFor="sms-simulation">Simulated text</label><textarea id="sms-simulation" value={draft} onChange={event => setDraft(event.target.value)} required maxLength={500} disabled={sending} className="office-smsDraft" />
      <button className="office-reset" type="submit" disabled={sending || !draft.trim()}>{sending ? "Sending…" : "Send simulated text"}</button></form>
    {error && <p role="alert" className="office-errorText">{error}</p>}
    <ul className="office-smsTranscript" aria-label="Simulated SMS replies">{sms.messages?.map(message => <li key={message.id}><strong>SIMULATED · Dispatcher</strong><p>{message.body}</p></li>)}</ul>
  </section>;
  const left = code ? Math.max(0, Math.ceil((code.expiresAt - now) / 1000)) : 0;
  return (
    <section className="office-sms" aria-labelledby="sms-title">
      <h3 id="sms-title" className="office-sectionLabel">TEXT THE DISPATCHER</h3>
      {!sms.configured ? <p className="office-finePrint">SMS is off. Add the Twilio settings to .env.local and restart the server.</p> : <>
        <p className="office-jobMeta">Text <strong>{prettyNumber(sms.number!)}</strong> from a linked phone. Replies come from the same Dispatcher, hiring rules and workflow history as this office.</p>
        {sms.links.length > 0 && <ul className="office-smsLinks">{sms.links.map(l => <li key={l.id}>
          <span>📱 {l.phone} · linked</span>
          <button type="button" className="office-reset" onClick={() => { if (window.confirm(`Unlink ${l.phone}? Texts from it will no longer reach this office.`)) void post({ action: "unlink", linkId: l.id }); }}>Unlink</button>
        </li>)}</ul>}
        {code && left > 0 ? (
          <div className="office-smsCode" role="status">
            <p>Text this from your phone to <strong>{prettyNumber(sms.number!)}</strong>:</p>
            <p className="office-smsCodeValue">LINK {code.code}</p>
            <p className="office-finePrint">Single use · expires in {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}. A phone links to one office at a time.</p>
          </div>
        ) : (
          <button type="button" className="office-reset" onClick={() => void post({ action: "link_code" })}>{sms.links.length ? "Link another phone" : "Get a link code"}</button>
        )}
        {code && left === 0 && <p className="office-finePrint">That code expired. Get a new one.</p>}
      </>}
      {error && <p className="office-errorText" role="alert">{error}</p>}
    </section>
  );
}

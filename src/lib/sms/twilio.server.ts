// Server-only Twilio SMS client: webhook signature validation, TwiML replies and
// outbound messages via the REST API (plain fetch, no SDK).
// Docs: https://www.twilio.com/docs/usage/security#validating-requests
//       https://www.twilio.com/docs/messaging/api/message-resource

import { createHmac, timingSafeEqual } from "node:crypto";

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  /** E.164 number people text (shown in the office). */
  phoneNumber: string;
  /** Exact public URL configured in Twilio for "A message comes in". Signatures are computed over it. */
  webhookUrl: string;
  apiBase: string;
}

const E164 = /^\+[1-9]\d{7,14}$/;

/** null until all four TWILIO_* settings are present: SMS is then off. */
export function twilioConfig(env: Record<string, string | undefined> = process.env): TwilioConfig | null {
  if (env.SMS_MODE === "simulated") return null;
  const accountSid = env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = env.TWILIO_AUTH_TOKEN?.trim();
  const phoneNumber = env.TWILIO_PHONE_NUMBER?.replace(/[\s()-]/g, "");
  const webhookUrl = env.TWILIO_WEBHOOK_URL?.trim();
  if (!accountSid || !/^AC[0-9a-f]{32}$/i.test(accountSid) || !authToken || !phoneNumber || !E164.test(phoneNumber) || !webhookUrl) return null;
  try {
    const u = new URL(webhookUrl);
    if (u.protocol !== "https:" && !(u.protocol === "http:" && ["127.0.0.1", "localhost"].includes(u.hostname))) return null;
  } catch {
    return null;
  }
  return { accountSid, authToken, phoneNumber, webhookUrl, apiBase: (env.TWILIO_API_BASE?.trim() || "https://api.twilio.com").replace(/\/+$/, "") };
}

export const isE164 = (v: unknown): v is string => typeof v === "string" && E164.test(v);

/** Twilio's signature: base64(HMAC-SHA1(authToken, url + each POST name+value, names sorted case-sensitively)). */
export function twilioSignature(authToken: string, url: string, params: [string, string][]): string {
  const sorted = [...params].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const data = url + sorted.map(([k, v]) => k + v).join("");
  return createHmac("sha1", authToken).update(data, "utf8").digest("base64");
}

export function validTwilioSignature(authToken: string, url: string, params: [string, string][], header: string | null): boolean {
  if (!header) return false;
  const expected = Buffer.from(twilioSignature(authToken, url, params));
  const given = Buffer.from(header);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

/** TwiML reply. An empty string means "no reply" (e.g. STOP, which Twilio handles itself). */
export function twiml(message: string): string {
  return message ? `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${xml(message)}</Message></Response>` : `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;
}

export type SendResult = { ok: true; sid: string; status: string } | { ok: false; code: string; message: string };

/** Sends one SMS. Never throws; failures are returned so the caller can record them. */
export async function sendSms(config: TwilioConfig, to: string, body: string, fetchImpl: typeof fetch = fetch): Promise<SendResult> {
  const url = `${config.apiBase}/2010-04-01/Accounts/${encodeURIComponent(config.accountSid)}/Messages.json`;
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: to, From: config.phoneNumber, Body: body.slice(0, 1600) }),
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await res.json().catch(() => ({}))) as { sid?: string; status?: string; code?: number; message?: string };
    if (!res.ok || !data.sid) return { ok: false, code: `TWILIO_${data.code ?? res.status}`, message: (data.message ?? `HTTP ${res.status}`).slice(0, 200) };
    return { ok: true, sid: data.sid, status: data.status ?? "queued" };
  } catch {
    return { ok: false, code: "TWILIO_UNREACHABLE", message: "Could not reach Twilio." };
  }
}

/** "+15551234567" → "•••4567" for display. */
export const maskPhone = (phone: string) => `•••${phone.slice(-4)}`;

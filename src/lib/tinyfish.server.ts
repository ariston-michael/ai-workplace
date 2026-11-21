// Server-only TinyFish client. Never import this from a client component:
// it reads TINYFISH_API_KEY from the server environment (.env.local).
// API reference: https://docs.tinyfish.ai/api-reference/automation/run-browser-automation-synchronously

import type { BrowserProfile, LookupError } from "@/lib/procurement";

const DEFAULT_BASE_URL = "https://agent.tinyfish.ai";
/** TinyFish kills the run after this many seconds (agent_config.max_duration_seconds). */
export const RUN_MAX_SECONDS = 150;
/** Our own HTTP timeout, a little longer than the run limit. */
const HTTP_TIMEOUT_MS = (RUN_MAX_SECONDS + 30) * 1000;

export function getTinyFishApiKey(): string | null {
  const key = process.env.TINYFISH_API_KEY?.trim();
  if (!key || key === "your-tinyfish-api-key") return null;
  return key;
}

interface TinyFishRunResponse {
  run_id: string | null;
  status: "COMPLETED" | "FAILED";
  num_of_steps?: number | null;
  result: unknown;
  error: { message?: string; category?: string; code?: string } | null;
}

export type RunOutcome =
  | { ok: true; runId: string | null; steps: number | null; result: unknown }
  | { ok: false; error: LookupError };

export async function runTinyFish(params: {
  apiKey: string;
  url: string;
  goal: string;
  browserProfile: BrowserProfile;
}): Promise<RunOutcome> {
  // TINYFISH_BASE_URL exists only so local tests can point at a mock server.
  const base = process.env.TINYFISH_BASE_URL?.trim() || DEFAULT_BASE_URL;

  let res: Response;
  try {
    res = await fetch(`${base}/v1/automation/run`, {
      method: "POST",
      headers: { "X-API-Key": params.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        url: params.url,
        goal: params.goal,
        browser_profile: params.browserProfile,
        agent_config: { max_duration_seconds: RUN_MAX_SECONDS },
        api_integration: "ai-workplace",
      }),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (err) {
    if (err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError")) {
      return fail("PROVIDER_TIMEOUT", `TinyFish did not respond within ${HTTP_TIMEOUT_MS / 1000} seconds.`);
    }
    return fail("PROVIDER_UNREACHABLE", "Could not reach TinyFish. Check the Mac's internet connection.");
  }

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // fall through with body = null
  }

  if (!res.ok && !isRunBody(body)) {
    const code = providerCode(body);
    const msg = providerMessage(body) ?? `TinyFish returned HTTP ${res.status}.`;
    switch (res.status) {
      case 401:
        return fail("PROVIDER_AUTH", `TinyFish rejected the API key (${code ?? "401"}). Check TINYFISH_API_KEY in .env.local.`);
      case 402:
        return fail("PROVIDER_CREDITS", `TinyFish account has insufficient credits: ${msg}`);
      case 429:
        return fail("PROVIDER_RATE_LIMIT", "TinyFish rate limit reached (too many pending runs). Wait and retry.");
      default:
        return fail("PROVIDER_ERROR", `TinyFish error ${res.status}${code ? ` ${code}` : ""}: ${msg}`);
    }
  }

  if (!isRunBody(body)) {
    return fail("PROVIDER_ERROR", "TinyFish returned an unexpected response.");
  }

  if (body.status !== "COMPLETED") {
    const e = body.error ?? {};
    const detail = [e.code, e.category].filter(Boolean).join(" / ");
    const hint = e.code === "SITE_BLOCKED" ? " The supplier blocked the automated browser." : "";
    return fail(
      e.code === "TIMEOUT" ? "PROVIDER_TIMEOUT" : "LOOKUP_FAILED",
      `TinyFish run failed${detail ? ` (${detail})` : ""}: ${e.message ?? "no details"}.${hint}`,
    );
  }

  return {
    ok: true,
    runId: body.run_id,
    steps: typeof body.num_of_steps === "number" ? body.num_of_steps : null,
    result: body.result,
  };
}

function fail(code: LookupError["code"], message: string): RunOutcome {
  return { ok: false, error: { code, message } };
}

function isRunBody(body: unknown): body is TinyFishRunResponse {
  return typeof body === "object" && body !== null && "status" in body && "result" in body;
}

function providerError(body: unknown): Record<string, unknown> | null {
  if (typeof body !== "object" || body === null) return null;
  const err = (body as Record<string, unknown>).error;
  return typeof err === "object" && err !== null ? (err as Record<string, unknown>) : null;
}

function providerCode(body: unknown): string | null {
  const c = providerError(body)?.code;
  return typeof c === "string" ? c : null;
}

function providerMessage(body: unknown): string | null {
  const m = providerError(body)?.message;
  return typeof m === "string" ? m.slice(0, 300) : null;
}

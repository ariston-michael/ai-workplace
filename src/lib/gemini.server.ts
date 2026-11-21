// Server-only Gemini client (Gemini Developer API, generateContent with JSON output).
// Reads GEMINI_API_KEY from the server environment (.env.local). Never import this
// from a client component. Docs: https://ai.google.dev/api/generate-content

export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";
const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com";
const TIMEOUT_MS = 15_000;

export interface GeminiConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
  timeoutMs: number;
}

/** null when no key is configured: the Dispatcher then uses its built-in rules. */
export function geminiConfig(env: Record<string, string | undefined> = process.env): GeminiConfig | null {
  const apiKey = env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === "your-gemini-api-key") return null;
  const model = env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
  if (!/^[a-z0-9][a-z0-9.\-]{1,62}$/.test(model)) return null;
  return { apiKey, model, baseUrl: (env.GEMINI_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, ""), timeoutMs: TIMEOUT_MS };
}

export type GeminiErrorCode =
  | "GEMINI_AUTH"
  | "GEMINI_RATE_LIMIT"
  | "GEMINI_TIMEOUT"
  | "GEMINI_UNREACHABLE"
  | "GEMINI_BLOCKED"
  | "GEMINI_BAD_OUTPUT"
  | "GEMINI_ERROR";

export class GeminiError extends Error {
  code: GeminiErrorCode;
  constructor(code: GeminiErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

interface GenerateResponse {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  error?: { code?: number; status?: string; message?: string };
}

/**
 * One generateContent call that must return JSON matching `schema`. The key is sent
 * in the x-goog-api-key header (not the URL) so it cannot leak through request logs.
 */
export async function generateJson(
  config: GeminiConfig,
  req: { system: string; prompt: string; schema: Record<string, unknown>; maxOutputTokens?: number },
  fetchImpl: typeof fetch = fetch,
): Promise<unknown> {
  const url = `${config.baseUrl}/v1beta/models/${encodeURIComponent(config.model)}:generateContent`;
  const body = {
    systemInstruction: { parts: [{ text: req.system }] },
    contents: [{ role: "user", parts: [{ text: req.prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseJsonSchema: req.schema,
      maxOutputTokens: req.maxOutputTokens ?? 512,
    },
  };
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": config.apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch (err) {
    const timeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    throw new GeminiError(timeout ? "GEMINI_TIMEOUT" : "GEMINI_UNREACHABLE", timeout ? "Gemini did not answer in time." : "Could not reach Gemini.");
  }
  let data: GenerateResponse = {};
  try {
    data = (await res.json()) as GenerateResponse;
  } catch {
    // handled below
  }
  if (!res.ok) {
    const code: GeminiErrorCode = res.status === 401 || res.status === 403 ? "GEMINI_AUTH" : res.status === 429 ? "GEMINI_RATE_LIMIT" : "GEMINI_ERROR";
    // Gemini error messages do not contain the key; keep only the status for logs.
    throw new GeminiError(code, `Gemini returned HTTP ${res.status}${data.error?.status ? ` (${data.error.status})` : ""}.`);
  }
  if (data.promptFeedback?.blockReason) throw new GeminiError("GEMINI_BLOCKED", `Gemini blocked the request (${data.promptFeedback.blockReason}).`);
  const candidate = data.candidates?.[0];
  if (!candidate || candidate.finishReason !== "STOP") {
    throw new GeminiError(candidate?.finishReason === "SAFETY" ? "GEMINI_BLOCKED" : "GEMINI_BAD_OUTPUT", `Gemini did not finish (${candidate?.finishReason ?? "no candidate"}).`);
  }
  const text = (candidate.content?.parts ?? []).map((p) => p.text ?? "").join("");
  try {
    return JSON.parse(text);
  } catch {
    throw new GeminiError("GEMINI_BAD_OUTPUT", "Gemini did not return valid JSON.");
  }
}

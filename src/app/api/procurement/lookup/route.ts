import {
  buildGoal,
  buildSearchUrl,
  normalizeResult,
  validateLookupRequest,
  type LookupError,
  type LookupResponse,
} from "@/lib/procurement";
import { getTinyFishApiKey, runTinyFish } from "@/lib/tinyfish.server";

const STATUS_BY_CODE: Record<LookupError["code"], number> = {
  INVALID_REQUEST: 400,
  UNKNOWN_SUPPLIER: 400,
  MISSING_API_KEY: 503,
  PROVIDER_AUTH: 502,
  PROVIDER_CREDITS: 502,
  PROVIDER_RATE_LIMIT: 503,
  PROVIDER_TIMEOUT: 504,
  PROVIDER_UNREACHABLE: 502,
  PROVIDER_ERROR: 502,
  LOOKUP_FAILED: 502,
};

function errorResponse(error: LookupError) {
  return Response.json({ ok: false, error } satisfies LookupResponse, {
    status: STATUS_BY_CODE[error.code],
  });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse({ code: "INVALID_REQUEST", message: "Request body must be valid JSON." });
  }

  // Validate supplier and part before anything touches TinyFish.
  const validated = validateLookupRequest(body);
  if (!validated.ok) return errorResponse(validated.error);
  const { partName, supplier } = validated;

  const apiKey = getTinyFishApiKey();
  if (!apiKey) {
    return errorResponse({
      code: "MISSING_API_KEY",
      message: "TINYFISH_API_KEY is not set. Add it to .env.local and restart the dev server.",
    });
  }

  const started = Date.now();
  const outcome = await runTinyFish({
    apiKey,
    url: buildSearchUrl(supplier, partName),
    goal: buildGoal(supplier, partName),
    browserProfile: supplier.browserProfile,
  });
  const durationMs = Date.now() - started;

  if (!outcome.ok) {
    console.error(`[procurement] ${supplier.id} lookup failed after ${durationMs}ms: ${outcome.error.code}`);
    return errorResponse(outcome.error);
  }

  const result = normalizeResult({
    raw: outcome.result,
    partName,
    supplier,
    runId: outcome.runId,
    steps: outcome.steps,
    durationMs,
  });
  return Response.json({ ok: true, result } satisfies LookupResponse);
}

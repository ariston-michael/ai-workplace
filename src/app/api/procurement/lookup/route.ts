import { validateLookupRequest, type LookupError, type LookupResponse } from "@/lib/procurement";
import { lookupPart, procurementMode } from "@/lib/procurement-provider.server";

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

// Uses the fixture unless PROCUREMENT_MODE=live, so local testing spends no TinyFish credits.
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

  const mode = procurementMode();
  const response = await lookupPart(partName, supplier, mode);
  if (!response.ok) {
    console.error(`[procurement] ${supplier.id} ${mode} lookup failed: ${response.error.code}`);
    return errorResponse(response.error);
  }
  return Response.json(response);
}

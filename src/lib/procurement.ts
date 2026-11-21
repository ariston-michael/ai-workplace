// Procurement Researcher: supplier allowlist, request validation, TinyFish goal
// construction and result normalization. Pure logic only (no env, no network)
// so it can be unit-tested with `node --test` and shared with the client for
// types and the public supplier list.

export type BrowserProfile = "lite" | "stealth";

export interface Supplier {
  id: string;
  name: string;
  /** Hostnames (and their subdomains) that count as this supplier's own pages. */
  allowedHosts: string[];
  /** Approved public search URL; the part name is substituted for {query}. */
  searchUrlTemplate: string;
  browserProfile: BrowserProfile;
}

/** Server-owned list of approved public supplier sites. The client only ever sends an `id`. */
export const SUPPLIERS: readonly Supplier[] = [
  {
    id: "adafruit",
    name: "Adafruit",
    allowedHosts: ["adafruit.com"],
    searchUrlTemplate: "https://www.adafruit.com/search?q={query}",
    browserProfile: "lite",
  },
  {
    id: "sparkfun",
    name: "SparkFun Electronics",
    allowedHosts: ["sparkfun.com"],
    searchUrlTemplate: "https://www.sparkfun.com/catalogsearch/result/?q={query}",
    browserProfile: "lite",
  },
  {
    id: "digikey",
    name: "Digi-Key",
    allowedHosts: ["digikey.com"],
    searchUrlTemplate: "https://www.digikey.com/en/products/result?keywords={query}",
    // Digi-Key rejects plain automated clients; TinyFish docs recommend stealth for SITE_BLOCKED.
    browserProfile: "stealth",
  },
];

export interface PublicSupplier {
  id: string;
  name: string;
}

export function publicSuppliers(): PublicSupplier[] {
  return SUPPLIERS.map(({ id, name }) => ({ id, name }));
}

export function findSupplier(id: string): Supplier | undefined {
  return SUPPLIERS.find((s) => s.id === id);
}

export function buildSearchUrl(supplier: Supplier, partName: string): string {
  return supplier.searchUrlTemplate.replace("{query}", encodeURIComponent(partName));
}

export function isSupplierUrl(supplier: Supplier, candidate: string): boolean {
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  return supplier.allowedHosts.some((h) => host === h || host.endsWith(`.${h}`));
}

// ---------------------------------------------------------------------------
// Request validation
// ---------------------------------------------------------------------------

export const PART_NAME_MIN = 2;
export const PART_NAME_MAX = 100;

export type LookupErrorCode =
  | "INVALID_REQUEST"
  | "UNKNOWN_SUPPLIER"
  | "MISSING_API_KEY"
  | "PROVIDER_AUTH"
  | "PROVIDER_CREDITS"
  | "PROVIDER_RATE_LIMIT"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_UNREACHABLE"
  | "PROVIDER_ERROR"
  | "LOOKUP_FAILED";

export interface LookupError {
  code: LookupErrorCode;
  message: string;
}

export type ValidatedRequest =
  | { ok: true; partName: string; supplier: Supplier }
  | { ok: false; error: LookupError };

export function validateLookupRequest(body: unknown): ValidatedRequest {
  if (typeof body !== "object" || body === null) {
    return invalid("INVALID_REQUEST", "Request body must be a JSON object.");
  }
  const { partName, supplierId } = body as Record<string, unknown>;

  if (typeof supplierId !== "string" || supplierId.length === 0) {
    return invalid("INVALID_REQUEST", "supplierId is required.");
  }
  const supplier = findSupplier(supplierId);
  if (!supplier) {
    return invalid("UNKNOWN_SUPPLIER", `Supplier "${supplierId.slice(0, 40)}" is not on the approved list.`);
  }

  if (typeof partName !== "string") {
    return invalid("INVALID_REQUEST", "partName is required.");
  }
  // Collapse whitespace and drop control characters before length checks.
  const cleaned = partName.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (cleaned.length < PART_NAME_MIN || cleaned.length > PART_NAME_MAX) {
    return invalid(
      "INVALID_REQUEST",
      `partName must be between ${PART_NAME_MIN} and ${PART_NAME_MAX} characters.`,
    );
  }
  return { ok: true, partName: cleaned, supplier };
}

function invalid(code: LookupErrorCode, message: string): ValidatedRequest {
  return { ok: false, error: { code, message } };
}

// ---------------------------------------------------------------------------
// TinyFish goal
// ---------------------------------------------------------------------------

export function buildGoal(supplier: Supplier, partName: string): string {
  return [
    `You are checking the public ${supplier.name} website for a replacement part.`,
    `Requested part: ${JSON.stringify(partName)}.`,
    `The page you start on is ${supplier.name}'s search results for that part. If results do not appear, use the site's own search box.`,
    `Rules: stay on ${supplier.allowedHosts.join(" / ")}. Do not log in, add to cart, or submit any form other than site search. Do not guess.`,
    "Steps:",
    "1. Review the search results and decide whether one listing clearly matches the requested part.",
    "2. If exactly one clearly matches, open its product page and read the item name, stock/availability text, price and SKU or part number exactly as shown.",
    "3. If several listings plausibly match and you cannot tell which is meant, do not pick one; list up to 5 of them.",
    "4. If nothing matches, say so.",
    "Return ONLY a JSON object with these keys:",
    '{"match_status": "exact" | "close" | "ambiguous" | "not_found",',
    ' "item_name": string | null,',
    ' "product_url": string | null  (full https URL of the product page you read),',
    ' "availability_status": "in_stock" | "out_of_stock" | "backorder" | "preorder" | "discontinued" | "unknown",',
    ' "availability_text": string | null  (verbatim text shown on the page),',
    ' "price": string | null,',
    ' "sku": string | null,',
    ' "candidates": [{"name": string, "url": string}],',
    ' "notes": string[]  (anything uncertain: variants, regional stock, missing info, pages that failed to load)}',
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Result normalization
// ---------------------------------------------------------------------------

export type MatchStatus = "exact" | "close" | "ambiguous" | "not_found";
export type Availability =
  | "in_stock"
  | "out_of_stock"
  | "backorder"
  | "preorder"
  | "discontinued"
  | "unknown";

const MATCH_STATUSES: MatchStatus[] = ["exact", "close", "ambiguous", "not_found"];
const AVAILABILITIES: Availability[] = [
  "in_stock",
  "out_of_stock",
  "backorder",
  "preorder",
  "discontinued",
  "unknown",
];

export interface Candidate {
  name: string;
  url: string | null;
}

export type LookupMode = "live" | "sample";

export interface LookupResult {
  /** "live" = observed on the supplier site via TinyFish; "sample" = fixture data, never observed. */
  mode: LookupMode;
  partName: string;
  supplier: PublicSupplier;
  match: MatchStatus;
  itemName: string | null;
  availability: Availability;
  availabilityText: string | null;
  price: string | null;
  sku: string | null;
  /** Link the operator should open to verify. Always on the supplier's own domain. */
  sourceUrl: string;
  /** True when sourceUrl is the product page TinyFish reported, false when it's the search page fallback. */
  sourceIsProductPage: boolean;
  candidates: Candidate[];
  uncertainties: string[];
  runId: string | null;
  steps: number | null;
  durationMs: number;
  checkedAt: string;
}

export type LookupResponse = { ok: true; result: LookupResult } | { ok: false; error: LookupError };

/**
 * TinyFish returns `result` as an object (or null). Depending on how the agent
 * answered, the object we asked for may be the result itself, nested one level
 * down, or a JSON string. Find the first object that looks like our shape.
 */
export function extractAgentPayload(raw: unknown, depth = 0): Record<string, unknown> | null {
  if (depth > 3 || raw === null || raw === undefined) return null;
  if (typeof raw === "string") {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    const text = (fenced ? fenced[1] : raw).trim();
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    try {
      return extractAgentPayload(JSON.parse(text.slice(start, end + 1)), depth + 1);
    } catch {
      return null;
    }
  }
  if (Array.isArray(raw)) {
    return raw.length === 1 ? extractAgentPayload(raw[0], depth + 1) : null;
  }
  if (typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if ("match_status" in obj || "item_name" in obj || "availability_status" in obj) return obj;
    for (const value of Object.values(obj)) {
      const found = extractAgentPayload(value, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function str(value: unknown, max = 300): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

export interface NormalizeInput {
  raw: unknown;
  partName: string;
  supplier: Supplier;
  runId: string | null;
  steps: number | null;
  durationMs: number;
  checkedAt?: string;
  /** Defaults to "live". Fixture data must pass "sample". */
  mode?: LookupMode;
}

export function normalizeResult(input: NormalizeInput): LookupResult {
  const { raw, partName, supplier } = input;
  const uncertainties: string[] = [];
  const payload = extractAgentPayload(raw);
  const searchUrl = buildSearchUrl(supplier, partName);

  if (!payload) {
    uncertainties.push(
      "TinyFish completed but did not return the structured answer requested; treat this lookup as unverified and check the supplier page manually.",
    );
  }
  const p = payload ?? {};

  let match: MatchStatus = MATCH_STATUSES.includes(p.match_status as MatchStatus)
    ? (p.match_status as MatchStatus)
    : "ambiguous";
  if (payload && !MATCH_STATUSES.includes(p.match_status as MatchStatus)) {
    uncertainties.push("The agent did not state whether the listing matched; treated as ambiguous.");
  }

  let availability: Availability = AVAILABILITIES.includes(p.availability_status as Availability)
    ? (p.availability_status as Availability)
    : "unknown";

  const itemName = str(p.item_name);
  const availabilityText = str(p.availability_text);
  const price = str(p.price, 60);
  const sku = str(p.sku, 80);

  const candidates: Candidate[] = Array.isArray(p.candidates)
    ? p.candidates
        .map((c): Candidate | null => {
          if (typeof c === "string") return { name: c.slice(0, 200), url: null };
          if (typeof c !== "object" || c === null) return null;
          const rec = c as Record<string, unknown>;
          const name = str(rec.name, 200);
          if (!name) return null;
          const url = str(rec.url, 500);
          return { name, url: url && isSupplierUrl(supplier, url) ? url : null };
        })
        .filter((c): c is Candidate => c !== null)
        .slice(0, 5)
    : [];

  // Only link to pages on the approved supplier's own domain.
  const reportedUrl = str(p.product_url, 1000);
  let sourceUrl = searchUrl;
  let sourceIsProductPage = false;
  if (reportedUrl && isSupplierUrl(supplier, reportedUrl)) {
    sourceUrl = reportedUrl;
    sourceIsProductPage = true;
  } else if (reportedUrl) {
    uncertainties.push(
      `The agent reported a product link outside ${supplier.name}'s site; it was discarded and the search page is linked instead.`,
    );
  }

  if ((match === "exact" || match === "close") && !itemName) {
    uncertainties.push("A match was reported without an item name; treated as ambiguous.");
    match = "ambiguous";
  }
  if (match === "not_found") {
    availability = "unknown";
    uncertainties.push(`No listing for "${partName}" was found on ${supplier.name}.`);
  } else if (match === "ambiguous") {
    uncertainties.push(
      candidates.length > 0
        ? `Several ${supplier.name} listings could match "${partName}"; choose one before ordering.`
        : `The ${supplier.name} result for "${partName}" is ambiguous.`,
    );
  } else if (match === "close") {
    uncertainties.push("The closest listing is not an exact match for the requested part name; confirm specifications.");
  }

  if (match === "exact" || match === "close") {
    if (!sourceIsProductPage) uncertainties.push("No product page link was returned; verify via the search page.");
    if (availability === "unknown") uncertainties.push("Availability could not be determined from the page.");
    if (!price) uncertainties.push("No price was observed.");
  }

  if (Array.isArray(p.notes)) {
    for (const note of p.notes.slice(0, 5)) {
      const n = str(note, 300);
      if (n) uncertainties.push(`Agent note: ${n}`);
    }
  } else {
    const n = str(p.notes, 300);
    if (n) uncertainties.push(`Agent note: ${n}`);
  }

  const mode = input.mode ?? "live";
  if (mode === "sample") {
    uncertainties.unshift("SAMPLE fixture data. Nothing was observed on the supplier's live site and no TinyFish credits were used.");
  } else {
    uncertainties.push("Stock levels change quickly and may differ by region; this is a point-in-time observation.");
  }

  return {
    mode,
    partName,
    supplier: { id: supplier.id, name: supplier.name },
    match,
    itemName,
    availability,
    availabilityText,
    price,
    sku,
    sourceUrl,
    sourceIsProductPage,
    candidates,
    uncertainties,
    runId: input.runId,
    steps: input.steps,
    durationMs: input.durationMs,
    checkedAt: input.checkedAt ?? new Date().toISOString(),
  };
}

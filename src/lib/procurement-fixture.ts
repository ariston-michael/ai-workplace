// Procurement fixture: returns TinyFish-shaped agent output without any network
// call, so development and tests use zero TinyFish credits. The output goes
// through the same normalizeResult() as live data and is labeled "sample".
//
// Part names containing "zz" or "not found" -> not_found
// Part names containing "ambiguous"          -> ambiguous with two candidates
// Anything else                              -> exact match, in stock (sample)

import { buildSearchUrl, type Supplier } from "./procurement.ts";

export interface FixtureRun {
  run_id: string;
  status: "COMPLETED";
  num_of_steps: number;
  result: Record<string, unknown>;
  error: null;
}

export function fixtureRun(partName: string, supplier: Supplier): FixtureRun {
  const lower = partName.toLowerCase();
  const note = "Sample fixture. Not observed on the live site.";
  let result: Record<string, unknown>;

  if (lower.includes("zz") || lower.includes("not found")) {
    result = {
      match_status: "not_found",
      item_name: null,
      product_url: null,
      availability_status: "unknown",
      availability_text: null,
      price: null,
      sku: null,
      candidates: [],
      notes: [note],
    };
  } else if (lower.includes("ambiguous")) {
    result = {
      match_status: "ambiguous",
      item_name: null,
      product_url: null,
      availability_status: "unknown",
      availability_text: null,
      price: null,
      sku: null,
      candidates: [
        { name: `${partName} (variant A)`, url: buildSearchUrl(supplier, `${partName} A`) },
        { name: `${partName} (variant B)`, url: buildSearchUrl(supplier, `${partName} B`) },
      ],
      notes: [note],
    };
  } else {
    result = {
      match_status: "exact",
      item_name: partName,
      product_url: null,
      availability_status: "in_stock",
      availability_text: "In stock (sample fixture)",
      price: null,
      sku: null,
      candidates: [],
      notes: [note],
    };
  }

  return { run_id: "fixture", status: "COMPLETED", num_of_steps: 0, result, error: null };
}

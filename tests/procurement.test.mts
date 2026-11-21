import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildSearchUrl,
  findSupplier,
  isSupplierUrl,
  normalizeResult,
  validateLookupRequest,
} from "../src/lib/procurement.ts";

const adafruit = findSupplier("adafruit")!;

test("rejects unknown supplier IDs", () => {
  const r = validateLookupRequest({ partName: "Raspberry Pi 5", supplierId: "evil.example.com" });
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.error.code, "UNKNOWN_SUPPLIER");
});

test("rejects a URL passed as supplierId", () => {
  const r = validateLookupRequest({ partName: "x1", supplierId: "https://www.adafruit.com" });
  assert.equal(!r.ok && r.error.code, "UNKNOWN_SUPPLIER");
});

test("rejects missing or bad part names", () => {
  for (const partName of [undefined, "", " a ", "x".repeat(101), 42]) {
    const r = validateLookupRequest({ partName, supplierId: "adafruit" });
    assert.equal(!r.ok && r.error.code, "INVALID_REQUEST", `partName=${String(partName)}`);
  }
  assert.equal(validateLookupRequest(null).ok, false);
});

test("accepts and cleans a valid request", () => {
  const r = validateLookupRequest({ partName: "  Raspberry\tPi   5 ", supplierId: "adafruit" });
  assert.ok(r.ok);
  assert.equal(r.partName, "Raspberry Pi 5");
  assert.equal(r.supplier.id, "adafruit");
});

test("search URL stays on the approved host and encodes the part", () => {
  const url = buildSearchUrl(adafruit, "Pi 5 & fan?");
  assert.equal(url, "https://www.adafruit.com/search?q=Pi%205%20%26%20fan%3F");
  assert.ok(isSupplierUrl(adafruit, url));
});

test("isSupplierUrl only accepts https on the supplier domain", () => {
  assert.ok(isSupplierUrl(adafruit, "https://adafruit.com/product/5813"));
  assert.ok(!isSupplierUrl(adafruit, "http://www.adafruit.com/product/5813"));
  assert.ok(!isSupplierUrl(adafruit, "https://adafruit.com.evil.io/product"));
  assert.ok(!isSupplierUrl(adafruit, "https://notadafruit.com/"));
  assert.ok(!isSupplierUrl(adafruit, "javascript:alert(1)"));
});

const base = { partName: "Raspberry Pi 5 4GB", supplier: adafruit, runId: "run_1", steps: 7, durationMs: 1000 };

test("normalizes an exact match", () => {
  const r = normalizeResult({
    ...base,
    raw: {
      match_status: "exact",
      item_name: "Raspberry Pi 5 - 4 GB RAM",
      product_url: "https://www.adafruit.com/product/5812",
      availability_status: "in_stock",
      availability_text: "In stock",
      price: "$60.00",
      sku: "5812",
      candidates: [],
      notes: [],
    },
  });
  assert.equal(r.mode, "live");
  assert.equal(r.match, "exact");
  assert.equal(r.availability, "in_stock");
  assert.equal(r.sourceUrl, "https://www.adafruit.com/product/5812");
  assert.ok(r.sourceIsProductPage);
});

test("unwraps nested or stringified agent output", () => {
  const inner = { match_status: "exact", item_name: "Pi", product_url: "https://www.adafruit.com/product/1" };
  assert.equal(normalizeResult({ ...base, raw: { result: inner } }).itemName, "Pi");
  assert.equal(
    normalizeResult({ ...base, raw: { text: "Here you go:\n```json\n" + JSON.stringify(inner) + "\n```" } }).itemName,
    "Pi",
  );
});

test("discards off-domain product links", () => {
  const r = normalizeResult({
    ...base,
    raw: { match_status: "exact", item_name: "Pi", product_url: "https://scam.example/pi" },
  });
  assert.equal(r.sourceIsProductPage, false);
  assert.equal(r.sourceUrl, buildSearchUrl(adafruit, base.partName));
  assert.ok(r.uncertainties.some((u) => u.includes("outside Adafruit")));
});

test("reports not-found and ambiguous explicitly", () => {
  const nf = normalizeResult({ ...base, raw: { match_status: "not_found", availability_status: "in_stock" } });
  assert.equal(nf.match, "not_found");
  assert.equal(nf.availability, "unknown");
  assert.ok(nf.uncertainties.some((u) => u.startsWith("No listing")));

  const amb = normalizeResult({
    ...base,
    raw: {
      match_status: "ambiguous",
      candidates: [
        { name: "Pi 5 4GB", url: "https://www.adafruit.com/product/5812" },
        { name: "Pi 5 8GB", url: "https://elsewhere.com/x" },
      ],
    },
  });
  assert.equal(amb.match, "ambiguous");
  assert.equal(amb.candidates.length, 2);
  assert.equal(amb.candidates[1].url, null);
});

test("unstructured output is treated as ambiguous and unverified", () => {
  const r = normalizeResult({ ...base, raw: null });
  assert.equal(r.match, "ambiguous");
  assert.ok(r.uncertainties.some((u) => u.includes("unverified")));
});

test("exact match without item name is downgraded", () => {
  const r = normalizeResult({ ...base, raw: { match_status: "exact" } });
  assert.equal(r.match, "ambiguous");
});

import { createHash } from "node:crypto";
import { CSV_MAX_LENGTH, type InventoryConfig, type InventoryAuditResult } from "./types.ts";

/** A real, bounded local action. No fixture, provider, shell, or creator code. */
export function auditInventory(csv: string, config: InventoryConfig): InventoryAuditResult {
  if (!csv.trim() || csv.length > CSV_MAX_LENGTH) throw new Error(`Submit an inventory CSV of 1–${CSV_MAX_LENGTH} characters.`);
  if (!Number.isSafeInteger(config.minimumQuantity) || !Number.isSafeInteger(config.targetQuantity) || config.minimumQuantity < 1 || config.targetQuantity < config.minimumQuantity || config.targetQuantity > 100000) throw new Error("Invalid inventory thresholds.");
  const records: string[][] = [];
  const lines: number[] = [];
  let lineNumber = 1;
  let record: string[] = [], field = "", quoted = false, closed = false;
  // CSV with quoted commas and escaped quotes. Embedded newlines are rejected
  // to keep the line number in the evidence identical to the submitted file.
  for (let i = 0; i <= csv.length; i++) {
    const c = csv[i] ?? "\n";
    if (quoted) {
      if (c === '"' && csv[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { quoted = false; closed = true; }
      else if (c === "\r" || c === "\n") throw new Error("Quoted values cannot span multiple lines.");
      else field += c;
    } else if (c === '"') {
      if (field || closed) throw new Error("Unexpected quote in CSV.");
      quoted = true;
    } else if (c === "," || c === "\n" || c === "\r") {
      record.push(field.trim()); field = ""; closed = false;
      if (c !== ",") {
        if (record.some(value => value.length)) { records.push(record); lines.push(lineNumber); }
        lineNumber++;
        record = [];
        if (c === "\r" && csv[i + 1] === "\n") i++;
      }
    } else { if (closed && c.trim()) throw new Error("Unexpected text after a quoted value."); field += c; }
  }
  if (quoted) throw new Error("CSV has an unclosed quote.");
  if (records.length < 2 || records.length > 501) throw new Error("Use a header and 1–500 inventory rows.");
  if (records[0].length !== 2 || records[0][0].toLowerCase().replace(/^\uFEFF/, "") !== "sku" || records[0][1].toLowerCase() !== "quantity") throw new Error("CSV header must be sku,quantity.");
  const seen = new Set<string>();
  const rows = records.slice(1).map(([sku, value, ...extra], index) => {
    const line = lines[index + 1];
    if (!sku || sku.length > 120 || !value || extra.length || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > 1000000000) throw new Error(`Row ${line}: use a unique SKU and a whole quantity from 0 to 1,000,000,000.`);
    if (seen.has(sku.toLowerCase())) throw new Error(`Row ${line}: duplicate SKU ${sku}.`);
    seen.add(sku.toLowerCase());
    const quantity = Number(value), lowStock = quantity < config.minimumQuantity;
    return { line, sku, quantity, lowStock, restockUnits: lowStock ? config.targetQuantity - quantity : 0 };
  });
  return { inputSha256: createHash("sha256").update(csv).digest("hex"), ...config, rowCount: rows.length,
    lowStockCount: rows.filter(row => row.lowStock).length, totalRestockUnits: rows.reduce((sum, row) => sum + row.restockUnits, 0), rows };
}

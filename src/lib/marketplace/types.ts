import type { CharacterId } from "../workplace/characters.ts";
export interface InventoryConfig { minimumQuantity: number; targetQuantity: number }
export interface ListingDetails {
  creatorName: string;
  publisherKind: "company" | "community";
  official: boolean;
  avatarId: CharacterId;
  supportedAction: "inventory_audit" | "supplier_lookup" | "catalog_search";
  configuration: InventoryConfig | null;
  createdAt: number;
}
export interface InventoryAuditResult {
  inputSha256: string;
  minimumQuantity: number;
  targetQuantity: number;
  rowCount: number;
  lowStockCount: number;
  totalRestockUnits: number;
  rows: { line: number; sku: string; quantity: number; lowStock: boolean; restockUnits: number }[];
}
export const INVENTORY_PERMISSIONS = ["Reads only the inventory CSV submitted to this job", "Calculates low stock and restock quantities locally", "No network, purchases, or access to other workspaces"];
export const CSV_MAX_LENGTH = 50000;

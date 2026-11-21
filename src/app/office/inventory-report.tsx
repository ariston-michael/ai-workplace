import type { InventoryAuditResult } from "@/lib/marketplace/types";
import "./inventory-report.css";
export default function InventoryReport({ result }: { result: InventoryAuditResult }) {
  return <section className="inventory-report" aria-label="Inventory audit evidence">
    <p className="inventory-source">EXECUTED LOCALLY · calculated from your submitted CSV</p>
    <h3>Inventory audit</h3><p>{result.rowCount} SKUs checked · {result.lowStockCount} below minimum · {result.totalRestockUnits} restock units.</p>
    <p>Low stock means quantity below {result.minimumQuantity}. Flagged items are replenished to {result.targetQuantity}; items at or above the minimum are left unchanged.</p>
    <div className="inventory-table"><table><caption>Evidence from the submitted inventory</caption><thead><tr><th>CSV line</th><th>SKU</th><th>Quantity</th><th>Finding</th><th>Restock</th></tr></thead><tbody>{result.rows.map(row => <tr key={row.line}><td>{row.line}</td><th scope="row">{row.sku}</th><td>{row.quantity}</td><td>{row.lowStock ? "Low stock" : "At or above minimum"}</td><td>{row.restockUnits}</td></tr>)}</tbody></table></div>
    <p className="inventory-digest">Submitted CSV SHA-256 <code>{result.inputSha256}</code></p><p>No purchases were made. The listing’s creator cannot see this job, input, or report.</p>
  </section>;
}

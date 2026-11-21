import { createHash } from "node:crypto";
import type { Db } from "../workplace/db.server.ts";
import { getOwnedWorkspace } from "../workplace/service.server.ts";
import { createLinkCode, handleInboundSms, type SmsDeps } from "./sms.server.ts";
export const simulatedSmsEnabled = () => process.env.SMS_MODE === "simulated";
function identity(ws: string, owner: string) {
  const hash = createHash("sha256").update(`${owner}\0${ws}`).digest("hex");
  return `+999${(BigInt('0x' + hash.slice(0, 16)) % BigInt(1000000000000)).toString().padStart(12, '0')}`;
}
export function simulationMessages(db: Db, ws: string, owner: string) {
  if (!getOwnedWorkspace(db, ws, owner)) throw new Error("Workspace unavailable.");
  const phone = identity(ws, owner);
  return db.prepare(`SELECT * FROM (
    SELECT message_sid AS id, reply AS body, received_at AS at FROM sms_inbound WHERE phone = ? AND kind <> 'linked' AND reply IS NOT NULL
    UNION ALL SELECT 'result-' || id AS id, body, created_at AS at FROM sms_outbox WHERE workspace_id = ? AND phone = ?
  ) ORDER BY at DESC, id DESC LIMIT 20`).all(phone, ws, phone);
}
/** A private, owner-scoped demo channel. It never calls a carrier API. */
export async function simulateSms(db: Db, deps: SmsDeps, ws: string, owner: string, text: string, requestId: string) {
  if (!simulatedSmsEnabled() || !getOwnedWorkspace(db, ws, owner)) throw new Error("Simulated SMS unavailable.");
  const phone = identity(ws, owner);
  const linked = db.prepare("SELECT workspace_id, owner_sub FROM sms_links WHERE phone = ?").get(phone);
  if (linked && (linked.workspace_id !== ws || linked.owner_sub !== owner)) throw new Error("Simulated channel unavailable.");
  if (!linked) {
    const code = createLinkCode(db, deps.now(), ws, owner);
    await handleInboundSms(db, deps, { messageSid: 'SM' + createHash('sha256').update(`link:${ws}:${owner}:${code.code}`).digest('hex').slice(0, 32), from: phone, body: `LINK ${code.code}` });
  }
  return handleInboundSms(db, deps, { messageSid: 'SM' + createHash('sha256').update(`${ws}:${owner}:${requestId}`).digest('hex').slice(0, 32), from: phone, body: text });
}

// Shapes returned by /api/workplace and rendered by /office.

import type { InventoryAuditResult } from "../marketplace/types.ts";
import type { JobType, SkillId, WorkerProfile } from "./catalog.ts";
import type { InventoryConfig } from "../marketplace/types.ts";
import type { LookupMode, LookupResult } from "../procurement.ts";
import type { Incident } from "../camera-incident.ts";
import type { MarketplaceListing } from "./marketplace.ts";
import type { SpriteSpec } from "./sprites.ts";

export type JobStatus = "needs_worker" | "queued" | "working" | "completed" | "failed";
export type ReportMode = "live" | "sample" | "simulated" | "local";
export type ReportOutcome = "found" | "close" | "ambiguous" | "not_found" | "resolved" | "incident_open" | "audited";

export type JobInput =
  | { partName: string; supplierId: string; supplierName: string; request?: string }
  | { station: string; request?: string }
  | { csv: string; request?: string };

export type ReportBody =
  | { type: "inventory_audit"; result: InventoryAuditResult; listingName: string }
  | { type: "supplier_lookup"; result: LookupResult }
  | {
      type: "camera_incident";
      incident: Incident;
      /** Fault chosen in the simulator controls. Recorded for the operator; the Inspector never sees it. */
      simulatorFault?: string;
    };

export type Retention = "team" | "job";

export interface HireEventView {
  at: number;
  kind: string;
  text: string;
  jobId: string | null;
}

export interface HireView {
  id: string;
  profileId: string;
  permissions: string[];
  role: string;
  initials: string;
  color: WorkerProfile["color"];
  specialty: string;
  skills: SkillId[];
  hourlyRateCents: number | null;
  source: "staff" | "marketplace";
  desk: string;
  hiredAt: number;
  activeJobId: string | null;
  completedJobs: number;
  /** Snapshot from the listing at hire time: the same character the marketplace showed. */
  characterName: string;
  sprite: SpriteSpec;
  /** null for built-in staff. */
  listingKind: "official" | "community" | null;
  publisherName: string | null;
  greeting: string;
  actionConfig: InventoryConfig | null;
  /** "team" = kept on team (reused for later jobs). "job" = leaves after `jobId`'s report. */
  retention: Retention;
  /** The job this worker was hired for, if any. */
  jobId: string | null;
  instructions: string;
  /** Set once the worker has left the office. Its jobs and reports stay in history. */
  departedAt: number | null;
  /** Newest last. Saved in this workspace only. */
  history: HireEventView[];
}

export interface DispatcherInfo {
  /** "gemini" when GEMINI_API_KEY is set; otherwise the built-in keyword rules. */
  engine: "gemini" | "rules";
  model: string | null;
}

export interface ReportView {
  id: string;
  mode: ReportMode;
  outcome: ReportOutcome;
  summary: string;
  body: ReportBody;
  runtimeMs: number;
  hourlyRateCents: number | null;
  demoCostCents: number | null;
  createdAt: number;
}

export interface JobEventView {
  at: number;
  actor: string;
  text: string;
}

export interface JobView {
  id: string;
  type: JobType;
  title: string;
  input: JobInput;
  requiredSkill: SkillId;
  status: JobStatus;
  hireId: string | null;
  hireRole: string | null;
  /** Character name from the hire's snapshot, kept after the worker leaves. */
  hireName: string | null;
  /** Set when the job was requested by text: its job code and the masked phone. */
  sms?: { code: string; phone: string; simulated?: boolean } | null;
  recommendedProfileId: string | null;
  createdAt: number;
  assignedAt: number | null;
  startedAt: number | null;
  finishedAt: number | null;
  error: { code: string; message: string } | null;
  events: JobEventView[];
  report: ReportView | null;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  createdAt: number;
  teamSize: number;
  totalJobs: number;
  openJobs: number;
}

export interface WorkplaceState {
  workspaceId: string;
  workspace: { id: string; name: string };
  procurementMode: LookupMode;
  /** Workers in the office now. */
  team: HireView[];
  /** Workers who left (job-only or released), newest first, max 20. Their jobs and reports remain. */
  formerHires: HireView[];
  dispatcher: DispatcherInfo;
  jobs: JobView[];
  marketplace: (MarketplaceListing & { hired: boolean })[];
  simulator: { cameraFault: string };
}

export interface ApiError {
  code: string;
  message: string;
}

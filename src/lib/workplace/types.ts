// Shapes returned by /api/workplace and rendered by /office.

import type { JobType, SkillId, WorkerProfile } from "./catalog.ts";
import type { LookupMode, LookupResult } from "../procurement.ts";
import type { Incident } from "../camera-incident.ts";

export type JobStatus = "needs_worker" | "queued" | "working" | "completed" | "failed";
export type ReportMode = "live" | "sample" | "simulated";
export type ReportOutcome = "found" | "close" | "ambiguous" | "not_found" | "resolved" | "incident_open";

export type JobInput =
  | { partName: string; supplierId: string; supplierName: string; request?: string }
  | { station: string; request?: string };

export type ReportBody =
  | { type: "supplier_lookup"; result: LookupResult }
  | {
      type: "camera_incident";
      incident: Incident;
      /** Fault chosen in the simulator controls. Recorded for the operator; the Inspector never sees it. */
      simulatorFault?: string;
    };

export interface HireView {
  id: string;
  profileId: string;
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
  team: HireView[];
  jobs: JobView[];
  marketplace: (WorkerProfile & { hired: boolean })[];
  simulator: { cameraFault: string };
}

export interface ApiError {
  code: string;
  message: string;
}

// Skills, job types and worker profiles for the AI Workplace.
// Marketplace profiles are product data; a workspace *hire* (stored in SQLite)
// snapshots the profile's role, skills and rate at hire time.

export type SkillId = "supplier_research" | "camera_diagnostics" | "visual_inspection" | "catalog_search" | "inventory_audit";

export const SKILLS: Record<SkillId, string> = {
  supplier_research: "Supplier research",
  camera_diagnostics: "Camera feed diagnostics",
  visual_inspection: "Visual inspection",
  catalog_search: "Internal catalog search",
  inventory_audit: "Inventory audit",
};

export type JobType = "supplier_lookup" | "camera_incident" | "inventory_audit";

export interface JobTypeInfo {
  label: string;
  requiredSkill: SkillId;
  /** The posting the Dispatcher drafts when nobody on the team has the skill. */
  posting: { deliverable: string; allowedSources: string; needsApproval: string };
}

export const JOB_TYPES: Record<JobType, JobTypeInfo> = {
  inventory_audit: { label: "Audit inventory CSV", requiredSkill: "inventory_audit", posting: { deliverable: "Low-stock evidence and calculated restock quantities.", allowedSources: "Only the CSV submitted to this job; executed locally.", needsApproval: "Hiring the worker and submitting the inventory CSV." } },
  supplier_lookup: {
    label: "Find a replacement part",
    requiredSkill: "supplier_research",
    posting: {
      deliverable: "Sourcing brief: item name, observed availability, source link and uncertainties.",
      allowedSources: "Approved public supplier websites only (Adafruit, SparkFun, Digi-Key).",
      needsApproval: "Hiring the worker. No purchases, logins or carts are allowed.",
    },
  },
  camera_incident: {
    label: "Camera feed stopped (simulated)",
    requiredSkill: "camera_diagnostics",
    posting: {
      deliverable: "Incident report: observations, action taken, whether a visit is needed.",
      allowedSources: "Packing Station 1 observations (simulated in this demo).",
      needsApproval: "Hiring the worker. Technician visits are requested, not booked.",
    },
  },
};

export interface WorkerProfile {
  id: string;
  role: string;
  initials: string;
  color: "coral" | "sage" | "gold" | "blue";
  specialty: string;
  skills: SkillId[];
  /** Demo hourly rate in cents; null for built-in staff that is not billed. */
  hourlyRateCents: number | null;
  sampleWork: string;
  permissions: string[];
  /** Marketplace listings only: official (verified) or community (published by a user). */
  kind?: "official" | "community";
}

/** Workers available to hire. */
export const MARKETPLACE: WorkerProfile[] = [
  {
    id: "catalog_assistant",
    role: "Catalog Assistant",
    initials: "CA",
    color: "gold",
    specialty: "Find the right part in your internal records.",
    skills: ["catalog_search"],
    hourlyRateCents: 400,
    sampleWork: "Matched 40 tray components to internal part numbers.",
    permissions: ["Reads internal catalog records"],
  },
  {
    id: "procurement_researcher",
    role: "Procurement Researcher",
    initials: "PR",
    color: "blue",
    specialty: "Research replacement parts across public supplier websites.",
    skills: ["supplier_research"],
    hourlyRateCents: 600,
    sampleWork: "Source-linked availability check for a Raspberry Pi 5 on a public supplier site.",
    permissions: ["Browses approved public supplier sites via TinyFish", "Cannot log in, add to cart or purchase"],
  },
];

/** Built-in staff seeded into every new workspace. */
export const STAFF: WorkerProfile[] = [
  {
    id: "quality_inspector",
    role: "Quality Inspector",
    initials: "QI",
    color: "sage",
    specialty: "Watches Packing Station 1, diagnoses camera feed problems and flags missing parts.",
    skills: ["camera_diagnostics", "visual_inspection"],
    hourlyRateCents: null,
    sampleWork: "Simulated camera incident reports for Packing Station 1.",
    permissions: ["Reads Packing Station 1 status", "Requests camera service restarts", "Creates technician tasks"],
  },
];

export const DISPATCHER = {
  role: "Dispatcher",
  initials: "DI",
  color: "coral" as const,
  specialty: "The first stop for every job. Checks the team's skills and routes work or recommends a hire.",
};

export function findProfile(id: string): WorkerProfile | undefined {
  return [...MARKETPLACE, ...STAFF].find((p) => p.id === id);
}

export function formatRate(cents: number | null): string {
  return cents === null ? "Included" : `$${(cents / 100).toFixed(2)} / hour`;
}

export function formatCost(cents: number | null): string {
  if (cents === null) return "—";
  return `$${(cents / 100).toFixed(2)}`;
}

/** Bill active run time by the second: $6/hour for 90 s = $0.15. */
export function demoCostCents(hourlyRateCents: number | null, runtimeMs: number): number | null {
  if (hourlyRateCents === null) return null;
  return Math.round((hourlyRateCents * Math.ceil(runtimeMs / 1000)) / 3600);
}

/** Desks a marketplace hire can occupy, in order. Workstation 01 is staff. */
export const HIRE_DESKS = ["desk-02", "desk-03"] as const;
export const STAFF_DESK = "workstation-01";

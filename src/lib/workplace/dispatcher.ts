// The Dispatcher's routing decision. Pure: given a job type and the current
// team, either assign an existing hire or recommend a marketplace worker.

import { JOB_TYPES, MARKETPLACE, SKILLS, type JobType, type SkillId, type WorkerProfile } from "./catalog.ts";
import { recommendationOrder } from "./marketplace.ts";

export interface TeamMember {
  id: string;
  profileId: string;
  role: string;
  skills: SkillId[];
  hiredAt: number;
}

export type RoutingDecision =
  | { kind: "assign"; requiredSkill: SkillId; hire: TeamMember; note: string }
  | {
      kind: "needs_worker";
      requiredSkill: SkillId;
      recommended: WorkerProfile | null;
      qualified: WorkerProfile[];
      note: string;
    };

export function qualifiedProfiles(skill: SkillId, marketplace: WorkerProfile[] = MARKETPLACE): WorkerProfile[] {
  // Official (verified) workers first, then the cheapest.
  return marketplace.filter((p) => p.skills.includes(skill)).sort(recommendationOrder);
}

export function routeJob(type: JobType, team: TeamMember[], marketplace: WorkerProfile[] = MARKETPLACE): RoutingDecision {
  const requiredSkill = JOB_TYPES[type].requiredSkill;
  const skillName = SKILLS[requiredSkill];
  const teamSkills = [...new Set(team.flatMap((m) => m.skills))].map((s) => SKILLS[s]);
  const checked = `Needs: ${skillName}. Team skills: ${teamSkills.length ? teamSkills.join(", ") : "none"}.`;

  // Earliest qualified hire first, so repeat jobs go to the same worker.
  const hire = [...team].sort((a, b) => a.hiredAt - b.hiredAt).find((m) => m.skills.includes(requiredSkill));
  if (hire) {
    return { kind: "assign", requiredSkill, hire, note: `${checked} ${hire.role} is already on the team.` };
  }

  const qualified = qualifiedProfiles(requiredSkill, marketplace);
  const recommended = qualified[0] ?? null;
  return {
    kind: "needs_worker",
    requiredSkill,
    recommended,
    qualified,
    note: recommended
      ? `${checked} Nobody on the team has ${skillName}. Recommending ${recommended.role} from the marketplace${recommended.kind === "community" ? " (community listing, not verified)" : ""}.`
      : `${checked} Nobody on the team or in the marketplace has ${skillName}.`,
  };
}

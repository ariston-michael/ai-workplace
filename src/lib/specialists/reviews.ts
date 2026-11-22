/** Shared action contracts and demo text. No provider or infrastructure access. */
export const REVIEW_MAX_LENGTH = 50000;
export const HEALTH_MAX_LENGTH = 10000;
export type ReviewAction = "pull_request_review" | "deployment_review";
export type PullRequestInput = { diff: string; request?: string };
export type DeploymentInput = { logs: string; healthChecks: string; request?: string };
export type ReviewInput = PullRequestInput | DeploymentInput;
export interface ReviewEvidence { source: string; line: number; side?: "old" | "new"; text: string }
export interface ReviewFinding {
  title: string;
  impact: string;
  confidence: "high" | "medium" | "low";
  evidence: ReviewEvidence[];
  suggestedTests: string[];
}
export interface ReviewResult {
  action: ReviewAction;
  method: "local-rules-v1";
  demoInput: boolean;
  inputSha256: string;
  summary: string;
  findings: ReviewFinding[];
  observations: ReviewEvidence[];
  uncertainties: string[];
  nextSteps: string[];
}
export const DEMO_DIFF = `diff --git a/src/api/preview.ts b/src/api/preview.ts
--- a/src/api/preview.ts
+++ b/src/api/preview.ts
@@ -1,3 +1,4 @@
 export function preview(input: string) {
-  return JSON.parse(input);
+  const result = eval(input);
+  return result;
 }
`;
export const DEMO_LOGS = `2026-11-22T10:00:00Z app starting on port 3000
2026-11-22T10:00:01Z database: SQLITE_CANTOPEN: unable to open database file /var/lib/office/workplace.db
2026-11-22T10:00:02Z readiness: database connection unavailable`;
export const DEMO_HEALTH = `GET /api/health -> 503 Service Unavailable
Body: {"ok":false,"error":"Database unavailable"}
Check executed after the startup error; host permissions and mount configuration were not captured.`;
export const REVIEW_ACTIONS = {
  pull_request_review: {
    skill: "pull_request_review", role: "Software Engineer", title: "Pull request diff review", button: "Review diff",
    inputs: "A pasted unified pull request diff with file headers and @@ line ranges. No repository connection is needed.",
    example: "src/api/preview.ts:2 — eval(input) can execute supplied code. Impact: untrusted input could run as the app. Test: submit executable text and verify it is rejected. This excerpt alone cannot establish input trust.",
  },
  deployment_review: {
    skill: "deployment_review", role: "Cloud Infrastructure Engineer", title: "Deployment evidence review", button: "Review deployment evidence",
    inputs: "Pasted deployment logs and health-check output. Include timestamps, HTTP status and response text when available. Missing evidence is flagged.",
    example: "deployment.log:2 — SQLITE_CANTOPEN; health-check.txt:1 — HTTP 503. Likely cause: database path unavailable to the app. Next: inspect the mounted path and runtime user permissions. Mount configuration was not supplied, so the root cause is unconfirmed.",
  },
} as const;
export function reviewActionFor(skills: readonly string[]): ReviewAction | null {
  return skills.includes("pull_request_review") ? "pull_request_review" : skills.includes("deployment_review") ? "deployment_review" : null;
}
export function parseReviewInput(action: ReviewAction, raw: Record<string, unknown>): ReviewInput {
  if (action === "pull_request_review") {
    if (typeof raw.diff !== "string" || !raw.diff.trim() || raw.diff.length > REVIEW_MAX_LENGTH) throw new Error(`Submit a unified diff of 1–${REVIEW_MAX_LENGTH} characters.`);
    if (!/^--- .+\r?$/m.test(raw.diff) || !/^\+\+\+ .+\r?$/m.test(raw.diff) || !/^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/m.test(raw.diff)) throw new Error("Use a unified diff with --- / +++ file headers and @@ line ranges.");
    return { diff: raw.diff };
  }
  const logs = raw.logs ?? "", healthChecks = raw.healthChecks ?? "";
  if (typeof logs !== "string" || typeof healthChecks !== "string" || logs.length > REVIEW_MAX_LENGTH || healthChecks.length > HEALTH_MAX_LENGTH || (!logs.trim() && !healthChecks.trim())) throw new Error(`Submit deployment logs (up to ${REVIEW_MAX_LENGTH} characters) or health-check output (up to ${HEALTH_MAX_LENGTH}).`);
  return { logs, healthChecks };
}

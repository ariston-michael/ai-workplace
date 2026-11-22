import { createHash } from "node:crypto";
import { DEMO_DIFF, DEMO_LOGS, DEMO_HEALTH, parseReviewInput, type ReviewAction, type ReviewEvidence, type ReviewFinding, type ReviewResult } from "./reviews.ts";

const digest = (s: string) => createHash("sha256").update(s).digest("hex");
const clip = (s: string) => s.slice(0,300);
/** Text analysis only: no eval, shell, network, filesystem reads or remote model. */
export function reviewDiff(diff: string): ReviewResult {
  parseReviewInput("pull_request_review", { diff });
  const findings: ReviewFinding[] = [];
  const files = new Set<string>();
  const observations: ReviewEvidence[] = [];
  let file = "", oldFile = "", line = 0, inHunk = false, newRemaining = 0, oldRemaining = 0;
  let additions = 0;
  const rules = [
    { pattern: /\beval\s*\(|\bnew\s+Function\s*\(/, title: "Dynamic code execution", impact: "If this expression receives untrusted data, supplied text can execute with the application's permissions.", confidence: "high" as const, tests: ["Pass executable text as input and verify it is rejected or parsed as data, never executed.", "Cover valid input, malformed input and the boundary that establishes input trust."] },
    { pattern: /rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*[\"']?0/, title: "TLS certificate verification disabled", impact: "Disabling certificate verification can allow an untrusted server or interception to be accepted.", confidence: "high" as const, tests: ["Verify a self-signed or wrong-host certificate is rejected and the intended trusted endpoint still works."] },
    { pattern: /\.innerHTML\s*=|dangerouslySetInnerHTML\s*=/, title: "HTML injection sink added", impact: "If the value contains untrusted markup without effective sanitization, script-capable content may reach the page. The excerpt does not prove exploitability.", confidence: "medium" as const, tests: ["Render untrusted HTML containing event handlers and verify it is escaped or sanitized.", "Trace where the assigned value is validated."] },
    { pattern: /(?:SELECT|INSERT|UPDATE|DELETE)\b.*\$\{/, title: "Interpolated SQL text", impact: "If interpolated values are untrusted, building SQL text can permit query injection. The query execution and parameter binding context are not established by this line.", confidence: "medium" as const, tests: ["Exercise quotes and SQL metacharacters and confirm values are bound as parameters, never interpreted as SQL."] },
  ];
  for (const raw of diff.replace(/\r\n/g,"\n").split("\n")) {
    if (raw.startsWith("diff --git ")) { if (newRemaining || oldRemaining) throw new Error("A diff hunk is incomplete."); inHunk = false; continue; }
    // Header markers can also be literal added/removed text inside a hunk.
    if (!inHunk && raw.startsWith("--- ")) { oldFile = raw.slice(4).split("\t")[0].replace(/^a\//,""); continue; }
    if (!inHunk && raw.startsWith("+++ ")) { file = raw.slice(4).split("\t")[0].replace(/^b\//,""); files.add(file === "/dev/null" ? oldFile : file); continue; }
    const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(raw);
    if (hunk) { if (newRemaining || oldRemaining) throw new Error("A diff hunk is incomplete."); oldRemaining = Number(hunk[2] ?? 1); line = Number(hunk[3]); newRemaining = Number(hunk[4] ?? 1); inHunk = true; continue; }
    if (!inHunk || !file || raw.startsWith("\\")) continue;
    if (raw.startsWith("+")) {
      const text = raw.slice(1); additions++;
      if (observations.length < 12) observations.push({ source: file, line, side: "new", text: clip(text) });
      if (!/^\s*(?:\/\/|\/\*|\*|#)/.test(text)) for (const rule of rules) if (rule.pattern.test(text)) findings.push({ title: rule.title, impact: rule.impact, confidence: rule.confidence, evidence: [{ source: file, line, side: "new", text: clip(text) }], suggestedTests: rule.tests });
      line++; newRemaining--;
    } else if (raw.startsWith("-")) { oldRemaining--; }
    else if (raw.startsWith(" ")) { line++; newRemaining--; oldRemaining--; }
    else if (raw !== "") throw new Error("Malformed unified diff hunk: expected added, removed or context lines.");
    if (newRemaining < 0 || oldRemaining < 0) throw new Error("Unified diff line counts do not match the hunk header.");
    if (!newRemaining && !oldRemaining) inHunk = false;
  }
  if (newRemaining || oldRemaining) throw new Error("The final diff hunk is incomplete. Include its full line range.");
  if (!files.size) throw new Error("No file headers could be read from this diff.");
  return { action: "pull_request_review", method: "local-rules-v1", demoInput: diff === DEMO_DIFF, inputSha256: digest(diff),
    summary: `${findings.length} potential finding${findings.length === 1 ? "" : "s"} across ${files.size} changed file${files.size === 1 ? "" : "s"}; ${additions} added lines inspected.`, findings, observations,
    uncertainties: ["This bounded rules-based review checks added lines for dynamic code execution, disabled TLS verification, HTML injection sinks and interpolated SQL. It is not a complete semantic, security or correctness review.", "Only the submitted diff was available. Full files, dependencies, caller trust, removed-line behavior and runtime behavior were not verified.", ...(findings.length ? [] : ["No supported patterns were detected. This does not establish that the pull request is safe or correct."])],
    nextSteps: ["Run the existing tests for each changed file and add regression cases for the findings. No tests were executed by this worker.", "Have a reviewer inspect full-file context and deletion-only changes before approving the pull request."] };
}

export function reviewDeployment(logs: string, healthChecks: string): ReviewResult {
  parseReviewInput("deployment_review", { logs, healthChecks });
  const evidence: ReviewEvidence[] = [ ...logs.split(/\r?\n/).map((text,i) => ({source:"deployment.log",line:i+1,text:clip(text)})), ...healthChecks.split(/\r?\n/).map((text,i) => ({source:"health-check.txt",line:i+1,text:clip(text)})) ].filter(e => e.text.trim());
  const rules = [
    { pattern: /SQLITE_CANTOPEN|unable to open database file/i, title: "Database path unavailable to the application", impact: "The process reports that SQLite cannot open its database. A missing mount, missing parent directory or permissions can cause this; the logs do not distinguish them.", next: "Inspect the configured database path, its mounted parent directory and the runtime user's read/write permissions. Do not change ownership or delete the database until the mismatch is confirmed." },
    { pattern: /callback URL mismatch/i, title: "Auth0 callback URL is not allowed", impact: "Auth0 rejected the callback presented by the app; users cannot finish this sign-in attempt.", next: "Decode redirect_uri from a fresh login redirect and compare it with Allowed Callback URLs in the Auth0 application identified by client_id." },
    { pattern: /EADDRINUSE|address already in use/i, title: "Application listen port is already occupied", impact: "The recorded process cannot bind its requested address. A second process or conflicting listen configuration is a likely explanation.", next: "Inspect which process owns the requested address and port, and compare it with the app's listen configuration before stopping anything." },
    { pattern: /ChunkLoadError|Loading chunk .*failed|\/_next\/static\/.*(?:404|500)/i, title: "Frontend assets may not match the running build", impact: "A referenced frontend asset failed to load. Mixed build files, a stale browser/CDN cache or proxy routing are possible; the evidence does not isolate one.", next: "Compare the failing asset URL with the running build's static files and release ID, then inspect its HTTP response and proxy path." },
    { pattern: /ECONNREFUSED|connection refused/i, title: "A connection target is not accepting connections", impact: "The logged connection was refused. The destination may be down, listening elsewhere, or configured incorrectly; this is not proof of a firewall problem.", next: "Identify the destination host and port from the complete error, then compare them with the target service's listener and health-check configuration." },
    { pattern: /ENOTFOUND|name or service not known/i, title: "A hostname could not be resolved", impact: "The resolver could not find a requested name. A typo, missing record or resolver configuration may be involved.", next: "Compare the exact requested hostname with the configured service/DNS record and inspect resolution from the application's environment." },
    { pattern: /OOMKilled|out of memory|heap out of memory/i, title: "Memory exhaustion was reported", impact: "The evidence records a memory failure, but it does not establish whether the workload, a leak or the configured limit caused it.", next: "Compare memory limits and recent peak usage with the failure timestamp and process restart history." },
  ];
  const findings: ReviewFinding[] = rules.flatMap(rule => {
    const matched = evidence.filter(e => rule.pattern.test(e.text));
    return matched.length ? [{title:rule.title,impact:rule.impact,confidence:"medium" as const,evidence:matched,suggestedTests:[rule.next]}] : [];
  });
  const healthEvidence = evidence.filter(e => e.source === "health-check.txt").slice(0,8);
  // Health output is saved as context, not treated as proof of a causal relationship.
  for (const finding of findings) finding.evidence.push(...healthEvidence.filter(e => !finding.evidence.some(m => m.source === e.source && m.line === e.line)));
  const uncertainties = ["Only submitted text was reviewed. No host, cloud account, deployment, network or live health endpoint was accessed; no diagnostic command was run.", "Timestamp alignment, topology, deployment configuration and recovery state are not verified. A likely cause is a hypothesis, not a confirmed root cause."];
  if (!logs.trim()) uncertainties.push("Deployment logs were not supplied; health results alone do not establish a root cause.");
  if (!healthChecks.trim()) uncertainties.push("Health-check results were not supplied; service availability and the endpoint response are unknown.");
  if (!findings.length) uncertainties.push("No supported diagnostic signature was found. The available evidence is insufficient to identify a likely cause.");
  return {action:"deployment_review",method:"local-rules-v1",demoInput:logs===DEMO_LOGS && healthChecks===DEMO_HEALTH,inputSha256:digest(JSON.stringify({logs,healthChecks})),observations:evidence.slice(0,8).concat(healthEvidence.filter(e=>!evidence.slice(0,8).includes(e))),summary:findings.length ? `Likely cause: ${findings[0].title}. ${findings.length > 1 ? "Multiple signals are present; their relationship is unconfirmed." : "Root cause remains unconfirmed."}` : "Likely cause undetermined from the supplied evidence.",findings,uncertainties,nextSteps:findings.length ? findings.map(f=>f.suggestedTests[0]) : ["Collect timestamped startup/error logs, the exact health URL, status and response body, and the matching deployment configuration. Compare them before choosing a repair."]};
}
export function executeReview(action: ReviewAction, raw: Record<string, unknown>): ReviewResult {
  const input = parseReviewInput(action, raw);
  return "diff" in input ? reviewDiff(input.diff) : reviewDeployment(input.logs,input.healthChecks);
}

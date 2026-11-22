# Read-only engineering specialists

The official Marketplace now includes Nia (Software Engineer, demo $12/hour) and
Ash (Cloud Infrastructure Engineer, demo $14/hour). Both use the existing listing,
hire snapshot, workspace-specific action endpoint, queued job runner, report row,
worker movement and saved workflow history. No new database schema is required.
Their pixel characters use the existing enumerated sprite parts.

## Demonstration on port 3003

Sign in at `/`. Create a fresh workspace if your current office has no room for
two more retained workers. Open Marketplace, expand a specialist's sample work
and permissions, and hire it into that workspace. Click its worker in the office,
choose **Use demo input**, and submit the review. **View report** opens the saved
report in the worker panel; **View latest job's workflow** opens its private
history. Reload the workflow URL to reopen the same report. Repeat with the other
specialist. Both hires fit in a fresh office alongside the built-in Inspector.

## What actually runs

- `pull_request_review` parses unified diff headers/hunk line counts and checks
  added lines for dynamic code execution, disabled TLS verification, HTML injection
  sinks and interpolated SQL. Findings include file/added-line evidence, possible
  impact, confidence and suggested tests. It rejects incomplete hunks. It is a
  bounded rules-based review, not full semantic analysis or an approval. Deleted
  behavior and repository-wide context require human follow-up.
- `deployment_review` scans submitted logs/health text for SQLite path failures,
  Auth0 callback mismatch, occupied ports, failed frontend chunks, refused
  connections, DNS failures and memory exhaustion. Reports cite source/line
  excerpts, retain health output as context, propose a diagnostic step and flag
  absent or incomplete evidence. Matching messages do not prove root cause.

These are real deterministic local actions. They do not fetch URLs, call a model,
execute submitted code/tests/commands, read repositories, or access cloud services.
Results are labeled **EXECUTED LOCALLY · READ-ONLY**. Exact built-in example text
also gets **DEMO INPUT**; user text is not mislabeled as a simulation or live check.
Existing SAMPLE procurement and SIMULATED camera labels remain unchanged.

Submitted inputs, job events, results and input SHA-256 are saved in the owning
workspace. Existing owner checks cover jobs and history; a listing creator does
not gain access. A hire must have the relevant skill and be retained to accept a
direct task. Request IDs and runner claims keep retries from creating duplicate
reports. Generic structured jobs can also recommend either specialist and resume
on hire approval through the existing Dispatcher routing.

## Verification

`npm test`, `npm run lint`, `npm run build`, `npm run typecheck`,
`npm run test:specialists`, `npm run test:navigation`, `npm run test:integration`.

The specialist production-browser check uses a temporary SQLite database and two
SDK-encrypted test sessions, with no live credentials. It exercises Marketplace →
hire → worker → demo input → real review → report → saved history → reload, and
checks workspace privacy on desktop/mobile WebKit and desktop Chromium. Unit
checks cover exact file/line evidence, malformed and incomplete diffs, missing
health evidence, uncertain causes, routing, idempotency and reopening the database.
Safari's application-level check remains manual; WebKit is not described as a
Safari application run.

## Eight next candidates using supported actions

These are profile suggestions, not eight additional implementations:

| Specialist | Supported task / action to reuse |
| --- | --- |
| Application Security Reviewer | Review submitted diffs for the supported dangerous-code, TLS, HTML and SQL patterns. |
| Frontend Safety Reviewer | Review added HTML injection sinks and propose rendering regression tests from the diff. |
| Regression Test Planner | Turn supported diff findings into targeted test suggestions; never execute tests. |
| Database Readiness Analyst | Triage SQLite startup/path failures against submitted health results. |
| Identity Integration Analyst | Diagnose recorded Auth0 callback mismatches and suggest the next configuration comparison. |
| Service Connectivity Analyst | Triage refused connections and DNS failures from submitted text. |
| Memory Incident Analyst | Review OOM/heap failure logs and suggest which limits and usage evidence to compare next. |
| Inventory Replenishment Analyst | Reuse the real inventory CSV audit to identify low stock and calculate restock quantities. |

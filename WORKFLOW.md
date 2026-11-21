# Read-only workflow history

The original `workflow-history` branch starts at `8144b9b`. The dashboard integration merges the workspace API from `workplace-core` commit `51c3ceb`.
The `/workflow?workspace=<id>&job=<id>` page lists the latest 50 saved jobs for the selected workspace and selects the linked job. The default workspace is `default`. Select a job to review
its structured request, exact saved Dispatcher events, worker evidence, saved
outcome and full job history. Refresh reloads the saved snapshot.

`GET /api/workflow` reads the existing SQLite file with `readOnly: true`. It does
not use `/api/workplace`, whose GET handler can recover and schedule jobs. It
never seeds staff, creates a database, runs jobs, recomputes routing, hires a
worker or calls a provider. An absent database produces the empty state.

The workflow preserves SAMPLE / FIXTURE, SIMULATED and LIVE report labels. A
saved camera report can be ready while its incident remains open; this is shown
in both the job list and outcome panel. Missing explanations or reports are
identified as missing instead of being inferred from the current team/catalog.

## Local preview

Use Node 22.13+ (Node 24 was used for verification). From this worktree:

```bash
npm ci
WORKPLACE_DB_PATH=/Users/aristonmichael/HW13/ai-workplace/data/workplace.db npm run dev -- --port 3003
```

Open http://localhost:3003/workflow. The absolute database path lets this isolated
worktree read the jobs saved by the original office. Change it to your existing
SQLite file as needed; without it, the default is `./data/workplace.db`.

Submit jobs in Claude's office, then refresh this page to review them. No form,
hiring action or reset control is added to `/workflow`. The integrated office layout is documented in `WORKSPACES.md`; Claude’s intake behavior is preserved.

## Verification

Run `npm test`, `npm run lint`, `npx next typegen`, `npm run typecheck`, and
`npm run build`. Route type generation is needed before type checking a fresh
worktree because the root layout uses Next.js's generated `LayoutProps` type.
Reader tests verify an absent database stays absent, empty databases are not
seeded, saved reports match the existing service's output, open camera incidents
stay open, workspaces are isolated, and queued/stale jobs are left untouched.

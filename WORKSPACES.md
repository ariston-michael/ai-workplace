# Workspaces dashboard and office integration

The landing page (`/`) lists saved workspaces from `GET /api/workspaces`.
Cards use original CSS office artwork and real saved names, team sizes, job counts
and open-job counts. Creating a workspace uses Claude's existing `POST` route.
Search filters the saved list; no sample workspaces are inserted by the UI.

Click a card to open `/office?workspace=<id>`. The map comes first. Reception
is beside the entrance, and the Dispatcher input remains Claude's free-text
conversation. Its draft and follow-ups stay mounted when inspecting another desk.
Hiring, simulator settings and resets use the selected workspace's API routes.
Simulator settings and the reset action are collapsed under **Demo controls**.
SAMPLE fixture and SIMULATED report labels remain visible.

Worker markers move only when saved worker events report a departure or return.
Queueing alone does not move them, historical events do not replay on page load,
and reduced-motion preferences disable travel animations. A worker already
working stays away if another job is queued for it.

Each job links to `/workflow?workspace=<id>&job=<id>`, selecting its saved history.
Workflow reads remain read-only; they neither run nor recover jobs, and they
never return another workspace's job. Camera reports distinguish report completion
from incident resolution.

## Preview

From this worktree, using Node 22.13+:

```bash
npm ci
WORKPLACE_DB_PATH=/Users/aristonmichael/HW13/ai-workplace/data/workplace.db npm run dev -- --port 3003
```

Open http://localhost:3003/. Set `WORKPLACE_DB_PATH` to your existing workplace
SQLite file when running from another machine. Without that override the worktree
uses `./data/workplace.db`. Claude's schema migration preserves earlier demo data
in the `default` workspace and creates a backup before migration.

## Verification

`npm test`, `npm run lint`, `npm run typecheck`, and `npm run build`.
For a fresh checkout, run `npx next typegen` before type checking.
Browser checks use an isolated temporary SQLite database and SAMPLE procurement;
they create actual saved workspaces and jobs without contacting TinyFish or
adding test records to the user's workspace database.

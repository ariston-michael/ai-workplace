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

The map uses subtle pixel-art furniture and people; forms and labels remain normal
sharp typography. Desks are about 15% narrower than the previous desktop map.
New hires walk through the entrance to their workstation. Saved Dispatcher
assignment/departure events send a worker back to its workstation, and a saved
ready report sends it to reception. Click the paper-badged worker there to read
the full saved report, with its fixture/simulation labels and workflow link.
A camera report can be ready while its incident is still open.

Furniture rendering and navigation share rectangles in `src/lib/workplace/office-map.ts`.
Routes are rectilinear, include sprite clearance, and avoid desks, other chairs,
plants, and the partition. A worker can sit in its own chair. Fast event sequences
are queued visually; animation never delays actual execution or changes billing.
Reloading places workers at their current station/reception without replaying old
walks. Reduced motion skips travel while preserving the correct final position.

Each job links to `/workflow?workspace=<id>&job=<id>`, selecting its saved history.
Workflow reads remain read-only; they neither run nor recover jobs, and they
never return another workspace's job. Camera reports distinguish report completion
from incident resolution.

## Preview

From this worktree, using Node 22.13+:

```bash
npm ci
WORKPLACE_DB_PATH=./data/workplace.db npm run dev -- --port 3007
```

Open http://localhost:3007/. This visual-refinement branch uses its own ignored
SQLite file. Keep it separate from databases upgraded by newer auth/backend
branches. The running production preview at http://localhost:3006/office?workspace=default
also uses an isolated SAMPLE database; no credentials or live provider calls are needed.

## Verification

`npm test`, `npm run lint`, `npm run typecheck`, and `npm run build`.
For a fresh checkout, run `npx next typegen` before type checking.
Browser checks use an isolated temporary SQLite database and SAMPLE procurement;
they create actual saved workspaces and jobs without contacting TinyFish or
adding test records to the user's workspace database.

The map tests cover entrance → workstation → reception routes at desktop and
narrow mobile sizes, including blocked paths. Browser checks sample rendered
sprite positions during hiring, assignment and return, then click the worker at
reception to verify the saved report.

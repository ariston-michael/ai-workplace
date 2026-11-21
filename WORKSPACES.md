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

## Signed-in preview

This integration branch starts at `office-pixel-map` (`e4339f0`) and merges
`auth0-login` (`c70b370`). Sign-in returns to `/`, the Workspaces dashboard.
Selecting a card opens that saved office's pixel map; click reception to talk to
the Dispatcher. The dashboard and office header show the signed-in account and
provide a full-page Auth0 logout link.

From this worktree, using Node 22.13+:

```bash
npm ci
# Configure the ignored .env.local using .env.example.
PROCUREMENT_MODE=sample npm run dev -- --port 3001
```

Set `APP_BASE_URL=http://localhost:3001` and the real Auth0 domain, client ID,
client secret and session secret in `.env.local`. Configure the Auth0 Regular Web
Application's Allowed Callback URLs with `http://localhost:3001/auth/callback`
and Allowed Logout URLs with `http://localhost:3001`.
Open http://localhost:3001/ and sign in. This worktree uses its own ignored
`./data/workplace.db` unless `WORKPLACE_DB_PATH` is set. Procurement stays in
SAMPLE fixture mode and spends no TinyFish credits.

Each account sees only its saved workspaces. First sign-in creates a personal
office. Pre-authentication offices remain unowned unless the operator explicitly
configures `WORKPLACE_DEMO_OWNER_EMAIL` for their intended owner's verified email.
History reads require an Auth0 session and check ownership in the same read-only
SQLite snapshot as the job query. They do not create, claim, recover or run jobs.
Unknown and foreign workspace APIs return 404; signed-out APIs return 401.
Signed-out dashboard, office and workflow pages redirect to login with their
original destination preserved.

### Test the combined flow

1. Sign in at `/`, create/select a workspace card, and click the Dispatcher at
   reception on its pixel map.
2. Ask “Find a Raspberry Pi 5 4GB on Adafruit”. Approve the recommended Procurement
   Researcher hire. Watch it enter through the door, visit its workstation, and
   return to reception. Click the worker to read its SAMPLE fixture report.
3. Submit another supplier request to reuse the hire. Check a second workspace:
   its team and reports stay separate. Each report links to its saved workflow.
4. Expand **Demo controls**, select Case 1b (restart succeeds, no fresh frame),
   and tell the Dispatcher the Packing Station 1 camera feed stopped. Click the
   returning Inspector: its SIMULATED report is ready, but the incident stays open.
5. Copy the office and job workflow URLs. In a separate private browser, sign in
   to a second Auth0 account. Its dashboard must omit the first account's offices.
   Pasted foreign office links show **OFFICE UNAVAILABLE** without a map, and
   foreign workflow links show an unavailable error without any report.

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

Integration verification: 124 Node tests, lint, TypeScript, and the production
build pass in fixture mode. Production browser checks used two independently
encrypted Auth0 SDK fixture sessions and an isolated temporary SQLite database;
no authentication bypass or fake identity endpoint was added to the app.
They verified account-scoped lists, direct office/workflow/job links, all scoped
mutation routes, anonymous redirects/401s, and the dashboard-to-Dispatcher flow.
Desktop (1440px), mobile (390px), and reduced-motion narrow mobile (320px)
checks verified hire/assignment/report movement, saved report selection,
workspace hiring, preserved Dispatcher drafts, reload, and zero furniture
collisions across more than 2,000 sampled positions. Auth0-hosted login with two
real accounts remains a manual check using the steps above.

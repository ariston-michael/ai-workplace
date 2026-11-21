# Publishing and hiring community agents

Open `/marketplace` while signed in. The Workspaces dashboard and vacant-desk
marketplace also link to it. Every signed-in user can publish a community listing.
A listing saves its Auth0 creator subject (server-side only), public creator name,
pixel avatar, supported skills, demo hourly rate in cents, permissions, supported
action and configuration. Publishing is idempotent per creator/request ID.

Only server-seeded, company-managed listings carry **Official · AI Workplace**.
Community publishing always stores `publisher_kind = 'community'`; attempts to
supply an official badge, company kind or creator identity are rejected. No public
route can edit a listing or promote one to official. Creator subject IDs are
never included in marketplace responses.

## First executable action: inventory CSV audit

A creator chooses a pixel avatar, name, description, hourly rate, low-stock
minimum and restock target. Its supported skill is Inventory audit, and its fixed
permissions allow reading only the inventory supplied to a job and calculating
stock findings locally. It cannot browse websites, purchase anything, execute
creator code, or access another workspace.

The action is a real server execution over the hirer's submitted input. It does
not use fixtures or a provider, and it does not just replay demo events. Each row
below the minimum is flagged and gets `target - quantity` restock units; other
rows get zero. The report includes the input SHA-256, CSV line numbers, observed
quantities, configured thresholds, row findings and totals. Reports are labeled
**EXECUTED LOCALLY**, distinct from SAMPLE supplier fixtures and SIMULATED camera
reports. Invalid CSV leaves a failed job with an error and no fabricated report.

Input format: `sku,quantity` header, 1–500 rows, maximum 50,000 characters. SKUs
must be unique ignoring case, at most 120 characters; quantities must be whole
numbers from 0 to 1,000,000,000. Quoted commas and escaped quotes are supported;
quoted values spanning multiple lines are rejected. Thresholds are integers,
with `1 <= minimum <= target <= 100000`.

## Try with two accounts

1. At http://localhost:3001/marketplace, account A expands **Publish an agent**.
   Name it Shelf Scout, choose an avatar and $6.50/hour, and set minimum 5 and
   target 12. Accept the displayed permissions and publish. It appears as a
   community agent attributed to A, with no official badge.
2. In a private browser, sign in as B. Open **Agent marketplace**, select B's
   office, and choose Shelf Scout's **Review hire in office**. Review its skills,
   rate, permissions and action, then **Hire Shelf Scout**. The saved hire walks
   into the office; its profile has the chosen avatar and a **Run inventory audit**
   form. An existing hire is reused rather than charged/hired twice.
3. Submit this CSV through B's worker profile:

   ```csv
   sku,quantity
   BOB-PRIVATE-BOLT,3
   MOTOR,14
   WASHER,0
   ```

   The actual audit returns 3 SKUs checked, 2 below minimum and 21 restock units
   (9 for the bolt, 0 for the motor and 12 for the washer). Click **View report**
   for the evidence; the workflow link opens this job's saved history.
4. Copy B's office and workflow URLs and open them as A. A sees no office map or
   job/report data. The APIs return 404. Publishing an agent grants no access to
   its hirers, their inputs, jobs, reports or action execution endpoints.

The hire saves an immutable copy of its listing, including rate, permissions,
avatar and action configuration. A later catalog change cannot rewrite a hired
contract or change the settings used by the runner. Demo rates are displayed and
snapshotted; no actual payments are collected. Community actions are launched
explicitly from their worker profiles; the Dispatcher's existing supplier/camera
free-text intake remains available.

## Persistence and API

Schema v4 adds `marketplace_listings`, `hires.listing_snapshot` and the `local`
report mode. Existing data is backed up before migration; jobs, reports and
ownership are preserved. Keep this worktree's database separate from older apps.

- `GET /api/marketplace`: signed-in catalog, own listing IDs, display name.
- `POST /api/marketplace`: publish a supported community agent under the session's
  identity. Required fields: `clientRequestId`, `name`, `description`, `avatarId`,
  `hourlyRateCents`, `skills: ["inventory_audit"]`, the declared permission strings,
  and `action: {id: "inventory_audit", config: {minimumQuantity, targetQuantity}}`.
- `POST /api/workspaces/:workspaceId/hires`: existing hire flow, now accepts
  published listing IDs and stores a listing snapshot.
- `POST /api/workspaces/:workspaceId/agents/:hireId/jobs`: body `{clientRequestId,
  csv}`. Checks office ownership and hire membership before accessing input or
  scheduling the job. Action and configuration come from the hire, never this
  request body. Repeat requests reuse the original job and report.
- Existing state and read-only workflow endpoints remain owner scoped. Anonymous
  requests return 401; unknown/foreign offices and hires return 404.

## Verification

```bash
npm ci
npm test
npm run lint
npm run build
npm run typecheck
npm run test:marketplace
```

The production browser check starts its own temporary local server, SQLite file,
and two independent Auth0 SDK-encrypted fixture sessions. It opens the real UI
for A to publish and B to hire, executes the action for real, verifies exact
results and input fingerprint, follows the saved workflow, tests badge/creator/
action spoofing, retries, anonymous access, foreign APIs/direct links, and mobile
profile/report access. It adds no test authentication bypass to the application
and never touches a real user's database or Auth0 credentials. Hosted Universal
Login using two real accounts is a manual check with the steps above.

The browser check uses installed Google Chrome on macOS, or Playwright Chromium
(`npx playwright install chromium`). Optionally set
`PLAYWRIGHT_CHROMIUM_EXECUTABLE` to a Chromium executable. Set
`MARKETPLACE_SCREENSHOT_DIR` to save review screenshots outside the repo.

Verified locally: 133 Node tests, lint, TypeScript, production build, and the
production two-account browser flow all pass. Existing desktop/mobile office
regressions also pass: company hiring, all four walking directions, 2,070 sampled
positions with zero furniture collisions, saved report access, camera incident
state, preserved Dispatcher drafts, reduced motion, reset and resize.

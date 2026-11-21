# Workplace API and data reference

For anyone building UI on top of the workplace service (e.g. the office UI). Source of truth for types: [src/lib/workplace/types.ts](../src/lib/workplace/types.ts). Schema: [src/lib/workplace/db.server.ts](../src/lib/workplace/db.server.ts).

## Sign-in and ownership

- Auth0 login via `@auth0/nextjs-auth0` v4. The proxy ([src/proxy.ts](../src/proxy.ts)) mounts `/auth/login`, `/auth/logout`, `/auth/callback`, `/auth/profile`. Link to them with plain `<a href>`, not `next/link`. `/auth/login?returnTo=/office` returns the user to the office after sign-in.
- Pages `/office` and `/procurement` redirect signed-out visitors to `/auth/login?returnTo=<page>`. `/` and `/simulator/camera` stay public.
- **Every** API route below (including the legacy `/api/workplace/*` routes and `/api/procurement/lookup`) requires a session and answers `401 UNAUTHENTICATED` without one. The browser sends the session cookie automatically; no token handling is needed in UI code.
- Each workspace has one owner (the Auth0 user `sub`). A user can only list, read or change their own workspaces. Someone else's workspace answers `404 WORKSPACE_NOT_FOUND`, exactly like a missing one.
- On first sign-in a user gets a personal office ("<first name>’s office").
- Offices created before sign-in existed (the migrated demo data) have no owner and are hidden. They are claimed by the user who signs in with the verified email in `WORKPLACE_DEMO_OWNER_EMAIL`.

## Concepts

- **Workspace** = one office. Every hire, job, job event, report and simulator setting belongs to exactly one workspace. Hiring, resetting or changing settings in one workspace never touches another.
- **`default`** holds the data migrated from before multi-workspace support. It belongs to the demo owner once claimed.
- The `/office` page selects a workspace with `?workspace=<id>`. Without it, `/office` opens the user's **primary** office (their `default` office if they own it, else their oldest office).
- Procurement runs on a **SAMPLE fixture** unless the server has `PROCUREMENT_MODE=live`. Camera jobs are always **SIMULATED**. Inventory audits are **EXECUTED LOCALLY** on the CSV the hirer submits. Reports carry `mode` so the UI can label them: `live` | `sample` | `simulated` | `local`.
- **Dispatcher engine.** With `GEMINI_API_KEY` set on the server, Gemini (`GEMINI_MODEL`, default `gemini-3.5-flash-lite`) interprets requests; otherwise built-in keyword rules do. Gemini only proposes the job type, part, supplier and follow-up wording; the server re-checks all of it. Gemini never chooses workers, hires, rates or permissions, and never receives inventory CSV contents (only whether one is attached). If Gemini fails, the rules answer and the response says why (`dispatcher.fallback`). See [src/lib/workplace/dispatcher-ai.server.ts](../src/lib/workplace/dispatcher-ai.server.ts).
- **Retention.** Each marketplace hire is either **kept on the team** (`retention: "team"`) or hired **for one job** (`"job"`). The Dispatcher reuses a qualified *kept* worker first. Approving a recommendation defaults to **For this job**; hiring from a vacant desk or the marketplace without a job keeps the worker. When a job finishes, the demo meter stops, the report is saved and the worker returns to reception; a job-only worker then leaves (its desk frees up), a kept worker returns to its desk. A departed hire's jobs and reports stay in workflow history.

## Routes

All bodies are JSON. Errors are always `{ ok: false, error: { code, message } }` with a 4xx status.

| Method | Path | Body | Success response |
|---|---|---|---|
| GET | `/api/workspaces` | — | `{ ok, viewer: { name, email }, primaryWorkspaceId, workspaces: WorkspaceSummary[] }` (only the caller's offices) |
| POST | `/api/workspaces` | `{ name }` (1–60 chars) | `201 { ok, workspace: WorkspaceSummary }` (owned by the caller) |
| GET | `/api/workspaces/{id}` | — | `{ ok, state: WorkplaceState }` |
| POST | `/api/workspaces/{id}/jobs` | `{ clientRequestId, request, pending?, csv? }` | see **Submitting a request** |
| POST | `/api/workspaces/{id}/hires` | `{ profileId, jobId?, retention?, instructions? }` | `{ ok, hireId, created, state }` |
| POST | `/api/workspaces/{id}/hires/{hireId}` | `{ retention?: "team" \| "job", instructions? }` | `{ ok, hireId, state }`: keep on team, release, or save instructions |
| POST | `/api/workspaces/{id}/agents/{hireId}/jobs` | `{ clientRequestId, csv }` | `{ ok, jobId, state }`: run a kept inventory worker's audit directly |
| POST | `/api/workspaces/{id}/simulator` | `{ cameraFault }` | `{ ok, state }` |
| POST | `/api/workspaces/{id}/reset` | — | `{ ok, state }` |
| GET | `/api/marketplace` | — | `{ ok, listings: MarketplaceListing[], workspaces: HireTarget[], viewer: { name, suggestedPublisherName } }` |
| POST | `/api/marketplace/listings` | `{ clientRequestId, listing: PublishDraft }` | `201 { ok, listing, created: true }`; a retry with the same id answers `200` with `created: false` |

Legacy aliases (same handlers and checks, applied to the **caller's primary office**): `GET /api/workplace`, `POST /api/workplace/{jobs,hires,simulator,reset}`. Prefer the `/api/workspaces/{id}` routes in new code.

`/api/procurement/lookup` is the standalone lookup test page's endpoint; it requires sign-in but is not workspace-scoped and does not create jobs.

### Submitting a request (`POST …/jobs`)

`request` is the user's free text ("What do you need help with?"). `csv` (optional, ≤ 50,000 chars, header `sku,quantity`) attaches a private inventory file; it is stored only on the job and never sent to Gemini. Every reply includes `dispatcher: { engine: "gemini" | "rules", model, fallback }`. The Dispatcher replies with one of:

| `kind` | Meaning | Response | UI should |
|---|---|---|---|
| `job` | Request understood; job created | `{ ok, kind, jobId, understood, state }` | Show `understood`; render `state` |
| `follow_up` | Details missing; **no job yet** | `{ ok, kind, question, pending }` | Show `pending.transcript`; send the answer as `request` with the same `pending` and the same `clientRequestId` |
| `unsupported` | No worker can handle it; **no job** | `{ ok, kind, message }` | Show `message` |

- `clientRequestId`: 8–100 chars of `[A-Za-z0-9_-]`. Use one per conversation (keep it across follow-ups, new one after a job is created). Resending the same id in the same workspace returns the original job instead of creating a duplicate.
- `pending` is opaque; send it back unchanged. The server re-validates everything in it.

### Hiring (`POST …/hires`)

- With `jobId`: approves a hire for a `needs_worker` job. `retention` defaults to `"job"`: the worker takes only that job, then leaves. With `"team"` the worker is kept, and **every** `needs_worker` job in the workspace needing its skills resumes.
- Without `jobId`: hire directly (vacant desk or marketplace). `retention` must be `"team"` (the default).
- `instructions` (≤ 1000 chars) are saved with the hire, shown in every job brief for it, and recorded in its history.
- Idempotent: approving the same job twice returns the worker already on it; hiring a listing already kept on the team returns that `hireId` with `created: false`. Two job-only copies of a listing may work at once; only one can be kept on the team (`409 ALREADY_ON_TEAM`).
- **Keep on team** later (while the job is queued or running): `POST …/hires/{hireId}` with `{ retention: "team" }`. **Release** a kept worker with `{ retention: "job" }`: it leaves now if idle, otherwise after its current report. Staff cannot be released.
- `profileId` is any `MarketplaceListing.id`: the official `procurement_researcher` and `catalog_assistant`, or a community id `community-<slug>-<suffix>`. A community agent can be approved for a held job if it has the job's skill (the user may pick it over the Dispatcher's recommendation).
- The hire **snapshots** the listing's `characterName`, `sprite`, `kind` and publisher name, as well as role, skills and rate. The office always draws the hire from that snapshot, so the character from the marketplace is the one that walks in.

### Marketplace (`/marketplace`)

The page reads these query parameters, which the office uses as links:

| Param | Meaning |
|---|---|
| `filter` | `official` or `community`; omitted = All |
| `workspace` | Office the user came from (empty desk). The picker preselects it. |
| `job` + `skill` | From a Dispatcher recommendation. Qualified listings sort first, others cannot be hired, and the picker is locked to `workspace` so the held job resumes. |

After a successful hire the page goes to `/office?workspace=<id>&arrived=<hireId>` (only when `created`). The office plays the entrance walk for that hire, then drops `arrived` from the URL so a reload does not replay it.

Listings are global (every signed-in user sees the same list). Hiring still goes through `POST /api/workspaces/{id}/hires`, so ownership checks are unchanged.

### Publishing (`POST /api/marketplace/listings`)

`listing` (all required):

| Field | Rule |
|---|---|
| `characterName` | 1–24 chars |
| `role` | 3–40 chars |
| `specialty` | 10–160 chars |
| `greeting` | 3–120 chars, said by the character when idle |
| `skills` | 1–3 `SkillId`s |
| `hourlyRateCents` | integer 100–5000 |
| `sampleWork` | 10–200 chars |
| `publisherName` | 1–40 chars, shown on the listing. "AI Workplace" is reserved. |
| `sprite` | `CustomSprite` (below); `kind: "cast"` is rejected |
| `actionConfig` | required when `skills` include `inventory_audit`: `{ minimumQuantity, targetQuantity }`, integers, `1 ≤ minimum ≤ target ≤ 100000` |

Submitting any of `official`, `verified`, `kind`, `publisherKind`, `publisher`, `creator`, `creatorSub`, `creatorName`, `badge`, `permissions` or `id` is rejected: the badge, kind, creator identity and permissions are set by the server.

Whitespace is collapsed. Errors answer `400 INVALID_LISTING` with `error.fields: { [field]: message }` for inline display. Each user can publish up to 12 listings (`409 LISTING_LIMIT`). There is no edit or unpublish route yet; existing hires keep their snapshot regardless.

### Simulator (`POST …/simulator`)

`cameraFault` is one of `service-stopped-recovers`, `service-stopped-no-frame`, `camera-missing`. It sets what the simulated Packing Station 1 reports for the **next** camera job in that workspace. Workers never receive it; the Quality Inspector decides from observations only. Default after create/reset: `service-stopped-recovers`.

### Polling

Jobs run after the response is sent. While any job is `queued` or `working`, poll `GET /api/workspaces/{id}` (the office UI polls every 1 s). That GET also restarts queued jobs whose runner was lost and fails jobs stuck in `working` for over 10 minutes (`INTERRUPTED`).

## Data fields

### `WorkspaceSummary`
| Field | Type | Notes |
|---|---|---|
| `id` | string | slug `[a-z0-9-]{1,64}`, derived from the name, made unique with a suffix |
| `name` | string | 1–60 chars |
| `createdAt` | number | ms since epoch |
| `teamSize` | number | hires including staff |
| `totalJobs` / `openJobs` | number | open = `needs_worker`, `queued`, `working` |

### `WorkplaceState`
| Field | Type | Notes |
|---|---|---|
| `workspace` | `{ id, name }` | |
| `workspaceId` | string | same as `workspace.id` (kept for older callers) |
| `procurementMode` | `"sample" \| "live"` | show a SAMPLE / LIVE badge |
| `dispatcher` | `{ engine: "gemini" \| "rules", model }` | show a Dispatcher badge |
| `team` | `HireView[]` | workers in the office now, ordered by hire time |
| `formerHires` | `HireView[]` | workers who left (newest first, max 20); animate their exit, keep their reports reachable |
| `jobs` | `JobView[]` | newest first, max 50 |
| `marketplace` | `(MarketplaceListing & { hired: boolean })[]` | `hired` = kept on this team |
| `simulator` | `{ cameraFault: string }` | |

### `MarketplaceListing`
Everything in `WorkerProfile` (`id`, `role`, `initials`, `color`, `specialty`, `skills`, `hourlyRateCents`, `sampleWork`, `permissions`) plus:

| Field | Type | Notes |
|---|---|---|
| `kind` | `"official" \| "community"` | filter key |
| `verified` | boolean | `true` only for official → blue pixel check (`VerifiedCheck`) |
| `characterName` | string | "Ro", "Kit", or the publisher's choice |
| `greeting` | string | idle line |
| `sprite` | `SpriteSpec` | render with `<PixelCharacter sprite={…} />` |
| `publisher` | `{ name, isYou }` | official = "AI Workplace". The publisher's Auth0 `sub` is never sent. |
| `publishedAt` | number \| null | null for official |
| `actionConfig` | `{ minimumQuantity, targetQuantity } \| null` | inventory audit thresholds |

`permissions` are derived on the server from `skills` (same text for official and community); publishers cannot set them. In `WorkplaceState.marketplace` each listing also has `hired` (per workspace).

### `SpriteSpec`
- `{ kind: "cast", id: "dispatcher" | "quality_inspector" | "procurement_researcher" | "catalog_assistant" }`: the hand-drawn official characters.
- `CustomSprite` `{ kind: "custom", skin, outfit, trim, hair, hairColor, accessory }`, each value a key from [src/lib/workplace/sprites.ts](../src/lib/workplace/sprites.ts): `skin` ∈ porcelain, sand, amber, umber, ebony; `outfit`/`trim` ∈ coral, teal, violet, amber, moss, navy, rose, slate; `hair` ∈ crop, long, bun, curls, cap, beanie, shaved; `hairColor` ∈ ink, chestnut, copper, honey, silver, plum; `accessory` ∈ none, glasses, satchel, tablet, toolbelt, badge. No free-form colours or markup.

### `HireTarget` (workspace picker)
`{ id, name, openDesks, hiredListingIds }` for each of the caller's offices. Disable a row when the listing is already hired there or `openDesks` is 0.

### `HireView`
Character, sprite, rate, permissions, greeting and `actionConfig` come from the hire's saved snapshot of its listing and never change after hiring. Fields: `id`, `profileId`, `role`, `characterName`, `greeting`, `permissions: string[]`, `actionConfig`, `retention: "team"|"job"`, `jobId` (the job it was hired for), `instructions`, `departedAt: number|null`, `history: { at, kind, text, jobId }[]` (kinds: `hired`, `instructions`, `assigned`, `kept`, `released`, `returned`, `at_desk`, `departed`), `sprite: SpriteSpec`, `listingKind: "official"|"community"|null` (null = staff), `publisherName: string|null`, `initials`, `color` (`coral|sage|gold|blue`), `specialty`, `skills: SkillId[]`, `hourlyRateCents: number|null` (null = staff, not billed), `source: "staff"|"marketplace"`, `desk: "workstation-01"|"desk-02"|"desk-03"`, `hiredAt`, `activeJobId: string|null`, `completedJobs: number`.

Desks are per workspace: every office has its own Workstation 01 (Quality Inspector), Desk 02 and Desk 03.

### `JobView`
| Field | Type | Notes |
|---|---|---|
| `id` | string | |
| `type` | `"supplier_lookup" \| "camera_incident" \| "inventory_audit"` | |
| `title` | string | camera titles never reveal the simulated fault |
| `input` | supplier: `{ partName, supplierId, supplierName, request? }`; camera: `{ station, request? }`; inventory: `{ csv, request? }` | `request` = user's original words; `csv` is private to the office |
| `requiredSkill` | `SkillId` | |
| `status` | `"needs_worker" \| "queued" \| "working" \| "completed" \| "failed"` | |
| `hireId` / `hireRole` / `hireName` | string \| null | assigned worker (kept after it leaves) |
| `recommendedProfileId` | string \| null | set while `needs_worker` |
| `createdAt`, `assignedAt`, `startedAt`, `finishedAt` | number \| null | ms |
| `error` | `{ code, message } \| null` | when `failed` |
| `events` | `{ at, actor, text }[]` | full history incl. the request conversation |
| `report` | `ReportView \| null` | when `completed` |

`working` means the worker has left its desk (animate departure); a report arriving means it returned to reception. Then a kept worker walks back to its desk and a job-only worker (`formerHires`, `departedAt` set) walks out. The demo meter runs from `startedAt` until `finishedAt`; the saved charge is `report.demoCostCents` (failed runs are not billed). Job events record "Execution finished. Demo meter stopped at …" and "Left the office …".

### `ReportView`
`id`, `mode: "live"|"sample"|"simulated"|"local"`, `outcome: "found"|"close"|"ambiguous"|"not_found"|"resolved"|"incident_open"|"audited"`, `summary`, `runtimeMs`, `hourlyRateCents` (snapshot), `demoCostCents` (per-second demo charge, null for staff; not billed), `createdAt`, `body`:
- `{ type: "supplier_lookup", result: LookupResult }`: item name, availability (+ verbatim text), `sourceUrl` (always on the supplier's domain), `candidates`, `uncertainties`.
- `{ type: "inventory_audit", result: InventoryAuditResult, listingName }`: input SHA-256, thresholds, per-row findings with CSV line numbers, totals. Visible only to the office owner, never to the listing's publisher.
- `{ type: "camera_incident", incident: Incident, simulatorFault }`: observations, actions, timeline. `incident.status` stays `open` until a fresh frame arrives (`outcome: "incident_open"`). `simulatorFault` is for the operator only.

`SkillId`: `supplier_research`, `camera_diagnostics`, `visual_inspection`, `catalog_search`, `inventory_audit`.

## Error codes

| Code | Status | When |
|---|---|---|
| `UNAUTHENTICATED` | 401 | no valid Auth0 session (any API route) |
| `WORKSPACE_NOT_FOUND` | 404 | unknown workspace id, **or one owned by another user** |
| `INVALID_REQUEST` | 400 | bad JSON, bad `clientRequestId`, empty request, expired `pending` |
| `INVALID_NAME` | 400 | office name not 1–60 chars |
| `JOB_NOT_FOUND` | 404 | `jobId` not in this workspace (including another workspace's job) |
| `UNKNOWN_PROFILE` | 400 | `profileId` not in the marketplace |
| `NOT_QUALIFIED` | 400 | profile lacks the job's required skill |
| `NO_OPEN_DESK` | 409 | all desks taken |
| `UNKNOWN_FAULT` | 400 | bad `cameraFault` |
| `UNKNOWN_SUPPLIER` | 400 | supplier not on the approved list |
| `INVALID_LISTING` | 400 | publish form invalid; see `error.fields` |
| `INVALID_INPUT` | 400 | inventory CSV missing or too long |
| `INVALID_INSTRUCTIONS` | 400 | instructions not text of ≤ 1000 chars |
| `HIRE_NOT_FOUND` | 404 | hire not in this workspace |
| `HIRE_DEPARTED` | 409 | the worker already left |
| `ALREADY_ON_TEAM` | 409 | another copy of this listing is already kept on the team |
| `STAFF_RETAINED` | 400 | built-in staff cannot be released |
| `HIRED_FOR_ONE_JOB` | 409 | direct work sent to a job-only worker |
| `UNSUPPORTED_ACTION` | 400 | worker has no inventory action |
| `LISTING_LIMIT` | 409 | publisher already has 12 listings |

## Database (schema v5, `PRAGMA user_version = 5`)

File: `data/workplace.db` (gitignored; override with `WORKPLACE_DB_PATH`). Opening an older file migrates it automatically after writing `<file>.v<old version>-backup-<timestamp>`. Both earlier v4 variants (the `marketplace` and `marketplace-publishing` branches) are detected and upgraded; see [src/lib/workplace/migrate-v5.server.ts](../src/lib/workplace/migrate-v5.server.ts).

| Table | Key columns | Scoping |
|---|---|---|
| `workspaces` | `id` (slug), `name`, `created_at`, `owner_sub` (Auth0 `sub`; NULL = unclaimed) | owner |
| `hires` | `id`, `workspace_id`, `profile_id`, `desk`, rate/skills, `snapshot` (JSON listing as hired), `retention`, `job_id`, `instructions`, `departed_at` | FK → workspaces; unique among *present* hires: `desk`; unique among *kept* hires: `profile_id` |
| `hire_events` | `workspace_id`, `hire_id`, `job_id`, `at`, `kind`, `text` | FK `(workspace_id, hire_id)` → hires (cascade) |
| `jobs` | `id`, `workspace_id`, `client_request_id`, `status`, `hire_id` | FK `(workspace_id, hire_id)` → hires: a job can only be assigned to its own workspace's hire |
| `job_events` | `job_id`, `at`, `actor`, `text` | via job (cascade delete) |
| `reports` | `id`, `workspace_id`, `job_id`, `hire_id`, `mode` (incl. `local`), `outcome`, `body` | FK `(workspace_id, job_id)` → jobs and `(workspace_id, hire_id)` → hires |
| `marketplace_listings` | `id`, `creator_sub`, `client_request_id`, `creator_name`, `character_name`, `role`, `description`, `greeting`, `sample_work`, `skills`, `hourly_rate_cents`, `action_config`, `sprite`, `published_at` | community only (official listings are code); unique `(creator_sub, client_request_id)` |
| `simulator_settings` | `workspace_id` (PK), `camera_fault` | FK → workspaces |

Reset deletes that workspace's reports, events, jobs, hire history, hires and simulator settings, then reseeds the Quality Inspector. There is no delete-workspace route yet.

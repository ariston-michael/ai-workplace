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
- Procurement runs on a **SAMPLE fixture** unless the server has `PROCUREMENT_MODE=live`. Camera jobs are always **SIMULATED**. Reports carry `mode` so the UI can label them: `live` | `sample` | `simulated`.

## Routes

All bodies are JSON. Errors are always `{ ok: false, error: { code, message } }` with a 4xx status.

| Method | Path | Body | Success response |
|---|---|---|---|
| GET | `/api/workspaces` | — | `{ ok, viewer: { name, email }, primaryWorkspaceId, workspaces: WorkspaceSummary[] }` (only the caller's offices) |
| POST | `/api/workspaces` | `{ name }` (1–60 chars) | `201 { ok, workspace: WorkspaceSummary }` (owned by the caller) |
| GET | `/api/workspaces/{id}` | — | `{ ok, state: WorkplaceState }` |
| POST | `/api/workspaces/{id}/jobs` | `{ clientRequestId, request, pending? }` | see **Submitting a request** |
| POST | `/api/workspaces/{id}/hires` | `{ profileId, jobId? }` | `{ ok, hireId, created, state }` |
| POST | `/api/workspaces/{id}/simulator` | `{ cameraFault }` | `{ ok, state }` |
| POST | `/api/workspaces/{id}/reset` | — | `{ ok, state }` |

Legacy aliases (same handlers and checks, applied to the **caller's primary office**): `GET /api/workplace`, `POST /api/workplace/{jobs,hires,simulator,reset}`. Prefer the `/api/workspaces/{id}` routes in new code.

`/api/procurement/lookup` is the standalone lookup test page's endpoint; it requires sign-in but is not workspace-scoped and does not create jobs.

### Submitting a request (`POST …/jobs`)

`request` is the user's free text ("What do you need help with?"). The Dispatcher replies with one of:

| `kind` | Meaning | Response | UI should |
|---|---|---|---|
| `job` | Request understood; job created | `{ ok, kind, jobId, understood, state }` | Show `understood`; render `state` |
| `follow_up` | Details missing; **no job yet** | `{ ok, kind, question, pending }` | Show `pending.transcript`; send the answer as `request` with the same `pending` and the same `clientRequestId` |
| `unsupported` | No worker can handle it; **no job** | `{ ok, kind, message }` | Show `message` |

- `clientRequestId`: 8–100 chars of `[A-Za-z0-9_-]`. Use one per conversation (keep it across follow-ups, new one after a job is created). Resending the same id in the same workspace returns the original job instead of creating a duplicate.
- `pending` is opaque; send it back unchanged. The server re-validates everything in it.

### Hiring (`POST …/hires`)

- With `jobId`: approves the Dispatcher's recommendation for a `needs_worker` job. The worker is seated and **every** `needs_worker` job in that workspace needing that skill resumes automatically.
- Without `jobId`: hire directly from the marketplace (vacant desk).
- Idempotent: hiring an already-hired profile returns the existing `hireId` with `created: false` and starts nothing new.
- `profileId` values: `procurement_researcher`, `catalog_assistant`.

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
| `team` | `HireView[]` | ordered by hire time |
| `jobs` | `JobView[]` | newest first, max 50 |
| `marketplace` | `(WorkerProfile & { hired: boolean })[]` | `hired` is per workspace |
| `simulator` | `{ cameraFault: string }` | |

### `HireView`
`id`, `profileId`, `role`, `initials`, `color` (`coral|sage|gold|blue`), `specialty`, `skills: SkillId[]`, `hourlyRateCents: number|null` (null = staff, not billed), `source: "staff"|"marketplace"`, `desk: "workstation-01"|"desk-02"|"desk-03"`, `hiredAt`, `activeJobId: string|null`, `completedJobs: number`.

Desks are per workspace: every office has its own Workstation 01 (Quality Inspector), Desk 02 and Desk 03.

### `JobView`
| Field | Type | Notes |
|---|---|---|
| `id` | string | |
| `type` | `"supplier_lookup" \| "camera_incident"` | |
| `title` | string | camera titles never reveal the simulated fault |
| `input` | supplier: `{ partName, supplierId, supplierName, request? }`; camera: `{ station, request? }` | `request` = user's original words |
| `requiredSkill` | `SkillId` | |
| `status` | `"needs_worker" \| "queued" \| "working" \| "completed" \| "failed"` | |
| `hireId` / `hireRole` | string \| null | assigned worker |
| `recommendedProfileId` | string \| null | set while `needs_worker` |
| `createdAt`, `assignedAt`, `startedAt`, `finishedAt` | number \| null | ms |
| `error` | `{ code, message } \| null` | when `failed` |
| `events` | `{ at, actor, text }[]` | full history incl. the request conversation |
| `report` | `ReportView \| null` | when `completed` |

`working` means the worker has left its desk (animate departure); a report arriving means it returned.

### `ReportView`
`id`, `mode: "live"|"sample"|"simulated"`, `outcome: "found"|"close"|"ambiguous"|"not_found"|"resolved"|"incident_open"`, `summary`, `runtimeMs`, `hourlyRateCents` (snapshot), `demoCostCents` (per-second demo charge, null for staff; not billed), `createdAt`, `body`:
- `{ type: "supplier_lookup", result: LookupResult }`: item name, availability (+ verbatim text), `sourceUrl` (always on the supplier's domain), `candidates`, `uncertainties`.
- `{ type: "camera_incident", incident: Incident, simulatorFault }`: observations, actions, timeline. `incident.status` stays `open` until a fresh frame arrives (`outcome: "incident_open"`). `simulatorFault` is for the operator only.

`SkillId`: `supplier_research`, `camera_diagnostics`, `visual_inspection`, `catalog_search`.

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

## Database (schema v3, `PRAGMA user_version = 3`)

File: `data/workplace.db` (gitignored; override with `WORKPLACE_DB_PATH`). Opening an older file migrates it automatically after writing `<file>.v<old version>-backup-<timestamp>`.

| Table | Key columns | Scoping |
|---|---|---|
| `workspaces` | `id` (slug), `name`, `created_at`, `owner_sub` (Auth0 `sub`; NULL = unclaimed) | owner |
| `hires` | `id`, `workspace_id`, `profile_id`, `desk`, rate/skills snapshot | FK → workspaces; unique per workspace: `profile_id`, `desk` |
| `jobs` | `id`, `workspace_id`, `client_request_id`, `status`, `hire_id` | FK `(workspace_id, hire_id)` → hires: a job can only be assigned to its own workspace's hire |
| `job_events` | `job_id`, `at`, `actor`, `text` | via job (cascade delete) |
| `reports` | `id`, `workspace_id`, `job_id`, `hire_id`, `mode`, `outcome`, `body` | FK `(workspace_id, job_id)` → jobs and `(workspace_id, hire_id)` → hires |
| `simulator_settings` | `workspace_id` (PK), `camera_fault` | FK → workspaces |

Reset deletes that workspace's reports, events, jobs, hires and simulator settings, then reseeds the Quality Inspector. There is no delete-workspace route yet.

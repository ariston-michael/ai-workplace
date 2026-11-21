# Blue retro office + Gemini Dispatcher

The old port-3001 preview served `marketplace-publishing` at `8c0ba4c`.
`office-retro-gemini` merges `origin/gemini-dispatcher` at `be4918d` and replaces
the beige map with original blue tilework, open aisles, compact cubicles, a
reception counter, wall consoles, and a clearly marked entrance.

Map workers are 39×45 CSS pixels (50% larger). The same shared rectangles draw
furniture and block paths; navigation includes cubicle walls and larger sprite
clearance. Routes are tested down to a 252px-wide map. Clicking a vacant cubicle
shows desk details and hiring choices; clicking an occupied one shows equipment,
occupancy, its worker profile and saved reports. Forms retain normal typography.

Saved events drive both lifecycles: a job-only hire walks to the workstation,
brings the report to reception, pauses for handover and leaves through the door.
A retained worker hands over its report, returns to its desk and is reused for
later matching jobs. Departure keeps reports private in workspace history.

## Open the preview

From this worktree, use the existing ignored Auth0 and Gemini configuration:

```sh
npm ci
PROCUREMENT_MODE=sample npm run build
npm run start -- --port 3001
```

Open http://localhost:3001/office, sign in and choose your office. Set
`APP_BASE_URL=http://localhost:3001`. Without a Gemini key, the Dispatcher clearly
shows its rules fallback; supplier fixtures and simulated camera labels remain.
The compiled office's `data-preview-branch` and `data-preview-commit` attributes
identify the actual bundle rather than whichever branch is later checked out.

## Verify

`npm test`, `npm run lint`, `npm run build`, `npm run typecheck`, then
`MARKETPLACE_SCREENSHOT_DIR=/tmp/office-retro-review npm run test:marketplace`.

The production browser test uses two SDK-encrypted Auth0 fixture sessions, its
own temporary SQLite database, and a local Gemini API test server. It verifies
both visible reception handovers and end positions, no furniture collisions for
the larger workers, clickable desk details, private reports, real local inventory
execution, and mobile layout. It captures `office-retro-full.png` with all workers
at their desks at 100% browser zoom; no CSS zoom or screenshot resizing is used.
Hosted Auth0 and external Gemini requests are not part of that automated check.

Verified locally: all 162 Node tests, lint, TypeScript, production build and all
45 production-browser assertions pass. The screenshot is captured at native
CSS size, with the complete room visible and all retained workers at their desks.

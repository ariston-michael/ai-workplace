# Workspaces and Marketplace navigation

Both pages use `src/app/app-header.tsx` and its shared stylesheet. Workspaces
always precedes Marketplace; both remain links, with `aria-current="page"`
indicating the active route. Header columns, a reserved viewer slot, consistent
font/padding/borders and a stable scrollbar gutter keep link geometry steady.
The mobile layout puts navigation on its own row with 44px tap targets.

The duplicate dashboard button linked to the same unscoped `/marketplace` route
as the header, so it was removed. Office links carrying `workspace`, `job` and
`skill` remain intact. Header navigation deliberately opens the general catalog.

`npm run test:navigation` starts a production preview with a disposable database
and SDK-encrypted fixture sessions, then checks desktop (1440px), tablet (768px)
and mobile (390px) in WebKit and Chromium. It measures link rectangles across
navigation and browser Back/Forward, verifies active states and lack of overflow,
and clicks an empty desk through to a context-aware marketplace hire dialog.
No personal database or provider calls are used.

Local checks: 169 unit tests; 30 navigation checks; lint, type check and production
build. The existing SMS and office integration suites are also run for release.
Safari itself requires Settings → Developer → Allow remote automation to be
enabled; WebKit verification does not claim to be a Safari application run.
The user's screen recording was not attached to this session. The old port-3003
preview reproduced a roughly 318px horizontal nav shift in WebKit.

For the demo, serve this branch's production build on port 3003 with
`APP_BASE_URL=http://localhost:3003`, the existing ignored Auth0 settings, and the
same absolute `WORKPLACE_DB_PATH`. Build in a separate directory before swapping
the preview process; never rebuild its active `.next` directory. Open `/`, click
Marketplace and Workspaces, then use Back/Forward. Open an office, click an empty
cubicle, and follow the full marketplace link to check the hiring destination.

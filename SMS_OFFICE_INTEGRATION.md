# SMS Dispatcher + blue office integration

`sms-office-integration` merges the pushed `sms-dispatcher` commit `00757d6`
with `office-retro-gemini` at `5382170`. The only merge conflict was CSS; both
the SMS panel and blue-office desk detail styles are preserved.

The office now refreshes while idle (every two seconds in a visible tab), faster
while a known job runs, and immediately when the tab becomes visible. This makes
external SMS requests and approvals appear without reloading. Newly observed
hires are recognized in both the active team and former hires, so a short SMS job
that starts and finishes between polls still shows its saved entrance → desk →
reception → exit sequence once. The initial snapshot never replays old departures.
Retained workers keep their existing reception → desk behavior.

## Run the combined checks

```sh
npm ci
npm test
npm run lint
PROCUREMENT_MODE=sample npm run build
npm run typecheck
SMS_SCREENSHOT_DIR=/tmp/sms-office-integration \
MARKETPLACE_SCREENSHOT_DIR=/tmp/sms-office-integration npm run test:integration
```

`test:integration` runs the SMS check (including the blue office) followed by the
complete office/marketplace check. The SMS webhook and office UI share **one
temporary SQLite database**, separate from demo/user data. The broader office
suite creates another isolated database, preventing cross-suite state leakage.
Tests generate their own Auth0 fixture sessions and use local Twilio/Gemini API
mocks. Signed inbound requests go through the real Twilio webhook and the saved
jobs/hire/report service. No carrier messages, real credentials, or live TinyFish
credits are used.

The SMS check deliberately holds the office's state refresh until the short job
has finished. It verifies that a phone-approved job-only hire still appears in
the **already open blue office**, brings its actual SAMPLE report to reception,
then exits. Clicking View report and the workflow link opens the exact same job
and report in the linked workspace. A second office stays empty; a second account
cannot read the workspace, SMS settings or workflow. Reload does not replay the
old departure. Duplicate webhook deliveries/approvals run and notify only once.
The general office suite also verifies retained-worker reuse and both lifecycles,
blue geometry/collisions, private inventory execution, and desktop/mobile views.

Verified locally: 169 unit tests, lint, type check, production build, 45 SMS/office
browser assertions and 45 broader office/marketplace assertions pass.

## Preview

The integration has its own worktree at
`/Users/aristonmichael/HW13/ai-workplace-sms-office`. Its production preview uses
an ignored worktree-local database, snapshotted from the previous demo on cutover;
the older worktree's database is preserved. With `.env.local` configured:

```sh
npm run start -- --port 3001
```

Open http://localhost:3001/office, sign in, and click the Dispatcher. The **Text the
Dispatcher** panel uses the selected office. Real SMS delivery requires the four
Twilio settings in `.env.example` and a public webhook URL forwarding to
`/api/sms/twilio`; it has not been carrier-tested. Until configured, the panel
shows SMS is off while office intake, hiring, reports and history still work.

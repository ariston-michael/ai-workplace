# Vultr public demo release

Starting point: PR #2 is open at `2ceade4` (not merged into main as of preparation).
This release branch adds standalone hosting and simulated SMS. It does not merge
PR #2 or provision a paid instance. Confirm the live PR state before promotion.

## Host and account access required

Reuse an existing Vultr Linux instance after checking available memory, disk,
Docker/Compose, and whether ports 80/443 already serve anything. Do not replace
an existing proxy or application. If a new instance is required, obtain the exact
region/plan quote from the Vultr account and approval before creating it. A public
DNS hostname must point to the chosen instance. No instance or DNS record has
been created by this preparation.

## Deployment layout

- Caddy terminates public HTTPS on 80/443 and forwards to the private app.
- The non-root Node 24 app exposes port 3000 only on host loopback.
- `/var/lib/ai-workplace/workplace.db` is a host bind mount, not image storage.
  SQLite WAL files, migration backups and report data persist across restarts
  and image replacement. Run one app replica with this SQLite database.
- Credentials live only in `/etc/ai-workplace/app.env`, mode 600. They are not
  copied into the image or Git archive. Start production with a fresh database;
  importing local personal/demo data is a separate explicit operation.
- Compose forces `PROCUREMENT_MODE=sample` and `SMS_MODE=simulated` even if the
  env file contains different settings. The public app cannot send carrier SMS.
- HTTPS certificates persist in Caddy's named volume. Do not remove volumes or
  the host data directory when rolling out a new image.

## Release procedure (after instance access and hostname are known)

1. Keep the exact tested source SHA as `DEPLOY_COMMIT`. Transfer a Git archive of
   that SHA to a new `/opt/ai-workplace/releases/<sha>` directory on the instance;
   do not upload `.env.local`, node_modules, `.next`, test databases or context ZIP.
2. Ensure Docker Engine and Compose are available using the host OS's supported
   installation path. Inspect existing services before binding 80/443.
3. Create the app data directory once, with ownership matching the image:

   ```sh
   install -d -m 750 -o 10001 -g 10001 /var/lib/ai-workplace
   install -d -m 700 /etc/ai-workplace
   ```

4. Fill `/etc/ai-workplace/app.env` from `app.env.example` and set mode 600. Use
   the real Auth0 regular web application's domain, client ID and client secret,
   plus a production-only session secret (`openssl rand -hex 32`). Gemini is
   optional; without its key the Dispatcher uses the existing rules. No Twilio
   or TinyFish credentials are needed for the public demo.
5. Fill `/etc/ai-workplace/deploy.env` from `deploy.env.example`. `PUBLIC_HOSTNAME`
   is the DNS hostname only; `DEPLOY_COMMIT` is the full tested source SHA. Configure
   Auth0 to allow `https://<hostname>/auth/callback`, logout `https://<hostname>`
   and web origin `https://<hostname>`, preserving localhost entries.
6. From the new release directory:

   ```sh
   docker compose --env-file /etc/ai-workplace/deploy.env -f deploy/compose.yaml build
   docker compose --env-file /etc/ai-workplace/deploy.env -f deploy/compose.yaml up -d --wait
   ```

7. Check public `/api/health`, HTTP→HTTPS redirect, certificate trust, and Auth0
   login→dashboard→office. Approve a hire, open its report/workflow, then restart
   the app and verify its workspace and report survive. Test a second account
   against copied office/workflow URLs. These public checks require deployment
   access and are not claimed by the local preparation tests.

## Simulated SMS

The signed-in office has a **SIMULATED SMS** composer. It auto-binds a synthetic
sender to that owner and workspace. Type a part request, then `APPROVE <job code>`
(or `APPROVE <job code> KEEP`). The existing dispatcher, hire, run, report and
history flow runs, but results are recorded only in the private on-screen inbox.
The Twilio webhook returns 503 in this mode even if live credentials exist.
Requests and reports retain explicit SIMULATED SMS and SAMPLE labels. No public
fake-login or unauthenticated simulation endpoint is added.

## Backup and rollback

Before an update, create a consistent SQLite snapshot (including live WAL data):

```sh
docker compose --env-file /etc/ai-workplace/deploy.env -f deploy/compose.yaml exec app node deploy/backup.mjs
```

The snapshot is written under `/var/lib/ai-workplace/backups`. Copy it securely
off-host as part of operations. To roll back app code, run the previous tested
image against the same data only if it supports the current schema. A schema
rollback requires stopping the app and restoring the matching pre-upgrade backup;
never automatically replace a production database with an older local file.

## Reproducible local verification

```sh
npm ci
npm test
npm run lint
npm run build
npm run typecheck
npm run test:deployment
npm run test:integration
```

`test:deployment` runs the actual standalone artifact with temporary Auth0 test
sessions and a temporary SQLite file. It verifies simulated request→approval→hire
→saved report, owner isolation, zero carrier/provider calls even with trap
credentials, and report persistence after restarting the server. Existing SMS and
office suites continue to test the real signed webhook using local API mocks.
Hosted Auth0 sign-in, DNS, public certificate issuance, and real Vultr storage
remain deployment checks. The Mac's existing port 3001 demo is left running.

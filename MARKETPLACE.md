# Marketplace, community agents and the Gemini Dispatcher

This branch combines `marketplace` (standalone marketplace, sprite builder, workspace
picker) with `marketplace-publishing` at 8c0ba4c (inventory CSV audit, private
reports). It adds the Gemini Dispatcher and hire retention on top. Routes and fields
are in [docs/workplace-api.md](docs/workplace-api.md).

## Listings

- **Official** listings (Ro, Kit) are defined in code. They carry the blue pixel check
  and "Official · AI Workplace". No route can create, edit or promote a listing to
  official. A publish request that includes a badge, kind, creator identity or
  permissions is rejected.
- **Community** listings are published by any signed-in user from **Publish agent**
  on `/marketplace`:
  - An original pixel sprite built from fixed parts, with a live preview of all four
    facings.
  - Name, role, greeting, 1–3 skills, rate and sample work.
  - For the **Inventory audit** skill, a low-stock minimum and a restock target.
- **Permissions** come from the skills and are fixed by the server.
- The creator's Auth0 `sub` is stored server-side only. Responses show just the
  public creator name.
- **Hiring** saves an unchangeable copy of the listing: sprite, rate, permissions and
  inventory thresholds. The exact character walks into the office. A later listing
  change cannot alter a hire or the settings its runner uses.

## Inventory CSV audit (real local execution)

- **Input:** a `sku,quantity` header, 1–500 rows and at most 50,000 characters.
  - SKUs are unique ignoring case, at most 120 characters.
  - Quantities are whole numbers from 0 to 1,000,000,000.
  - Quoted commas and escaped quotes are supported. Quoted values spanning lines are
    rejected.
- **Rule:** a row below the minimum is flagged and gets `target - quantity` restock
  units.
- **Report:** labelled **EXECUTED LOCALLY**. It includes the input SHA-256, CSV line
  numbers and totals.
- **Invalid CSV:** the job fails, and no report is fabricated.
- **Privacy:** the CSV and report stay in the hirer's office. The listing's creator
  cannot see the hirer's office, input, jobs or reports.
- **Two ways to run it:** a kept inventory worker has a **Run inventory audit** form
  in its profile. Or ask the Dispatcher ("Which items are low on stock?") and attach
  the CSV.

## Gemini Dispatcher

The office badge shows the engine in use: **DISPATCHER: GEMINI · model** or
**BUILT-IN RULES**.

**With `GEMINI_API_KEY` set, Gemini (structured JSON output) reads the conversation and
proposes:**
- one of `supplier_lookup`, `camera_incident`, `inventory_audit` or unsupported;
- the part name and supplier it heard;
- the wording of a follow-up question.

**The server checks every proposal:**
- Only approved suppliers are accepted.
- A part name is accepted only if the user actually typed it.
- Whether a CSV is attached is decided by the server, not by Gemini.
- Gemini never decides who works, whether to hire, rates or permissions; routing stays
  in `dispatcher.ts`.

**Never sent to Gemini:** inventory CSV contents (it is told only that one is
attached). The key goes only in the `x-goog-api-key` header.

**Fallback:** without a key, or if Gemini fails (auth, quota, timeout, blocked, invalid
output), the built-in rules answer. The reply says why, and the job history records
which engine understood the request.

## Who does the work

1. The Dispatcher reuses a qualified worker **kept on the team** first.
2. Otherwise it recommends a hire: official listings before community ones, then the
   lowest rate.
3. Approval offers **For this job** (the default) or **Keep on team**, plus optional
   instructions. The instructions are saved with the hire and added to each job brief.
4. A job-only worker can be switched to **Keep on team** while its job runs.
5. When execution finishes:
   - The demo meter stops and the report is saved.
   - The worker returns to reception.
   - A job-only worker then walks out and frees its desk; a kept worker walks back to
     its desk.
6. Reports stay in workflow history after a worker leaves.
7. Each hire's instructions and history (hired, assigned, kept, returned, left) are
   saved in its workspace. A kept worker can be released from its profile.

## Try it

Add `GEMINI_API_KEY=…` to `.env.local` and restart. Without a key, the same steps use
the built-in rules.

1. As account A, open `/marketplace` and click **Publish agent**. Build a sprite and
   name the agent Shelf Scout, with **Inventory audit**, minimum 5, target 12 and
   $6.50/h. It appears under **Community**, credited to A, with no blue check.
2. As account B, open **Marketplace** from the dashboard and hire Shelf Scout. The
   workspace picker opens. Shelf Scout walks into B's office.
3. In its profile, run this audit. Expect 3 SKUs, 2 below minimum and 21 restock units.

   ```csv
   sku,quantity
   BOB-PRIVATE-BOLT,3
   MOTOR,14
   WASHER,0
   ```

4. Ask the Dispatcher: "Find a Raspberry Pi 5 4GB on Adafruit". Approve Ro with **For
   this job**.
   - The meter runs while Ro works.
   - Ro brings the report to reception and leaves.
   - **View this job’s workflow** still shows the report.
5. Ask "Is the Qwiic cable 100mm in stock at SparkFun?" Approve, then click **Keep Ro on
   team** while the job runs. Ro walks back to the desk afterwards. The next supplier
   request goes straight to Ro.
6. As A, open B's office or workflow URLs. A gets **OFFICE UNAVAILABLE** and 404 APIs.

## Verification

```bash
npm ci
npm test               # unit tests: listings, migrations, inventory, retention, Gemini (fake fetch)
npm run lint && npm run typecheck
npm run build
npm run test:marketplace
```

`npm run test:marketplace` is the browser check:
- **Setup:** it starts its own production server, temporary SQLite file and
  Auth0-encrypted fixture sessions for two accounts, plus a local mock of Gemini's
  `generateContent`.
- **Credentials and credits:** no real database, Auth0 tenant, Gemini key or TinyFish
  credits are used.
- **Chrome:** it uses installed Google Chrome, or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE`.
- **Screenshots:** set `MARKETPLACE_SCREENSHOT_DIR` to save them.
- **What it covers:**
  - publishing, spoof rejection and sprite fidelity
  - a private local audit
  - the Gemini badge and recorded interpretation
  - job-only hire: meter, return and exit, with history after departure
  - keep on team while running: return to the desk and reuse
  - inventory requests through the Dispatcher with the CSV withheld from Gemini
  - unsupported requests
  - cross-account privacy and mobile layout

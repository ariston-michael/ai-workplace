# AI Workplace contributor guide

Read PROJECT_IDEA.md before changing the app. Use the current assignment to decide what to implement. The roadmap describes later milestones. Inspect the actual repo and package scripts before assuming a feature exists.

## Working agreements

- Use VS Code, Next.js App Router, React, and TypeScript. Planned persistence is SQLite with Prisma on the Mac. The first lookup can run without a database.
- Keep provider calls on the server. Store real credentials in ignored .env.local and use placeholders in .env.example.
- Use one owner per change. Claude Code can own the supplier integration, Codex the office UI and integration review, and Copilot can assist with edits in the active branch. Use separate branches and working directories for simultaneous edits.
- Drive office animations and billing from actual task events. Distinguish a sample, simulated inspection, and live result in the UI.
- Run the relevant checks defined by the repo. Report what was verified locally and what still requires credentials or hardware.

## First assignment — Procurement Researcher

Build a small test page where the user enters a part name and chooses a supplier. Send a supplier ID to the server and resolve it against a server-owned list of approved public URLs. Read TINYFISH_API_KEY from .env.local. Verify the current TinyFish API at https://docs.tinyfish.ai before coding.

Use TinyFish to look up the requested part. Display the item name, observed availability, source link, and uncertainties. If a listing is ambiguous or absent, report that explicitly. Show loading, missing-key and provider-error states. Keep the change to this lookup. A marketplace, Pi, billing system and database can all be added later.

Acceptance: a user can submit one part, open the returned supplier page, and verify the result. An invalid supplier ID is rejected before contacting TinyFish. A failed lookup displays an error. If no API key is available, verify local behavior and mark the live check pending.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
# AI Workplace contributor guide

Read PROJECT_IDEA.md before changing the app. Use the current assignment to decide what to implement. The roadmap describes later milestones. Inspect the actual repo and package scripts before assuming a feature exists.

## Working agreements

- Use VS Code, Next.js App Router, React, and TypeScript. Planned persistence is SQLite with Prisma on the Mac. The first lookup can run without a database.
- Keep provider calls on the server. Store real credentials in ignored .env.local and use placeholders in .env.example.
- Use one owner per change. Claude Code can own the supplier integration, Codex the office UI and integration review, and Copilot can assist with edits in the active branch. Use separate branches and working directories for simultaneous edits.
- Drive office animations and billing from actual task events. Distinguish a sample, simulated inspection, and live result in the UI.
- Run the relevant checks defined by the repo. Report what was verified locally and what still requires credentials or hardware.

## First assignment — Procurement Researcher

Build a small test page where the user enters a part name and chooses a supplier. Send a supplier ID to the server and resolve it against a server-owned list of approved public URLs. Read TINYFISH_API_KEY from .env.local. Verify the current TinyFish API at https://docs.tinyfish.ai before coding.

Use TinyFish to look up the requested part. Display the item name, observed availability, source link, and uncertainties. If a listing is ambiguous or absent, report that explicitly. Show loading, missing-key and provider-error states. Keep the change to this lookup. A marketplace, Pi, billing system and database can all be added later.

Acceptance: a user can submit one part, open the returned supplier page, and verify the result. An invalid supplier ID is rejected before contacting TinyFish. A failed lookup displays an error. If no API key is available, verify local behavior and mark the live check pending.

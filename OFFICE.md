# Interactive office demo

Run `npm ci` once, then `npm run dev`. Open http://localhost:3000/office.
If another worktree is using port 3000, use `npm run dev -- --port 3001`
and open http://localhost:3001/office.

1. Click reception to inspect the Dispatcher, then the left workstation for the Quality Inspector.
2. Click the empty desk on the right to open the marketplace.
3. Compare the Catalog Assistant ($4/hour, internal catalog skills) and Procurement Researcher ($6/hour, supplier research skills).
4. Hire either candidate. Their avatar appears at Desk 02, the worker count increases, and their details open.
5. Click that occupied desk to inspect the new worker's role and ready status.
6. Use **Reset demo** to try the other candidate. Refreshing also clears the hire.

All desks are keyboard-accessible buttons. The detail panel receives focus when selected.
The layout stacks on small screens and respects reduced-motion preferences.

## Repair incident demo

1. In the feed-health panel, choose **Suspected loose camera cable** or **Stalled stream service**.
2. Click **Simulate feed stop**. The sample feed stops immediately; after about two seconds the Dispatcher assigns REPAIR-001 to Quality Inspector.
3. Select the inspector's workstation during diagnosis to see its active status. About three seconds after assignment, the worker returns a report.
4. Click the inspector or **View worker report** to inspect evidence, the simulated action taken, the visit recommendation, and uncertainties.
5. The cable scenario leaves the feed stopped and recommends a site visit. The stalled-service scenario restores the sample feed and indicates no visit is currently needed.
6. **Restart feed demo** clears just the incident, preserving your hire. It also cancels an in-progress sequence. **Reset demo** clears the incident and hire together. Refresh clears both.

Incident events continue while you browse workers or hire someone. The report stays available on the inspector until you restart or reset the demo. All feed observations and repairs are scripted samples; no actual device is monitored, restarted, or booked for a visit.

This milestone uses React state and local sample profiles only. Rates are illustrative;
no charges, supplier calls, backend tasks, hardware inspections, or persistence are created.
The lookup page, provider integration, backend routes, database, shared layout, and global styles are untouched.

Checks: `npm run lint`, `npx tsc --noEmit`, and `npm run build`.
The existing root layout fetches Google Fonts, so production builds need network access.

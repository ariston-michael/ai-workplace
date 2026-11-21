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

## Integrated camera incident simulator

The office uses `src/lib/camera-incident.ts` for every observation, decision, action status, and resolution. It does not contact the separate simulator page or a backend. Both pages run the same pure state machine locally.

1. Choose one of the three case buttons in the feed-health panel. This opens a SIMULATED feed-stopped incident.
2. Use **Next observation** to deliver USB camera detection and service status. The Dispatcher only chooses an action after both observations arrive.
3. Click the Inspector's workstation or **View worker report** to inspect the actual simulator evidence, requested/completed action, visit decision, uncertainties, and full timeline.
4. Continue observations individually or use **Run to end**:
   - **Case 1a:** camera detected, service stopped → restart requested → restart succeeds → fresh frame resolves the incident.
   - **Case 1b:** restart succeeds but no fresh frame arrives → incident remains open, waiting for a fresh frame. No technician visit is invented.
   - **Case 2:** camera missing → technician cable-check task, with no restart. The technician's report alone leaves the incident open; the final fresh frame resolves it.
5. Switching cases or **Restart feed demo** preserves your hire. **Reset demo** and refresh clear the hire and incident together.

All observations are labeled SIMULATED. No actual camera is monitored, service restarted, or visit booked. A successful action does not itself resolve the incident.

This milestone uses React state and local sample profiles only. Rates are illustrative;
no charges, supplier calls, backend tasks, hardware inspections, or persistence are created.
Hiring remains local and independent of simulator case selection. Procurement remains a separate server-backed lookup at `/procurement`.

Checks: `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build`.
The existing root layout fetches Google Fonts, so production builds need network access.

import { ACTION_LABEL, type Incident, type Phase } from "./camera-incident.ts";

export const PHASE_LABEL: Record<Phase, string> = {
  awaiting_observations: "Waiting for observations",
  awaiting_restart: "Waiting for restart result",
  awaiting_technician: "Visit required",
  awaiting_frame: "Waiting for a fresh frame",
  needs_inspection: "Inspection required",
  resolved: "Resolved",
};

/** Presentation derived from the shared incident; no separate office decisions. */
export function cameraReport(incident: Incident) {
  const pendingVisit = incident.actions.find(action =>
    action.kind !== "restart_camera_service" && action.status === "requested",
  );
  const completedVisit = incident.actions.some(action =>
    action.kind !== "restart_camera_service" && action.status === "succeeded",
  );
  return {
    heading: PHASE_LABEL[incident.phase],
    evidence: incident.timeline.filter(entry => entry.kind === "observation"),
    actions: incident.actions.map(action => ({ ...action, label: ACTION_LABEL[action.kind] })),
    visit: pendingVisit
      ? `Yes — ${ACTION_LABEL[pendingVisit.kind]}. ${pendingVisit.reason}`
      : completedVisit
        ? "The simulated technician has reported back. No further visit is requested."
        : "No technician visit has been requested by the simulator.",
    uncertainty: incident.status === "resolved"
      ? "A fresh frame confirms simulated feed recovery; it does not establish the root cause."
      : incident.phase === "awaiting_observations"
        ? "The Dispatcher needs both USB camera and service observations before choosing an action."
        : "No fresh frame has arrived. The incident remains open, even if a restart or technician reported success.",
  };
}

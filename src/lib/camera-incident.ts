// Camera incident handling for a packing-station Pi.
// Pure state machine: no network, no timers, no TinyFish. The simulator page and
// tests feed it observations; later the real Pi can feed it the same events.
//
// Dispatcher rule (decided once both observations are in):
//   USB camera detected + camera service stopped -> request a service restart
//   USB camera missing                           -> technician task: check the cable
//   USB camera detected + service running        -> inspection needed (no automated fix)
// The incident stays open until a frame captured after the incident opened arrives.

export type ObservationSource = "simulated" | "live";

export type Observation =
  | { type: "feed_stopped" }
  | { type: "usb_camera"; detected: boolean }
  | { type: "camera_service"; running: boolean }
  | { type: "restart_result"; succeeded: boolean }
  | { type: "technician_update"; note: string }
  | { type: "frame"; capturedAt: number };

export type ObservationEvent = Observation & {
  source: ObservationSource;
  /** When the observation was received (ms since epoch). */
  at: number;
};

export type ActionKind = "restart_camera_service" | "technician_check_cable" | "technician_inspect_camera";
export type ActionStatus = "requested" | "succeeded" | "failed" | "superseded";

export interface IncidentAction {
  id: string;
  kind: ActionKind;
  status: ActionStatus;
  reason: string;
  createdAt: number;
  updatedAt: number;
}

export type Phase =
  | "awaiting_observations"
  | "awaiting_restart"
  | "awaiting_technician"
  | "awaiting_frame"
  | "needs_inspection"
  | "resolved";

export interface TimelineEntry {
  at: number;
  kind: "observation" | "decision" | "note";
  source?: ObservationSource;
  text: string;
}

export interface Incident {
  id: string;
  station: string;
  status: "open" | "resolved";
  phase: Phase;
  openedAt: number;
  resolvedAt: number | null;
  usbCamera: { detected: boolean; at: number; source: ObservationSource } | null;
  cameraService: { running: boolean; at: number; source: ObservationSource } | null;
  actions: IncidentAction[];
  timeline: TimelineEntry[];
}

export const ACTION_LABEL: Record<ActionKind, string> = {
  restart_camera_service: "Restart camera service on the Pi",
  technician_check_cable: "Technician task: check the USB camera cable",
  technician_inspect_camera: "Technician task: inspect the camera",
};

export function openIncident(event: ObservationEvent, opts: { id: string; station: string }): Incident {
  if (event.type !== "feed_stopped") {
    throw new Error("An incident can only be opened by a feed_stopped observation.");
  }
  return {
    id: opts.id,
    station: opts.station,
    status: "open",
    phase: "awaiting_observations",
    openedAt: event.at,
    resolvedAt: null,
    usbCamera: null,
    cameraService: null,
    actions: [],
    timeline: [
      { at: event.at, kind: "observation", source: event.source, text: "Camera feed stopped." },
      {
        at: event.at,
        kind: "note",
        text: "Incident opened. Dispatcher waiting for USB camera detection and camera service status.",
      },
    ],
  };
}

/** The Dispatcher's choice given both observations. */
export function decideNextStep(usbDetected: boolean, serviceRunning: boolean): {
  kind: ActionKind;
  reason: string;
} {
  if (!usbDetected) {
    return {
      kind: "technician_check_cable",
      reason: "The Pi does not detect the USB camera, so a restart cannot help. A person needs to check the cable.",
    };
  }
  if (!serviceRunning) {
    return {
      kind: "restart_camera_service",
      reason: "The USB camera is detected but the camera service is stopped.",
    };
  }
  return {
    kind: "technician_inspect_camera",
    reason: "The camera is detected and the service is running, yet the feed stopped. No automated fix applies.",
  };
}

/** Apply one observation. Returns a new incident; never mutates the input. */
export function applyObservation(incident: Incident, event: ObservationEvent): Incident {
  const next: Incident = {
    ...incident,
    actions: incident.actions.map((a) => ({ ...a })),
    timeline: [...incident.timeline],
  };
  const log = (entry: Omit<TimelineEntry, "at">) => next.timeline.push({ at: event.at, ...entry });

  if (incident.status === "resolved") {
    log({ kind: "note", source: event.source, text: `Ignored ${describe(event)} — incident already resolved.` });
    return next;
  }

  switch (event.type) {
    case "feed_stopped":
      log({ kind: "observation", source: event.source, text: "Camera feed stopped (repeat report; incident already open)." });
      return next;

    case "usb_camera":
      next.usbCamera = { detected: event.detected, at: event.at, source: event.source };
      log({ kind: "observation", source: event.source, text: describe(event) });
      return maybeDecide(next, event.at);

    case "camera_service":
      next.cameraService = { running: event.running, at: event.at, source: event.source };
      log({ kind: "observation", source: event.source, text: describe(event) });
      return maybeDecide(next, event.at);

    case "restart_result": {
      log({ kind: "observation", source: event.source, text: describe(event) });
      const restart = openAction(next, "restart_camera_service");
      if (!restart) {
        log({ kind: "note", text: "No restart was requested; result ignored." });
        return next;
      }
      restart.updatedAt = event.at;
      if (event.succeeded) {
        restart.status = "succeeded";
        next.phase = "awaiting_frame";
        log({
          kind: "note",
          text: "Restart reported success. Incident stays open until a fresh frame arrives.",
        });
      } else {
        restart.status = "failed";
        addAction(next, event.at, {
          kind: "technician_inspect_camera",
          reason: "The camera service restart failed.",
        });
        next.phase = "awaiting_technician";
      }
      return next;
    }

    case "technician_update": {
      log({ kind: "observation", source: event.source, text: describe(event) });
      const task = openAction(next, "technician_check_cable") ?? openAction(next, "technician_inspect_camera");
      if (task) {
        task.status = "succeeded";
        task.updatedAt = event.at;
        next.phase = "awaiting_frame";
        log({ kind: "note", text: "Technician reported back. Incident stays open until a fresh frame arrives." });
      }
      return next;
    }

    case "frame": {
      log({ kind: "observation", source: event.source, text: describe(event) });
      if (event.capturedAt <= next.openedAt) {
        log({
          kind: "note",
          text: "Frame was captured before the feed stopped, so it is stale. Incident stays open.",
        });
        return next;
      }
      next.status = "resolved";
      next.phase = "resolved";
      next.resolvedAt = event.at;
      for (const a of next.actions) {
        if (a.status === "requested") {
          a.status = "superseded";
          a.updatedAt = event.at;
        }
      }
      log({ kind: "note", text: "Fresh frame received. Incident resolved." });
      return next;
    }
  }
}

function maybeDecide(incident: Incident, at: number): Incident {
  if (!incident.usbCamera || !incident.cameraService) return incident;
  const decision = decideNextStep(incident.usbCamera.detected, incident.cameraService.running);

  // Re-reports of the same state must not create a second request.
  const active = incident.actions.find((a) => a.status === "requested");
  if (active?.kind === decision.kind) return incident;
  if (active) {
    active.status = "superseded";
    active.updatedAt = at;
  }
  addAction(incident, at, decision);
  incident.phase =
    decision.kind === "restart_camera_service"
      ? "awaiting_restart"
      : decision.kind === "technician_check_cable"
        ? "awaiting_technician"
        : "needs_inspection";
  return incident;
}

function addAction(incident: Incident, at: number, d: { kind: ActionKind; reason: string }) {
  incident.actions.push({
    id: `${incident.id}-a${incident.actions.length + 1}`,
    kind: d.kind,
    status: "requested",
    reason: d.reason,
    createdAt: at,
    updatedAt: at,
  });
  incident.timeline.push({ at, kind: "decision", text: `Dispatcher: ${ACTION_LABEL[d.kind]}. ${d.reason}` });
}

function openAction(incident: Incident, kind: ActionKind): IncidentAction | undefined {
  return incident.actions.find((a) => a.kind === kind && a.status === "requested");
}

function describe(event: ObservationEvent): string {
  switch (event.type) {
    case "feed_stopped":
      return "Camera feed stopped.";
    case "usb_camera":
      return event.detected ? "Pi detects the USB camera." : "Pi does not detect the USB camera.";
    case "camera_service":
      return event.running ? "Camera service is running." : "Camera service is stopped.";
    case "restart_result":
      return event.succeeded ? "Camera service restart succeeded." : "Camera service restart failed.";
    case "technician_update":
      return `Technician: ${event.note}`;
    case "frame":
      return `Frame received (captured ${new Date(event.capturedAt).toISOString()}).`;
  }
}

// ---------------------------------------------------------------------------
// Simulator scenarios (every observation is labeled "simulated")
// ---------------------------------------------------------------------------

export interface ScenarioStep {
  label: string;
  observation: Observation;
}

export interface Scenario {
  id: string;
  title: string;
  description: string;
  steps: ScenarioStep[];
}

/** Frame capture time is filled in relative to the step's clock when run. */
export const FRESH_FRAME = { type: "frame", capturedAt: Number.NaN } as const;

export const SCENARIOS: Scenario[] = [
  {
    id: "service-stopped-recovers",
    title: "Case 1a · Camera present, service stopped → restart restores feed",
    description: "The Dispatcher requests a restart; a fresh frame follows and the incident closes.",
    steps: [
      { label: "Feed stopped", observation: { type: "feed_stopped" } },
      { label: "USB camera detected", observation: { type: "usb_camera", detected: true } },
      { label: "Camera service stopped", observation: { type: "camera_service", running: false } },
      { label: "Restart succeeded", observation: { type: "restart_result", succeeded: true } },
      { label: "Fresh frame", observation: FRESH_FRAME },
    ],
  },
  {
    id: "service-stopped-no-frame",
    title: "Case 1b · Camera present, service stopped → restart succeeds, no frame",
    description: "The restart reports success but no frame arrives, so the incident must stay open.",
    steps: [
      { label: "Feed stopped", observation: { type: "feed_stopped" } },
      { label: "USB camera detected", observation: { type: "usb_camera", detected: true } },
      { label: "Camera service stopped", observation: { type: "camera_service", running: false } },
      { label: "Restart succeeded", observation: { type: "restart_result", succeeded: true } },
    ],
  },
  {
    id: "camera-missing",
    title: "Case 2 · Camera missing → technician checks cable",
    description: "The Dispatcher does not restart anything; it creates a technician task. A fresh frame closes it.",
    steps: [
      { label: "Feed stopped", observation: { type: "feed_stopped" } },
      { label: "USB camera not detected", observation: { type: "usb_camera", detected: false } },
      { label: "Camera service stopped", observation: { type: "camera_service", running: false } },
      { label: "Technician reseated cable", observation: { type: "technician_update", note: "Reseated USB cable." } },
      { label: "Fresh frame", observation: FRESH_FRAME },
    ],
  },
];

/** Turn a scenario step into a simulated event at time `at`. */
export function simulatedEvent(step: ScenarioStep, at: number): ObservationEvent {
  const obs =
    step.observation.type === "frame" && Number.isNaN(step.observation.capturedAt)
      ? { type: "frame" as const, capturedAt: at }
      : step.observation;
  return { ...obs, source: "simulated", at };
}

/** Run the first `count` steps of a scenario. Each step is 5 simulated seconds apart. */
export function runScenario(
  scenario: Scenario,
  count: number,
  startAt: number,
  station = "Packing Station 1",
): Incident | null {
  let incident: Incident | null = null;
  const steps = scenario.steps.slice(0, count);
  for (let i = 0; i < steps.length; i++) {
    const event = simulatedEvent(steps[i], startAt + i * 5000);
    incident = incident
      ? applyObservation(incident, event)
      : openIncident(event, { id: `sim-${scenario.id}`, station });
  }
  return incident;
}

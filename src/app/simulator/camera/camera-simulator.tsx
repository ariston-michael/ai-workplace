"use client";

import { useState } from "react";
import {
  ACTION_LABEL,
  SCENARIOS,
  runScenario,
  type ActionStatus,
  type Incident,
  type Phase,
  type Scenario,
} from "@/lib/camera-incident";

const PHASE_LABEL: Record<Phase, string> = {
  awaiting_observations: "Waiting for camera and service observations",
  awaiting_restart: "Waiting for restart result",
  awaiting_technician: "Waiting for technician",
  awaiting_frame: "Waiting for a fresh frame",
  needs_inspection: "Needs inspection",
  resolved: "Resolved",
};

const ACTION_STATUS_STYLE: Record<ActionStatus, string> = {
  requested: "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-100",
  succeeded: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100",
  failed: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-100",
  superseded: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};

// Called only from click handlers, never during render.
function simulationStartTime() {
  return Date.now();
}

function SimulatedBadge() {
  return (
    <span className="rounded bg-violet-600 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
      Simulated
    </span>
  );
}

export function CameraSimulator() {
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [startAt, setStartAt] = useState(0);
  const [stepCount, setStepCount] = useState(0);

  const incident: Incident | null = scenario ? runScenario(scenario, stepCount, startAt) : null;
  const nextStep = scenario?.steps[stepCount];
  const finished = scenario !== null && stepCount >= scenario.steps.length;

  function choose(s: Scenario) {
    setScenario(s);
    setStartAt(simulationStartTime());
    setStepCount(1); // the feed-stopped report opens the incident
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">Choose a case</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {SCENARIOS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => choose(s)}
              className={`rounded-xl border p-4 text-left text-sm transition-colors ${
                scenario?.id === s.id
                  ? "border-foreground"
                  : "border-zinc-200 hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600"
              }`}
            >
              <span className="block font-medium">{s.title}</span>
              <span className="mt-1 block text-zinc-500">{s.description}</span>
            </button>
          ))}
        </div>
      </section>

      {scenario && incident && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={finished}
              onClick={() => setStepCount((n) => n + 1)}
              className="rounded-full bg-foreground px-5 py-2 font-medium text-background disabled:opacity-40"
            >
              {nextStep ? `Next observation: ${nextStep.label}` : "No more observations"}
            </button>
            <button
              type="button"
              disabled={finished}
              onClick={() => setStepCount(scenario.steps.length)}
              className="rounded-full border border-zinc-300 px-4 py-2 text-sm disabled:opacity-40 dark:border-zinc-700"
            >
              Run to end
            </button>
            <button
              type="button"
              onClick={() => choose(scenario)}
              className="rounded-full border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-700"
            >
              Reset
            </button>
          </div>

          <IncidentPanel incident={incident} finished={finished} />
        </>
      )}
    </div>
  );
}

function IncidentPanel({ incident, finished }: { incident: Incident; finished: boolean }) {
  const open = incident.status === "open";
  return (
    <article className="flex flex-col gap-5 rounded-xl border border-zinc-200 p-5 dark:border-zinc-800" aria-live="polite">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase ${
            open ? "bg-amber-500 text-white" : "bg-emerald-600 text-white"
          }`}
        >
          Incident {incident.status}
        </span>
        <SimulatedBadge />
        <span className="text-sm text-zinc-500">
          {incident.station} · {PHASE_LABEL[incident.phase]}
        </span>
      </div>

      {open && finished && (
        <p className="rounded-md bg-amber-50 p-3 text-amber-900 dark:bg-amber-950 dark:text-amber-100">
          No fresh frame has arrived. The incident stays open even though every requested step reported back.
        </p>
      )}

      <section>
        <h3 className="font-semibold">Observations</h3>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
          <dt className="text-zinc-500">USB camera</dt>
          <dd className="flex items-center gap-2">
            {incident.usbCamera ? (
              <>
                {incident.usbCamera.detected ? "Detected" : "Not detected"}
                {incident.usbCamera.source === "simulated" && <SimulatedBadge />}
              </>
            ) : (
              "Not yet observed"
            )}
          </dd>
          <dt className="text-zinc-500">Camera service</dt>
          <dd className="flex items-center gap-2">
            {incident.cameraService ? (
              <>
                {incident.cameraService.running ? "Running" : "Stopped"}
                {incident.cameraService.source === "simulated" && <SimulatedBadge />}
              </>
            ) : (
              "Not yet observed"
            )}
          </dd>
        </dl>
      </section>

      <section>
        <h3 className="font-semibold">Dispatcher actions</h3>
        {incident.actions.length === 0 ? (
          <p className="text-sm text-zinc-500">None yet. The Dispatcher needs both observations before it acts.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {incident.actions.map((a) => (
              <li key={a.id} className="flex flex-col gap-1 text-sm">
                <span className="flex items-center gap-2">
                  <span className="font-medium">{ACTION_LABEL[a.kind]}</span>
                  <span className={`rounded px-1.5 py-0.5 text-xs ${ACTION_STATUS_STYLE[a.status]}`}>{a.status}</span>
                </span>
                <span className="text-zinc-500">{a.reason}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="font-semibold">Timeline</h3>
        <ol className="mt-2 flex flex-col gap-1.5 text-sm">
          {incident.timeline.map((t, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-zinc-500">
                +{Math.round((t.at - incident.openedAt) / 1000)}s
              </span>
              {t.kind === "observation" && t.source === "simulated" && <SimulatedBadge />}
              {t.kind === "decision" && (
                <span className="rounded bg-blue-600 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">
                  Decision
                </span>
              )}
              <span className={t.kind === "note" ? "text-zinc-500" : ""}>{t.text}</span>
            </li>
          ))}
        </ol>
      </section>
    </article>
  );
}

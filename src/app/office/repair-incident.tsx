import { useState } from "react";
import { SCENARIOS, runScenario, type Scenario } from "@/lib/camera-incident";
import { cameraReport, PHASE_LABEL } from "@/lib/office-camera-report";

export function useRepairIncident() {
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [stepCount, setStepCount] = useState(0);
  const [startAt, setStartAt] = useState(0);
  const incident = scenario ? runScenario(scenario, stepCount, startAt) : null;
  function start(selected: Scenario) {
    setScenario(selected);
    setStartAt(Date.now());
    setStepCount(1);
  }
  return {
    incident, scenario, stepCount, start,
    nextStep: scenario?.steps[stepCount],
    finished: !!scenario && stepCount >= scenario.steps.length,
    next: () => setStepCount(count => scenario ? Math.min(count + 1, scenario.steps.length) : count),
    runToEnd: () => { if (scenario) setStepCount(scenario.steps.length); },
    reset: () => { setScenario(null); setStepCount(0); },
  };
}

export type RepairIncident = ReturnType<typeof useRepairIncident>;

export function inspectorStatus(repair: RepairIncident) {
  return repair.incident ? PHASE_LABEL[repair.incident.phase] : "Ready for a request";
}

export function RepairIncidentPanel({ incident: repair, onSelectWorker }: { incident: RepairIncident; onSelectWorker: () => void }) {
  const { incident, scenario, stepCount, finished, nextStep } = repair;
  const report = incident ? cameraReport(incident) : null;
  return (
    <section className="office-incident" aria-labelledby="repair-title">
      <div className="office-incidentHeading">
        <div><p className="office-eyebrow">SIMULATED INCIDENT{incident ? ` · ${incident.id}` : ""}</p><h2 id="repair-title">Packing Station 1 · feed health</h2></div>
        <span className={`office-feedBadge ${incident?.status === "open" ? "office-feedStopped" : ""}`}>{!incident ? "SIMULATED · ready" : incident.status === "resolved" ? "SIMULATED · feed restored" : "SIMULATED · feed stopped"}</span>
      </div>
      <div className="office-scenarioCases" aria-label="Choose a simulator case">
        {SCENARIOS.map(item => <button className="office-scenarioCase" key={item.id} type="button" aria-pressed={scenario?.id === item.id} onClick={() => repair.start(item)}><strong>{item.title}</strong><span>{item.description}</span></button>)}
      </div>
      <div className="office-incidentLayout">
        <div className="office-feedPreview">
          <div className={`office-feedImage ${incident?.status === "open" ? "office-feedOffline" : ""}`} aria-hidden="true"><span>▣</span><i /><i /><i /></div>
          <p>{!incident ? "SIMULATED feed · no camera connected" : incident.status === "resolved" ? "SIMULATED fresh frame received" : "SIMULATED · waiting for a fresh frame"}</p>
        </div>
        <div>
          <ol className="office-incidentEvents" aria-label="Simulator incident events">
            <li><strong>01 · Feed monitor</strong><span>{incident ? "SIMULATED: Camera feed stopped. Incident opened." : "Choose a case to simulate a stopped feed."}</span></li>
            <li><strong>02 · Dispatcher</strong><span>{report?.actions.length ? report.actions.map(action => `${action.label} (${action.status}). ${action.reason}`).join(" ") : "Waiting for USB camera detection and camera service status before acting."}</span></li>
            <li><strong>03 · Quality Inspector</strong><span>{report ? `${report.heading}. ${report.uncertainty}` : "Ready to review simulator evidence and the Dispatcher's decision."}</span></li>
          </ol>
          <p className="office-incidentUpdate" role="status">{incident ? `SIMULATED · Incident ${incident.status} · ${PHASE_LABEL[incident.phase]} · Observation ${stepCount}/${scenario?.steps.length}` : "SIMULATED · Ready to run a shared camera simulator case."}</p>
        </div>
      </div>
      <div className="office-incidentControls">
        {scenario && <>
          <button className="office-reset" type="button" disabled={finished} onClick={repair.next}>{nextStep ? `Next observation: ${nextStep.label}` : "No more observations"}</button>
          <button className="office-reset" type="button" disabled={finished} onClick={repair.runToEnd}>Run to end</button>
          <button className="office-reset" type="button" onClick={repair.reset}>Restart feed demo</button>
          <button className="office-reset" type="button" onClick={onSelectWorker}>View worker report <span aria-hidden="true">↗</span></button>
        </>}
      </div>
      <p className="office-finePrint">SIMULATED observations and decisions from the shared camera simulator. No hardware, service restart, visit booking, or supplier calls. Case selection and incident restart preserve your hire.</p>
    </section>
  );
}

export function RepairWorkerReport({ incident: repair }: { incident: RepairIncident }) {
  const { incident } = repair;
  if (!incident) return null;
  const report = cameraReport(incident);
  return (
    <section className="office-repairReport" aria-labelledby="worker-repair-title">
      <p className="office-eyebrow">SIMULATED · {incident.id}</p>
      <h3 id="worker-repair-title">{report.heading}</h3>
      <p>Incident {incident.status} · {incident.station}</p>
      <h4>Evidence</h4><ul>{report.evidence.map((item, index) => <li key={index}>SIMULATED · +{(item.at - incident.openedAt) / 1000}s · {item.text}</li>)}</ul>
      <h4>Action taken</h4>{report.actions.length ? <ul>{report.actions.map(action => <li key={action.id}><strong>{action.label} · {action.status}</strong><br />{action.reason}</li>)}</ul> : <p>No action requested yet. The Dispatcher is waiting for both observations.</p>}
      <h4>Does someone need to visit?</h4><p className="office-visitDecision">{report.visit}</p>
      <h4>Uncertainty</h4><p>{report.uncertainty}</p>
      <details className="office-reportTimeline"><summary>Full simulator timeline</summary><ol>{incident.timeline.map((entry, index) => <li key={index}>+{(entry.at - incident.openedAt) / 1000}s · {entry.source === "simulated" ? "SIMULATED · " : ""}{entry.text}</li>)}</ol></details>
      <p className="office-finePrint">SIMULATED report. A requested action is not a completed repair. Only a fresh frame resolves this incident.</p>
    </section>
  );
}

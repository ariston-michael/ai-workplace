import { useEffect, useState } from "react";

type Stage = "watching" | "stopped" | "assigned" | "reported";
type Scenario = "cable" | "service";

const reports = {
  cable: {
    finding: "Camera connection needs an on-site check",
    evidence: ["No new frames arrived for 15 seconds.", "The station heartbeat stayed available.", "The demo device log reports camera disconnected; a stream restart returned device unavailable."],
    action: "Attempted one stream-service restart in the simulation. The feed did not recover. Left the incident open for an operator.",
    visit: "Yes — check the camera cable and power at Packing Station 1.",
    uncertainty: "A loose cable is suspected, not confirmed. A failed camera or power issue could produce the same symptoms.",
  },
  service: {
    finding: "Stalled stream recovered remotely",
    evidence: ["No new frames arrived for 15 seconds.", "The station heartbeat and camera-device check stayed available.", "After the simulated restart, three consecutive new frames arrived."],
    action: "Restarted the stream service once in the simulation and verified that frame delivery resumed.",
    visit: "No visit indicated by this demo report. Monitor the feed; escalate if it stops again.",
    uncertainty: "Recovery does not establish the root cause. The service logs need review if the fault recurs.",
  },
} satisfies Record<Scenario, { finding: string; evidence: string[]; action: string; visit: string; uncertainty: string }>;

export function useRepairIncident() {
  const [stage, setStage] = useState<Stage>("watching");
  const [scenario, setScenario] = useState<Scenario>("cable");

  useEffect(() => {
    if (stage !== "stopped" && stage !== "assigned") return;
    const next = stage === "stopped" ? "assigned" : "reported";
    const timer = window.setTimeout(() => setStage(next), stage === "stopped" ? 1600 : 3200);
    return () => window.clearTimeout(timer);
  }, [stage]);

  return {
    stage, scenario, setScenario,
    stopFeed: () => setStage("stopped"),
    reset: () => setStage("watching"),
  };
}

export type RepairIncident = ReturnType<typeof useRepairIncident>;

export function inspectorStatus(stage: Stage) {
  return stage === "assigned" ? "Diagnosing feed" : stage === "reported" ? "Report ready" : "Ready for a request";
}

export function RepairIncidentPanel({ incident, onSelectWorker }: { incident: RepairIncident; onSelectWorker: () => void }) {
  const { stage, scenario } = incident;
  const reported = stage === "reported";
  const assigned = stage === "assigned" || reported;
  const recovered = reported && scenario === "service";

  return (
    <section className="office-incident" aria-labelledby="repair-title">
      <div className="office-incidentHeading">
        <div><p className="office-eyebrow">SIMULATED INCIDENT · REPAIR-001</p><h2 id="repair-title">Packing Station 1 · feed health</h2></div>
        <span className={`office-feedBadge ${stage !== "watching" && !recovered ? "office-feedStopped" : ""}`}>{stage === "watching" ? "Demo feed available" : recovered ? "Demo feed restored" : "Demo feed stopped"}</span>
      </div>
      <div className="office-incidentLayout">
        <div className="office-feedPreview">
          <div className={`office-feedImage ${stage !== "watching" && !recovered ? "office-feedOffline" : ""}`} aria-hidden="true"><span>▣</span><i /><i /><i /></div>
          <p>{stage === "watching" ? "Sample feed · no camera connected" : recovered ? "Sample frames resumed after restart" : "Sample frame delivery interrupted"}</p>
        </div>
        <div>
          <ol className="office-incidentEvents" aria-label="Demo incident events">
            <li><strong>01 · Feed monitor</strong><span>{stage === "watching" ? "Waiting for a demo feed-stop event." : "Feed stopped: no frames for 15 seconds. Incident opened."}</span></li>
            <li className={!assigned ? "office-pendingEvent" : ""}><strong>02 · Dispatcher</strong><span>{assigned ? "Assigned REPAIR-001 to Quality Inspector for a remote feed check." : "Assignment pending."}</span></li>
            <li className={!reported ? "office-pendingEvent" : ""}><strong>03 · Quality Inspector</strong><span>{reported ? reports[scenario].finding : stage === "assigned" ? "Checking sample heartbeat, device log, and restart result…" : "Report pending."}</span></li>
          </ol>
          <p className="office-incidentUpdate" role="status">{stage === "watching" ? "Ready to simulate a feed interruption." : stage === "stopped" ? "Feed stop detected. Dispatcher is reviewing the incident…" : stage === "assigned" ? "Quality Inspector is diagnosing the demo incident…" : scenario === "cable" ? "Report ready. An on-site visit is recommended; the demo feed remains stopped." : "Report ready. Demo feed restored; no visit currently indicated."}</p>
        </div>
      </div>
      <div className="office-incidentControls">
        <label>Demo fault<select value={scenario} disabled={stage !== "watching"} onChange={event => incident.setScenario(event.target.value as Scenario)}><option value="cable">Suspected loose camera cable</option><option value="service">Stalled stream service</option></select></label>
        {stage === "watching" ? <button className="office-reset" type="button" onClick={incident.stopFeed}>Simulate feed stop</button> : <button className="office-reset" type="button" onClick={incident.reset}>Restart feed demo</button>}
        {assigned && <button className="office-reset" type="button" onClick={onSelectWorker}>{reported ? "View worker report" : "View assigned worker"} <span aria-hidden="true">↗</span></button>}
      </div>
      <p className="office-finePrint">Scripted local events and sample evidence only. No live monitoring, service restart, or visit booking occurs.</p>
    </section>
  );
}

export function RepairWorkerReport({ incident }: { incident: RepairIncident }) {
  if (incident.stage === "watching") return null;
  const report = reports[incident.scenario];
  return (
    <section className="office-repairReport" aria-labelledby="worker-repair-title">
      <p className="office-eyebrow">REPAIR-001 · DEMO REPORT</p>
      <h3 id="worker-repair-title">{incident.stage === "reported" ? report.finding : "Feed interruption investigation"}</h3>
      {incident.stage !== "reported" ? <p>{incident.stage === "stopped" ? "Waiting for the Dispatcher to assign the incident." : "Assigned by the Dispatcher. Checking sample heartbeat and device logs, then attempting a simulated stream restart. Evidence and visit decision will appear when the report arrives."}</p> : <>
        <h4>Evidence</h4><ul>{report.evidence.map(item => <li key={item}>{item}</li>)}</ul>
        <h4>Action taken</h4><p>{report.action}</p>
        <h4>Does someone need to visit?</h4><p className="office-visitDecision">{report.visit}</p>
        <h4>Uncertainty</h4><p>{report.uncertainty}</p>
        <p className="office-finePrint">All observations and actions above are simulated. Report received; {incident.scenario === "cable" ? "repair remains unresolved." : "feed recovery is simulated."}</p>
      </>}
    </section>
  );
}

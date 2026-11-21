import type { Incident } from "@/lib/camera-incident";
import { cameraReport } from "@/lib/office-camera-report";

/** Saved camera incident report from the shared simulator. Everything here is SIMULATED. */
export function CameraIncidentReport({ incident }: { incident: Incident }) {
  const report = cameraReport(incident);
  return (
    <section className="office-repairReport" aria-label="Camera incident report">
      <p className="office-eyebrow">SIMULATED · {incident.station}</p>
      <h3>{report.heading}</h3>
      <p>Incident {incident.status}</p>
      <h4>Evidence</h4>
      <ul>{report.evidence.map((item, index) => <li key={index}>SIMULATED · +{(item.at - incident.openedAt) / 1000}s · {item.text}</li>)}</ul>
      <h4>Action taken</h4>
      {report.actions.length ? <ul>{report.actions.map(action => <li key={action.id}><strong>{action.label} · {action.status}</strong><br />{action.reason}</li>)}</ul> : <p>No action requested.</p>}
      <h4>Does someone need to visit?</h4><p className="office-visitDecision">{report.visit}</p>
      <h4>Uncertainty</h4><p>{report.uncertainty}</p>
      <details className="office-reportTimeline"><summary>Full simulator timeline</summary><ol>{incident.timeline.map((entry, index) => <li key={index}>+{(entry.at - incident.openedAt) / 1000}s · {entry.source === "simulated" ? "SIMULATED · " : ""}{entry.text}</li>)}</ol></details>
      <p className="office-finePrint">SIMULATED report. A requested action is not a completed repair. Only a fresh frame resolves this incident.</p>
    </section>
  );
}

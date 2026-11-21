"use client";

import { useEffect, useRef, useState } from "react";
import "./office.css";
import { inspectorStatus, RepairIncidentPanel, RepairWorkerReport, useRepairIncident } from "./repair-incident";

type Worker = {
  id: string;
  role: string;
  initials: string;
  specialty: string;
  skills: string[];
  rate?: number;
  color: string;
};

const dispatcher: Worker = {
  id: "dispatcher", role: "Dispatcher", initials: "DI", color: "coral",
  specialty: "The first stop for every request. Finds the right skills and coordinates the team.",
  skills: ["Request triage", "Task routing", "Team coordination"],
};
const inspector: Worker = {
  id: "inspector", role: "Quality Inspector", initials: "QI", color: "sage",
  specialty: "Checks component trays and flags missing parts for review.",
  skills: ["Visual inspection", "Missing-part detection", "Inspection reports"],
};
const candidates: Worker[] = [
  {
    id: "catalog", role: "Catalog Assistant", initials: "CA", color: "gold", rate: 4,
    specialty: "Find the right part in your internal records.",
    skills: ["Internal catalog search", "Part identification", "Record matching"],
  },
  {
    id: "procurement", role: "Procurement Researcher", initials: "PR", color: "blue", rate: 6,
    specialty: "Research replacement parts across public supplier websites.",
    skills: ["Supplier research", "Availability checks", "Source-linked findings"],
  },
];

function Avatar({ worker, small = false }: { worker: Worker; small?: boolean }) {
  return <span aria-hidden="true" className={`office-avatar office-${worker.color} ${small ? "office-smallAvatar" : ""}`}>{worker.initials}</span>;
}

function Station({ worker, station, label, selected, onClick, status }: {
  worker?: Worker; station: string; label: string; selected: boolean; onClick: () => void; status?: string;
}) {
  return (
    <button type="button" className={`office-station office-${station} ${selected ? "office-selected" : ""} ${!worker ? "office-vacant" : ""}`}
      onClick={onClick} aria-label={worker ? `${label}: ${worker.role}. View role and status` : "Empty desk: open marketplace"}
      aria-pressed={selected} aria-controls="office-panel">
      <span className="office-stationArt" aria-hidden="true">
        <span className="office-chair" />
        {worker && <Avatar key={worker.id} worker={worker} small />}
        <span className="office-desk"><span className="office-monitor" /><span className="office-keyboard" /><span className="office-notebook" /><span className="office-cup" /></span>
        {!worker && <span className="office-add">+</span>}
      </span>
      <span className="office-stationLabel"><span>{worker?.role ?? "Your next teammate"}</span><small>{worker ? `${label}${status ? ` · ${status}` : ""}` : "Empty desk · hire a worker"}</small></span>
    </button>
  );
}

export default function Office() {
  const [selection, setSelection] = useState<string | null>(null);
  const [hire, setHire] = useState<Worker | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const panelHeading = useRef<HTMLHeadingElement>(null);
  const incident = useRepairIncident();
  const inspectorBusy = incident.stage === "assigned";
  const worker = selection === "dispatcher" ? dispatcher : selection === "inspector" ? inspector : selection === "desk" ? hire : null;
  const marketplace = selection === "desk" && !hire;

  useEffect(() => {
    if (selection) panelHeading.current?.focus();
  }, [selection, hire]);

  function selectStation(station: string) {
    if (selection === station) panelHeading.current?.focus();
    else setSelection(station);
  }

  function hireWorker(candidate: Worker) {
    if (hire) return;
    setHire(candidate);
    setAnnouncement(`${candidate.role} hired for the demo and seated at Desk 02. Ready for a request.`);
  }

  function resetDemo() {
    setHire(null);
    incident.reset();
    setSelection(null);
    setAnnouncement("Demo reset. Desk 02 is available again and the sample feed is available.");
  }

  return (
    <main className="office-office">
      <header className="office-header">
        <a className="office-brand" href="/office"><span className="office-logo" aria-hidden="true">a<span>i</span></span> AI Workplace</a>
        <span className="office-demoBadge"><span /> LOCAL DEMO</span>
      </header>

      <div className="office-workspace">
        <div className="office-pageHeading">
          <div><p className="office-eyebrow">WORKSPACE / OFFICE 01</p><h1>A little space. A capable team.</h1><p>Meet your workers, find a new skill, and make room for what’s next.</p></div>
          <button className="office-reset" type="button" onClick={resetDemo}>Reset demo <span aria-hidden="true">↺</span></button>
        </div>

        <RepairIncidentPanel incident={incident} onSelectWorker={() => selectStation("inspector")} />

        <div className="office-layout">
          <section className="office-officeCard" aria-labelledby="floor-title">
            <div className="office-floorHeader"><div><span className="office-liveDot" /><h2 id="floor-title">Your office</h2></div><span>{hire ? 3 : 2} workers <span className="office-separator">/</span> {hire ? 0 : 1} open desk</span></div>
            <div className="office-floor">
              <div className="office-window" aria-hidden="true"><i /><i /><i /></div>
              <div className="office-plant office-plantOne" aria-hidden="true">✦</div>
              <div className="office-plant office-plantTwo" aria-hidden="true">✦</div>
              <span className="office-roomLabel">THE WORKROOM</span>
              <div className="office-rug" aria-hidden="true" />
              <Station worker={inspector} station="inspection" label="Workstation 01" status={inspectorStatus(incident.stage)} selected={selection === "inspector"} onClick={() => selectStation("inspector")} />
              <Station worker={hire ?? undefined} station="openDesk" label="Desk 02" selected={selection === "desk"} onClick={() => selectStation("desk")} />
              <div className="office-divider" aria-hidden="true" />
              <span className="office-receptionLabel">RECEPTION</span>
              <Station worker={dispatcher} station="reception" label="Reception" status={incident.stage === "stopped" ? "Reviewing incident" : incident.stage === "assigned" ? "Job assigned" : undefined} selected={selection === "dispatcher"} onClick={() => selectStation("dispatcher")} />
              <div className="office-sofa" aria-hidden="true"><i /><i /><i /></div>
              <div className="office-coffeeTable" aria-hidden="true"><span /></div>
              <span className="office-entry" aria-hidden="true">WELCOME IN ↑</span>
            </div>
            <div className="office-floorFooter"><span aria-hidden="true">↖</span> Select a desk to meet a worker or hire someone new.</div>
          </section>

          <aside id="office-panel" className="office-panel" aria-labelledby="panel-title">
            <div className="office-panelHeader"><p className="office-eyebrow">{marketplace ? "FIND YOUR NEXT TEAMMATE" : worker ? "WORKER DETAILS" : "A PLACE TO GET THINGS DONE"}</p><h2 id="panel-title" ref={panelHeading} tabIndex={-1}>{marketplace ? "The marketplace" : worker ? worker.role : "Good teams start here."}</h2></div>

            {marketplace ? (
              <div className="office-panelBody">
                <p className="office-muted">One open desk. Two different skill sets. Choose the teammate your work needs.</p>
                {candidates.map(candidate => (
                  <article key={candidate.id} className="office-candidate">
                    <div className="office-candidateHeading"><Avatar worker={candidate} /><div><h3>{candidate.role}</h3><span className="office-rate">${candidate.rate}<small> / hour</small></span></div></div>
                    <p>{candidate.specialty}</p>
                    <ul className="office-skills">{candidate.skills.map(skill => <li key={skill}>{skill}</li>)}</ul>
                    <button className="office-hireButton" type="button" onClick={() => hireWorker(candidate)}>Hire {candidate.role} <span aria-hidden="true">↗</span></button>
                  </article>
                ))}
                <p className="office-finePrint">Sample hourly rates. Demo hires are free and last until you refresh or reset. No live tasks run from this page.</p>
              </div>
            ) : worker ? (
              <div className="office-panelBody">
                <div className="office-profile"><Avatar worker={worker} /><span className="office-status"><span /> {worker.id === "inspector" ? inspectorStatus(incident.stage) : worker.id === "dispatcher" && incident.stage === "stopped" ? "Reviewing incident" : "Ready"} · demo</span></div>
                <p className="office-description">{worker.specialty}</p>
                {worker.id === "inspector" && <RepairWorkerReport incident={incident} />}
                {worker.id === "dispatcher" && incident.stage !== "watching" && <div className="office-note"><p>{incident.stage === "stopped" ? "Reviewing REPAIR-001: the Packing Station 1 demo feed stopped. Preparing a remote check assignment." : "Assigned REPAIR-001 to Quality Inspector for a remote feed check."} {incident.stage === "reported" && "The worker report is ready for review."}</p></div>}
                {worker.id === "dispatcher" && (incident.stage === "assigned" || incident.stage === "reported") && <button className="office-hireButton" type="button" onClick={() => selectStation("inspector")}>View assigned worker <span aria-hidden="true">↗</span></button>}
                <h3 className="office-sectionLabel">SKILLS</h3><ul className="office-skills">{worker.skills.map(skill => <li key={skill}>{skill}</li>)}</ul>
                <dl className="office-details"><div><dt>Station</dt><dd>{worker.id === "dispatcher" ? "Reception" : worker.id === "inspector" ? "Workstation 01" : "Desk 02"}</dd></div><div><dt>Current status</dt><dd>{worker.id === "inspector" ? inspectorStatus(incident.stage) : worker.id === "dispatcher" && incident.stage === "stopped" ? "Reviewing incident" : "Ready for a request"}</dd></div><div><dt>Active tasks</dt><dd>{worker.id === "inspector" && inspectorBusy ? 1 : 0}</dd></div>{worker.rate !== undefined && <div><dt>Demo hourly rate</dt><dd>${worker.rate} / hour</dd></div>}</dl>
                <div className="office-note"><span aria-hidden="true">↳</span><p>{worker.id === "inspector" ? "This is a demo worker. No inspection or hardware is connected." : worker.id === "dispatcher" ? "Your demo coordinator assigns the sample feed incident to Quality Inspector. General request routing is not connected." : "Your new teammate is seated and ready. This demo hire does not run supplier searches or create charges."}</p></div>
              </div>
            ) : (
              <div className="office-panelBody">
                <div className="office-welcomeArt" aria-hidden="true"><span>✳</span><span>↗</span><span>✦</span></div>
                <p className="office-description">Your office brings specialized AI workers together, one desk at a time.</p>
                <ol className="office-steps"><li><span>01</span><p><strong>Meet the team</strong>Select reception or the inspection workstation.</p></li><li><span>02</span><p><strong>Make your next hire</strong>Select the empty desk to compare skills and rates.</p></li><li><span>03</span><p><strong>See your team grow</strong>Your new worker takes a seat in the office.</p></li></ol>
                <button className="office-hireButton" type="button" onClick={() => selectStation("desk")}>Explore the empty desk <span aria-hidden="true">↗</span></button>
              </div>
            )}
          </aside>
        </div>
        <p className="office-announcement" role="status">{announcement}</p>
        <footer className="office-pageFooter"><span>Built around the work. And the people directing it.</span><span>Demo workspace · local state only</span></footer>
      </div>
    </main>
  );
}

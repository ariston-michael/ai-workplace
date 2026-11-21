"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { DISPATCHER } from "@/lib/workplace/catalog";
import { MAP_WIDTH, MAP_HEIGHT, MAP_STATIONS, MAP_DECOR, RECEPTION, type Rect, type MapSize } from "@/lib/workplace/office-map";
import { workerMovement } from "@/lib/workplace/movement";
import type { HireView, JobView } from "@/lib/workplace/types";
import PixelCharacter from "./pixel-character";
import { OfficeWalker } from "./office-walker";
import "./office-map.css";

const rectStyle = (rect: Rect): CSSProperties => ({ left: `${rect.x / MAP_WIDTH * 100}%`, top: `${rect.y / MAP_HEIGHT * 100}%`, width: `${rect.width / MAP_WIDTH * 100}%`, height: `${rect.height / MAP_HEIGHT * 100}%` });


function Desk({ desk, chair, role, label, status, color, selected, onClick }: {
  desk: Rect; chair: Rect; role?: string; label: string; status?: string; color?: string; selected: boolean; onClick: () => void;
}) {
  return <button type="button" className={`office-mapStation ${role ? "" : "office-mapVacant"}`} style={rectStyle(desk)} onClick={onClick}
    aria-pressed={selected} aria-controls="office-panel" aria-label={role ? `${label}: ${role}${status ? `, ${status}` : ""}. View role and status` : `${label}, empty desk: open marketplace`}>
    <span className="office-mapChair" data-furniture={chair.id} aria-hidden="true" style={{ left: `${(chair.x - desk.x) / desk.width * 100}%`, top: `${(chair.y - desk.y) / desk.height * 100}%`, width: `${chair.width / desk.width * 100}%`, height: `${chair.height / desk.height * 100}%` }} />
    <span className="office-mapDesk" data-furniture={desk.id} aria-hidden="true"><span className="office-mapMonitor" /><span className="office-mapKeyboard" /><span className="office-mapNotebook" /><span className="office-mapCup" /></span>
    {color && <span className="office-mapDispatcher" aria-hidden="true"><PixelCharacter id="dispatcher" gesture="wave" /></span>}
    {!role && <span className="office-mapAdd" aria-hidden="true">+</span>}
    <span className="office-mapStationLabel"><strong>{role ?? "Your next teammate"}</strong><small>{label} · {status ?? (role ? "Ready" : "hire a worker")}</small></span>
  </button>;
}

function Worker({ hire, jobs, size, arriving, selected, onClick }: {
  hire: HireView; jobs: JobView[]; size: MapSize; arriving: boolean; selected: boolean; onClick: (jobId?: string) => void;
}) {
  const movement = workerMovement(hire, jobs);
  const button = useRef<HTMLButtonElement>(null);
  const walker = useRef<OfficeWalker | null>(null);
  // This snapshot is used only for initial placement: old events never replay on reload.
  const [initial] = useState(() => ({ desk: hire.desk, size, movement, arriving }));
  useLayoutEffect(() => {
    if (!button.current) return;
    walker.current = new OfficeWalker(button.current, initial.desk, initial.size, initial.movement, initial.arriving);
    return () => { walker.current?.dispose(); walker.current = null; };
  }, [initial]);
  useLayoutEffect(() => { walker.current?.resize(size); }, [size]);
  useEffect(() => { walker.current?.update(movement); }, [movement]);
  const report = movement.kind === "returned";
  const label = report ? "Report ready. Read saved report" : movement.kind === "failed" ? "Returned with an error. View outcome" : movement.kind === "working" ? "Working on a job" : movement.kind === "assigned" ? "Assigned to workstation" : "View worker";
  return <button ref={button} type="button" className="office-mapWalker" data-worker-id={hire.id} data-desk={hire.desk} data-movement={movement.kind}
    aria-label={`${hire.role}: ${label} · ${hire.characterName}`} aria-pressed={selected} aria-controls="office-panel" onClick={() => onClick(movement.jobId)} title={`${hire.role} · ${label}`}>
    <PixelCharacter key={movement.eventKey} sprite={hire.sprite} gesture={movement.kind === "working" ? "work" : report ? "report" : "idle"} />
    {report && <span className="office-mapReportBadge" aria-hidden="true">▤</span>}
    {movement.kind === "failed" && <span className="office-mapReportBadge" aria-hidden="true">!</span>}
    <span className="office-mapWorkerLabel">{hire.role}{report ? " · Report ready" : ""}</span>
  </button>;
}

export default function OfficeMap({ team, jobs, loaded, arrivals, selectedHire, selectedDesk, dispatcherSelected, onWorker, onDesk, onDispatcher }: {
  team: HireView[]; jobs: JobView[]; loaded: boolean; arrivals: Set<string>; selectedHire?: string; selectedDesk?: string; dispatcherSelected: boolean;
  onWorker: (hireId: string, jobId?: string) => void; onDesk: (desk: string) => void; onDispatcher: () => void;
}) {
  const floor = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<MapSize | null>(null);
  useLayoutEffect(() => {
    const element = floor.current;
    if (!element) return;
    const resize = () => setSize(previous => {
      const width = element.clientWidth, height = element.clientHeight;
      return previous?.width === width && previous.height === height ? previous : { width, height };
    });
    resize();
    const observer = new ResizeObserver(resize); observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return <div ref={floor} className="office-floor office-pixelMap" aria-label="Office map with walkable aisles">
    <span className="office-mapRoomLabel">THE WORKROOM</span>
    <span className="office-mapAisle office-mapAisle-vertical" aria-hidden="true" /><span className="office-mapAisle office-mapAisle-horizontal" aria-hidden="true" />
    {MAP_DECOR.map(rect => <span key={rect.id} data-furniture={rect.id} className={`office-mapDecor office-mapDecor-${rect.id}`} style={rectStyle(rect)} aria-hidden="true">{rect.id.startsWith("plant") && <i />}</span>)}
    {MAP_STATIONS.map(station => {
      const hire = team.find(item => item.desk === station.id);
      const movement = hire ? workerMovement(hire, jobs) : null;
      const status = movement?.kind === "returned" ? "Report at reception" : movement?.kind === "working" ? "Working" : movement?.kind === "assigned" ? "Assigned" : undefined;
      return <Desk key={station.id} desk={station.desk} chair={station.chair} label={station.label} role={hire?.role} status={status}
        selected={hire ? selectedHire === hire.id : selectedDesk === station.id} onClick={() => hire ? onWorker(hire.id) : onDesk(station.id)} />;
    })}
    <Desk desk={RECEPTION.desk} chair={RECEPTION.chair} role={DISPATCHER.role} label="Reception" status="Entrance" color={DISPATCHER.color} selected={dispatcherSelected} onClick={onDispatcher} />
    <span className="office-mapReceptionLabel">RECEPTION</span>
    <span className="office-mapDoor" aria-hidden="true" /><span className="office-mapEntranceLabel">ENTRANCE ↑</span>
    {loaded && size && team.map(hire => <Worker key={hire.id} hire={hire} jobs={jobs} size={size} arriving={arrivals.has(hire.id)} selected={selectedHire === hire.id}
      onClick={jobId => onWorker(hire.id, jobId)} />)}
  </div>;
}

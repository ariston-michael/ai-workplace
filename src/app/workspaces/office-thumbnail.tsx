import { MAP_DECOR, MAP_HEIGHT, MAP_STATIONS, MAP_WIDTH, RECEPTION, type Rect } from "@/lib/workplace/office-map";
import PixelCharacter from "../office/pixel-character";
import "../office/office-map.css";

const rectStyle = (rect: Rect) => ({
  left: `${rect.x / MAP_WIDTH * 100}%`,
  top: `${rect.y / MAP_HEIGHT * 100}%`,
  width: `${rect.width / MAP_WIDTH * 100}%`,
  height: `${rect.height / MAP_HEIGHT * 100}%`,
});

function Desk({ desk, chair, label, role, reception = false }: {
  desk: Rect;
  chair: Rect;
  label: string;
  role?: string;
  reception?: boolean;
}) {
  return <div className={`office-mapStation ${reception ? "office-mapReception" : role ? "" : "office-mapVacant"}`} style={rectStyle(desk)}>
    <span className="office-mapChair" aria-hidden="true" style={{
      left: `${(chair.x - desk.x) / desk.width * 100}%`,
      top: `${(chair.y - desk.y) / desk.height * 100}%`,
      width: `${chair.width / desk.width * 100}%`,
      height: `${chair.height / desk.height * 100}%`,
    }} />
    <span className="office-mapDesk" aria-hidden="true">
      <span className="office-mapMonitor" />
      <span className="office-mapKeyboard" />
      <span className="office-mapNotebook" />
      <span className="office-mapCup" />
      <span className="office-mapFiles" />
      <span className="office-mapDeskLamp" />
    </span>
    {reception && <span className="office-mapDispatcher"><PixelCharacter id="dispatcher" gesture="idle" /></span>}
    <span className="office-mapStationLabel"><strong>{reception ? "RECEPTION" : label.toUpperCase()}</strong><small>{role ?? "Vacant · hire"}</small></span>
  </div>;
}

export default function OfficeThumbnail() {
  return <div className="workspaces-miniOfficeFrame" aria-hidden="true">
    <div className="office-office workspaces-miniOfficeShell">
      <div className="office-floor office-pixelMap workspaces-miniOffice" style={{ width: MAP_WIDTH, height: MAP_HEIGHT }}>
        <div className="office-mapWall" />
        <span className="office-mapRoomLabel">WORK / PLAY / REPEAT</span>
        {MAP_STATIONS.map(station => <span key={station.id} className="office-mapCubicleFloor" style={{
          left: `${(station.desk.x - 30) / 10}%`,
          top: `${(station.desk.y - 97) / 7.2}%`,
          width: "27%",
          height: "31%",
        }} />)}
        <span className="office-mapAisle office-mapAisle-vertical" />
        <span className="office-mapAisle office-mapAisle-horizontal" />
        {MAP_DECOR.map(rect => <span key={rect.id} className={`office-mapDecor office-mapDecor-${rect.id}`} style={rectStyle(rect)}>
          {rect.id.startsWith("plant") && <i />}
        </span>)}
        {MAP_STATIONS.map((station, index) => <Desk key={station.id} desk={station.desk} chair={station.chair} label={station.label}
          role={index === 0 ? "Quality Inspector" : undefined} />)}
        <Desk desk={RECEPTION.desk} chair={RECEPTION.chair} label="Reception" role="Dispatcher" reception />
        <span className="office-mapReceptionLabel">WELCOME / DISPATCH</span>
        <span className="office-mapDoor" />
        <span className="office-mapEntranceLabel">ENTER ↑</span>
        <span className="workspaces-miniWorker" style={{
          left: `${MAP_STATIONS[0].seat.x / MAP_WIDTH * 100}%`,
          top: `${MAP_STATIONS[0].seat.y / MAP_HEIGHT * 100}%`,
        }}><PixelCharacter id="quality_inspector" gesture="idle" /></span>
      </div>
    </div>
  </div>;
}

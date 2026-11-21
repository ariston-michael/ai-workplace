/** Original office illustration shared by the workspace cards. Decorative, not a live floor. */
export default function OfficeThumbnail() {
  return <div className="workspaces-miniOffice" aria-hidden="true">
    <div className="workspaces-miniWindow" />
    <div className="workspaces-miniRug" />
    {["one", "two", "three"].map(position => <div key={position} className={`workspaces-miniDesk workspaces-miniDesk-${position}`}><i /><span /><b /></div>)}
    <div className="workspaces-miniReception"><span /></div>
    <div className="workspaces-miniPlant workspaces-miniPlant-one">✦</div><div className="workspaces-miniPlant workspaces-miniPlant-two">✦</div>
    <div className="workspaces-miniDoor" />
  </div>;
}

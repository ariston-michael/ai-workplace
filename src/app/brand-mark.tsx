import PixelCharacter from "./office/pixel-character";
import "./brand-mark.css";

export default function BrandMark() {
  return <span className="brand-mark" aria-hidden="true">
    <PixelCharacter id="dispatcher" gesture="idle" facing="south" accentOverride="#36c7e8" />
  </span>;
}

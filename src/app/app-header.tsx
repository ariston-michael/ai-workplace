import Link from "next/link";
import BrandMark from "./brand-mark";
import "./app-header.css";

/** Shared geometry keeps navigation steady when the route or viewer changes. */
export default function AppHeader({ active, viewer }: {
  active: "workspaces" | "marketplace";
  viewer: string | null;
}) {
  return <header className="app-header">
    <Link href="/" className="app-headerBrand"><BrandMark /> AI Workplace</Link>
    <nav className="app-headerNav" aria-label="Main">
      <Link href="/" aria-current={active === "workspaces" ? "page" : undefined}>Workspaces</Link>
      <Link href="/marketplace" aria-current={active === "marketplace" ? "page" : undefined}>Marketplace</Link>
    </nav>
    <div className="app-headerViewer">
      {viewer && <><span className="app-headerIdentity">Signed in as <strong>{viewer}</strong></span><span aria-hidden="true">·</span><a href="/auth/logout">Log out</a></>}
    </div>
  </header>;
}

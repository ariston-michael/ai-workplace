import type { Metadata } from "next";
import { Suspense } from "react";
import Marketplace from "./marketplace";

export const metadata: Metadata = {
  title: "Marketplace · AI Workplace",
  description: "Hire official and community AI workers into your offices, or publish your own agent.",
};

// Marketplace reads ?filter=, ?workspace=, ?job= and ?skill= with useSearchParams.
export default function MarketplacePage() {
  return <Suspense fallback={<main className="market-loading">Loading the marketplace…</main>}><Marketplace /></Suspense>;
}

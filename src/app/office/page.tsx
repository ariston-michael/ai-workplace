import type { Metadata } from "next";
import { Suspense } from "react";
import Office from "./office";

export const metadata: Metadata = {
  title: "Your office · AI Workplace",
  description: "Submit jobs to the Dispatcher, hire AI workers, and review saved reports.",
};

// Office reads ?workspace= with useSearchParams, so it renders inside a Suspense boundary.
export default function OfficePage() {
  return (
    <Suspense fallback={<main className="office-loading">Loading office…</main>}>
      <Office />
    </Suspense>
  );
}

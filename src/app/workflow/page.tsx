import type { Metadata } from "next";
import { Suspense } from "react";
import Workflow from "./workflow";

export const metadata: Metadata = {
  title: "Workflow history · AI Workplace",
  description: "Review saved requests, Dispatcher decisions, worker evidence and outcomes.",
};

export default function WorkflowPage() {
  return <Suspense fallback={<p>Loading saved workflow…</p>}><Workflow /></Suspense>;
}

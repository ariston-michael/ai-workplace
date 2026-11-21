import type { Metadata } from "next";
import Workflow from "./workflow";

export const metadata: Metadata = {
  title: "Workflow history · AI Workplace",
  description: "Review saved requests, Dispatcher decisions, worker evidence and outcomes.",
};

export default function WorkflowPage() {
  return <Workflow />;
}

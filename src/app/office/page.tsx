import type { Metadata } from "next";
import Office from "./office";

export const metadata: Metadata = {
  title: "Your office · AI Workplace",
  description: "Submit jobs to the Dispatcher, hire AI workers, and review saved reports.",
};

export default function OfficePage() {
  return <Office />;
}

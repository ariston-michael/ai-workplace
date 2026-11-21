import type { Metadata } from "next";
import Office from "./office";

export const metadata: Metadata = {
  title: "Your office · AI Workplace",
  description: "Explore your demo office and hire an AI teammate.",
};

export default function OfficePage() {
  return <Office />;
}

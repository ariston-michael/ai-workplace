import type { Metadata } from "next";
import DashboardLoader from "./workspaces/dashboard-loader";

export const metadata: Metadata = { title: "Workspaces · AI Workplace", description: "Your saved offices, teams and job history, together in one place." };

export default function Home() {
  return <DashboardLoader />;
}

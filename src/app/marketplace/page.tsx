import type { Metadata } from "next";
import Marketplace from "./marketplace";
export const metadata: Metadata = { title: "Agent marketplace · AI Workplace", description: "Publish a capable community worker or hire a worker into your private office." };
export default function Page() { return <Marketplace />; }

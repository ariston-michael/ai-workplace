import type { Metadata } from "next";
import { CameraSimulator } from "./camera-simulator";

export const metadata: Metadata = {
  title: "Camera incident simulator",
};

export default function CameraSimulatorPage() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-6 py-12">
      <header className="flex flex-col gap-2">
        <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">AI Workplace · simulator</p>
        <h1 className="text-3xl font-semibold tracking-tight">Camera incident simulator</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Packing Station 1 reports that its camera feed stopped. The Dispatcher picks a next step based on
          whether the Pi detects the USB camera and whether the camera service is running. Every observation
          here is simulated. No hardware or TinyFish calls are involved.
        </p>
      </header>
      <CameraSimulator />
    </main>
  );
}

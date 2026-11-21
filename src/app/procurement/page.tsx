import type { Metadata } from "next";
import { publicSuppliers } from "@/lib/procurement";
import { LookupForm } from "./lookup-form";

export const metadata: Metadata = {
  title: "Procurement Researcher · Supplier lookup",
};

export default function ProcurementPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-12">
      <header className="flex flex-col gap-2">
        <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">AI Workplace · test page</p>
        <h1 className="text-3xl font-semibold tracking-tight">Procurement Researcher</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Look up one replacement part on an approved supplier&apos;s live website using TinyFish. Open the
          source link to verify what the worker observed.
        </p>
      </header>
      <LookupForm suppliers={publicSuppliers()} />
    </main>
  );
}

"use client";

import { useEffect, useState } from "react";
import type {
  Availability,
  LookupError,
  LookupResponse,
  LookupResult,
  MatchStatus,
  PublicSupplier,
} from "@/lib/procurement";

type State =
  | { kind: "idle" }
  | { kind: "loading"; startedAt: number }
  | { kind: "success"; result: LookupResult }
  | { kind: "error"; error: LookupError };

const MATCH_LABEL: Record<MatchStatus, string> = {
  exact: "Exact match",
  close: "Close match",
  ambiguous: "Ambiguous",
  not_found: "Not found",
};

const AVAILABILITY_LABEL: Record<Availability, string> = {
  in_stock: "In stock",
  out_of_stock: "Out of stock",
  backorder: "Backorder",
  preorder: "Preorder",
  discontinued: "Discontinued",
  unknown: "Unknown",
};

export function LookupForm({ suppliers }: { suppliers: PublicSupplier[] }) {
  const [partName, setPartName] = useState("");
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? "");
  const [state, setState] = useState<State>({ kind: "idle" });

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state.kind === "loading") return;
    setState({ kind: "loading", startedAt: Date.now() });
    try {
      const res = await fetch("/api/procurement/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ partName, supplierId }),
      });
      let data: LookupResponse | null = null;
      try {
        data = (await res.json()) as LookupResponse;
      } catch {
        // non-JSON response
      }
      if (data?.ok) setState({ kind: "success", result: data.result });
      else
        setState({
          kind: "error",
          error: data?.error ?? { code: "PROVIDER_ERROR", message: `Lookup failed with HTTP ${res.status}.` },
        });
    } catch {
      setState({
        kind: "error",
        error: { code: "PROVIDER_UNREACHABLE", message: "Could not reach the local task service." },
      });
    }
  }

  const loading = state.kind === "loading";

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={onSubmit} className="flex flex-col gap-4 rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Part name
          <input
            name="partName"
            value={partName}
            onChange={(e) => setPartName(e.target.value)}
            placeholder="e.g. Raspberry Pi 5 - 4GB RAM"
            required
            minLength={2}
            maxLength={100}
            disabled={loading}
            className="rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-base font-normal dark:border-zinc-700"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Supplier
          <select
            name="supplierId"
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
            disabled={loading}
            className="rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-base font-normal dark:border-zinc-700"
          >
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={loading}
          className="self-start rounded-full bg-foreground px-5 py-2 font-medium text-background disabled:opacity-50"
        >
          {loading ? "Looking up…" : "Look up part"}
        </button>
      </form>

      <div aria-live="polite">
        {state.kind === "loading" && <Loading startedAt={state.startedAt} />}
        {state.kind === "error" && <ErrorPanel error={state.error} />}
        {state.kind === "success" && <ResultPanel result={state.result} />}
      </div>
    </div>
  );
}

function Loading({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(startedAt);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  return (
    <div role="status" className="rounded-xl border border-zinc-200 p-5 text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
      <p className="font-medium">Procurement Researcher is browsing the supplier site… {seconds}s</p>
      <p className="text-sm">Live lookups usually take 30–120 seconds.</p>
    </div>
  );
}

function ErrorPanel({ error }: { error: LookupError }) {
  const missingKey = error.code === "MISSING_API_KEY";
  return (
    <div
      role="alert"
      className={`rounded-xl border p-5 ${
        missingKey
          ? "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
          : "border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100"
      }`}
    >
      <p className="font-semibold">{missingKey ? "TinyFish API key missing" : "Lookup failed"}</p>
      <p className="mt-1">{error.message}</p>
      {missingKey && (
        <p className="mt-2 text-sm">
          Copy <code>.env.example</code> to <code>.env.local</code>, set <code>TINYFISH_API_KEY</code>, then restart{" "}
          <code>npm run dev</code>. The live check remains pending until then.
        </p>
      )}
      <p className="mt-2 font-mono text-xs opacity-70">{error.code}</p>
    </div>
  );
}

function ResultPanel({ result }: { result: LookupResult }) {
  const found = result.match === "exact" || result.match === "close";
  return (
    <article className="flex flex-col gap-4 rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
      <div className="flex flex-wrap items-center gap-2">
        {result.mode === "live" ? (
          <span className="rounded-full bg-emerald-600 px-2.5 py-0.5 text-xs font-semibold uppercase text-white">
            Live result
          </span>
        ) : (
          <span className="rounded-full bg-amber-500 px-2.5 py-0.5 text-xs font-semibold uppercase text-white">
            Sample · fixture, not live
          </span>
        )}
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
            found
              ? "bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
              : "bg-amber-200 text-amber-900 dark:bg-amber-900 dark:text-amber-100"
          }`}
        >
          {MATCH_LABEL[result.match]}
        </span>
        <span className="text-sm text-zinc-500">
          {result.supplier.name} · {new Date(result.checkedAt).toLocaleString()} · {(result.durationMs / 1000).toFixed(1)}s
        </span>
      </div>

      {!found && (
        <p className="rounded-md bg-amber-50 p-3 text-amber-900 dark:bg-amber-950 dark:text-amber-100">
          {result.match === "not_found"
            ? `No listing for “${result.partName}” was found on ${result.supplier.name}.`
            : `The listing for “${result.partName}” is ambiguous. No single item was selected.`}
        </p>
      )}

      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
        <dt className="text-zinc-500">Requested</dt>
        <dd>{result.partName}</dd>
        <dt className="text-zinc-500">Item name</dt>
        <dd>{result.itemName ?? "—"}</dd>
        <dt className="text-zinc-500">Availability</dt>
        <dd>
          {AVAILABILITY_LABEL[result.availability]}
          {result.availabilityText && <span className="text-zinc-500"> — “{result.availabilityText}”</span>}
        </dd>
        {result.price && (
          <>
            <dt className="text-zinc-500">Price</dt>
            <dd>{result.price}</dd>
          </>
        )}
        {result.sku && (
          <>
            <dt className="text-zinc-500">SKU / part #</dt>
            <dd>{result.sku}</dd>
          </>
        )}
        <dt className="text-zinc-500">Source</dt>
        <dd className="break-all">
          <a href={result.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline">
            {result.sourceIsProductPage ? "Open product page" : "Open supplier search page"}
          </a>
          <span className="block text-xs text-zinc-500">{result.sourceUrl}</span>
        </dd>
      </dl>

      {result.candidates.length > 0 && (
        <section>
          <h2 className="font-semibold">Possible listings</h2>
          <ul className="list-disc pl-5">
            {result.candidates.map((c, i) => (
              <li key={i}>
                {c.url ? (
                  <a href={c.url} target="_blank" rel="noopener noreferrer" className="underline">
                    {c.name}
                  </a>
                ) : (
                  c.name
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="font-semibold">Uncertainties</h2>
        <ul className="list-disc pl-5 text-zinc-700 dark:text-zinc-300">
          {result.uncertainties.map((u, i) => (
            <li key={i}>{u}</li>
          ))}
        </ul>
      </section>

      <p className="font-mono text-xs text-zinc-500">
        TinyFish run {result.runId ?? "n/a"}
        {result.steps !== null && ` · ${result.steps} steps`}
      </p>
    </article>
  );
}

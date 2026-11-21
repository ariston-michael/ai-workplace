// Chooses between the fixture (default, zero credits) and live TinyFish.
// Live mode requires PROCUREMENT_MODE=live and TINYFISH_API_KEY in .env.local.

import {
  buildGoal,
  buildSearchUrl,
  normalizeResult,
  type LookupMode,
  type LookupResponse,
  type Supplier,
} from "./procurement.ts";
import { fixtureRun } from "./procurement-fixture.ts";
import { getTinyFishApiKey, runTinyFish } from "./tinyfish.server.ts";

export function procurementMode(): LookupMode {
  return process.env.PROCUREMENT_MODE?.trim().toLowerCase() === "live" ? "live" : "sample";
}

function fixtureDelayMs(): number {
  const n = Number(process.env.PROCUREMENT_FIXTURE_DELAY_MS ?? 1500);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 30_000) : 1500;
}

export async function lookupPart(
  partName: string,
  supplier: Supplier,
  mode: LookupMode = procurementMode(),
): Promise<LookupResponse> {
  const started = Date.now();

  if (mode === "sample") {
    // A short pause so the office can show the worker as busy.
    const delay = fixtureDelayMs();
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    const run = fixtureRun(partName, supplier);
    return {
      ok: true,
      result: normalizeResult({
        raw: run.result,
        partName,
        supplier,
        runId: null,
        steps: null,
        durationMs: Date.now() - started,
        mode: "sample",
      }),
    };
  }

  const apiKey = getTinyFishApiKey();
  if (!apiKey) {
    return {
      ok: false,
      error: {
        code: "MISSING_API_KEY",
        message: "TINYFISH_API_KEY is not set. Add it to .env.local and restart the server.",
      },
    };
  }
  const outcome = await runTinyFish({
    apiKey,
    url: buildSearchUrl(supplier, partName),
    goal: buildGoal(supplier, partName),
    browserProfile: supplier.browserProfile,
  });
  if (!outcome.ok) return outcome;
  return {
    ok: true,
    result: normalizeResult({
      raw: outcome.result,
      partName,
      supplier,
      runId: outcome.runId,
      steps: outcome.steps,
      durationMs: Date.now() - started,
      mode: "live",
    }),
  };
}

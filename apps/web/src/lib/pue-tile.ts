import type { KpiTileStatus } from "../components/kpi-tile";

/**
 * `F2.8` — the three PUE tiles' props, from one place.
 *
 * This module replaces `pue-estimate.ts`, which held a client-side copy of
 * `DashboardService.estimatePue`'s fitted curve `1.22 + min(0.45, totalKw /
 * 12000)`. The dashboard preferred that copy over the API's own number whenever
 * live telemetry was flowing, so the tile and the CSV export of the same estate
 * could disagree. The owner's ruling 4 of 2026-09-05 deletes the curve from all
 * three copies and makes `pueEstimate` nullable, so what the three pages now
 * share is a **rendering decision**, not a formula.
 *
 * **The decision.** `KpiTile` draws the em dash for `status === "empty"` and
 * draws `value` for `status === "ready"`, so a page that passed its query's own
 * `ready` through with a null value would paint a blank tile — a rendering
 * nobody reports and nobody can act on. A settled query that returned `null`
 * therefore becomes `empty`, and the hint names the two point keys an operator
 * has to configure on an incomer.
 *
 * **A query that has not settled keeps the measured hint.** `loading` and
 * `error` pass through unchanged: neither has established that nothing is
 * configured, and promising "not configured" mid-flight would be a claim the
 * caller cannot make yet.
 *
 * There is no fallback and no `1` sentinel anywhere on this path. A fabricated
 * 1.0 reads as a perfect data centre, which is worse than a dash.
 */

/** Where the number comes from, for a tenant that has the points configured. */
const MEASURED_HINT = "Σ site kW ÷ Σ IT kW, from the incomers' site_kw / it_kw";

/**
 * What to do about it, for a tenant that does not.
 *
 * The dash is U+2014 — the same character `KpiTile` renders and the same one
 * `reports.serialise.ts` writes into the CSV cell, so screen and export agree.
 */
const NOT_CONFIGURED_HINT =
  "Not configured — no incomer in scope computes site_kw and it_kw";

type PueTileProps = {
  status: KpiTileStatus;
  value: string | null;
  hint: string;
};

/**
 * The `status`, `value` and `hint` for a PUE tile, given the query's status and
 * the API's nullable ratio.
 *
 * Spread into `KpiTile` beside the caller's own `label` and `stale`.
 */
export function pueTileProps(
  status: KpiTileStatus,
  pue: number | null | undefined,
): PueTileProps {
  if (status !== "ready") {
    return { status, value: null, hint: MEASURED_HINT };
  }
  if (pue === null || pue === undefined) {
    return { status: "empty", value: null, hint: NOT_CONFIGURED_HINT };
  }
  return { status: "ready", value: pue.toFixed(2), hint: MEASURED_HINT };
}

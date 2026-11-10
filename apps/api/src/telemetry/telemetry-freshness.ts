/**
 * `F3.68` (ADR 0076 decision 7, plan D9) — the JS-side judgement of one asset's newest sample
 * against its window: `none` with no sample, `live` while the sample is at most
 * `windowSeconds` old (inclusive), `stale` after.
 *
 * `F4.350` (ADR 0075 Amendment 3): the window is no longer one fixed 25 s. It is the asset's
 * own RTU's, `windowSecondsFor(interval)` in `telemetry-cadence.ts` — the single source, which
 * also states the same rule in SQL. The caller passes the window it read with the sample
 * (`asset_windows`, `assetWindowsCteSql`), so SQL and JS cannot disagree. `nowMs` is the
 * caller's clock, so a caller that reads under a transaction can judge against that
 * transaction's `now()`. `DashboardService`'s asset rows, the generated site view, the breaker
 * rows and the mimic nodes all read it.
 */
export function telemetryFreshnessAt(
  latestIso: string | null,
  nowMs: number,
  windowSeconds: number,
): "live" | "stale" | "none" {
  if (!latestIso) {
    return "none";
  }
  const ageMs = nowMs - new Date(latestIso).getTime();
  return ageMs <= windowSeconds * 1000 ? "live" : "stale";
}

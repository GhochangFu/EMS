import {
  deriveBreakerState,
  type BreakerRow,
  type BreakerState,
  type GeneratedSiteViewDto,
  type SiteWidgetsResponse,
} from "@bms/shared";

import type { BreakerTableRow, BreakerVisualStatus } from "../components/control-room/breaker-table";
import type { SiteLiveReadings } from "../hooks/use-site-live-readings";
import { mimicAlarmTone } from "./mimic";
import { freshValue, isStale, STALE_VALUE } from "./schematic-telemetry";

/**
 * `F3.74` Task 4.3 (ADR 0088 decision 10, plan D8, D12) — the breaker table's rows.
 *
 * The API answers each breaker's points and the response's `stateMaps`, never a derived state; the
 * state is derived here by `deriveBreakerState` over the socket overlay (`readings.pointLatest`),
 * as the mimic does (`switchStatesOf`). Staleness is the asset's clamped last-seen instant, so a
 * stale CLOSED reads OFFLINE, and every reading and the trip cause pass the ADR 0027 gate.
 */

/**
 * The synthetic view `useSiteLiveReadings` reads: every breaker's asset once, with its points (the
 * state keys and `current_a`, `kw`, `kwh_today`), so the socket tracks and seeds them. No response
 * is no view (the hook then tracks nothing).
 */
export function breakerViewFor(data: SiteWidgetsResponse | undefined, widgetId: string): GeneratedSiteViewDto | undefined {
  if (data === undefined) {
    return undefined;
  }
  return {
    locationId: widgetId,
    asOf: data.resolvedAt,
    domains: [{ code: "breakers", label: "Breakers", assets: data.breakers.map((row) => row.asset) }],
  };
}

/**
 * The visual status of a derived state. The state decides first (`offline`, `tripped`, `open`
 * outrank every alarm, ADR 0088 decision 5); a CLOSED breaker takes a critical or warning alarm's
 * tone; `unknown` stays `unknown` whatever the alarm, since an alarm names no position.
 */
function visualStatus(state: BreakerState, row: BreakerRow): BreakerVisualStatus {
  if (state === "closed" && row.topAlarm !== null) {
    const tone = mimicAlarmTone(row.topAlarm.tone);
    return tone === "critical" || tone === "warning" ? tone : "normal";
  }
  return state === "closed" ? "normal" : state;
}

/** The Trip Cause cell (plan D8): `—` stale, the stored cause when TRIPPED or OPEN, else the alarm's label. */
function tripCauseOf(state: BreakerState, row: BreakerRow): string {
  if (state === "offline") {
    return STALE_VALUE;
  }
  if (state === "tripped" || state === "open") {
    return row.tripCause ?? "-";
  }
  return row.topAlarm?.label ?? "-";
}

/** One `BreakerTable` row per breaker of the response, in the response's order. */
export function breakerSiteRows(data: SiteWidgetsResponse, readings: SiteLiveReadings): readonly BreakerTableRow[] {
  return data.breakers.map((row) => {
    const { asset } = row;
    const stale = isStale(readings.assetLastSeenMs(asset), readings.nowMs);
    const points = asset.points.map((point) => ({ pointKey: point.pointKey, latest: readings.pointLatest(asset.id, point) }));
    const state = deriveBreakerState({ stale, points }, data.stateMaps);
    const reading = (pointKey: string): number | null => {
      const point = asset.points.find((p) => p.pointKey === pointKey);
      return freshValue(point === undefined ? null : (readings.pointLatest(asset.id, point)?.value ?? null), stale);
    };
    return {
      code: asset.code,
      label: asset.name,
      position: row.roleLabel,
      // No rating is "-" (none), as the Trip Cause cell prints it; "—" is the stale mark.
      rating: row.rating ?? "-",
      status: visualStatus(state, row),
      current: reading("current_a"),
      kw: reading("kw"),
      kwhToday: reading("kwh_today"),
      tripCause: tripCauseOf(state, row),
    };
  });
}

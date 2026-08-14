import type { TelemetryReading } from "@bms/shared";

import type { LiveSvgStatus } from "../components/live-svg/types";

/**
 * Pure telemetry-slice core for the live schematics (`F4.37`).
 *
 * Moved out of `components/live-svg/schematic-telemetry-context.tsx` unchanged
 * apart from the clock parameters below, for two reasons: the context module
 * imports React, TanStack Query and `socket.io-client`, so nothing in it could
 * be unit tested; and `vitest.config.ts` scopes the web coverage denominator to
 * `apps/web/src/lib/**`, so logic that lives above it is invisible to the gate.
 * The context keeps only what cannot be tested without a browser — the socket,
 * the queries, the React state — which is the same split `apps/api` uses for
 * `telemetry-listener.ts` (`F4.34`).
 *
 * **The clock is a parameter, not a global.** `deriveStatus` used to call
 * `Date.now()` itself, which makes the staleness rule untestable and hides the
 * fact that it is only re-evaluated when something re-renders. Both are now
 * explicit.
 */

/**
 * How long a reading stays fresh before its asset reads as offline.
 *
 * Unchanged at 25 s by `F4.37` — the defect was the arithmetic, not the window.
 */
export const FRESH_MS = 25_000;

/**
 * How often the provider forces a re-evaluation of staleness.
 *
 * **This is what makes `isStale` reachable, and it is not decoration.** The
 * status is computed during render, so without a periodic tick it is only
 * recomputed when something else re-renders the tree — in practice a socket
 * payload for *any* asset on the same schematic. That is exactly the signal
 * that stops in the case this rule exists to catch: if the whole site goes
 * quiet (ingest down, listener down, network partition), nothing re-renders
 * and every tile stays frozen on its last computed status, reading `running`
 * forever. Clamping the timestamp alone would not have fixed that, because the
 * clamped value is never re-read.
 *
 * The consumer pages' `refetchInterval: 15_000` is **not** a substitute:
 * TanStack Query's structural sharing returns the identical `data` reference
 * when a refetch changes nothing, so an unchanged rule list re-renders nothing.
 * Relying on it would make this guard fire only when unrelated data happened to
 * change — the same "guard that cannot fire under the condition it guards"
 * trap AGENTS.md §4.4 records.
 *
 * 5 s bounds the offline transition to `FRESH_MS + 5 s`. It costs one re-render
 * per 5 s per mounted schematic, which is strictly less than the socket already
 * causes on a healthy system — it only does work when the socket is silent.
 */
export const STALE_TICK_MS = 5_000;

export type SchematicTelemetrySlice = {
  kw: number | null;
  kvar: number | null;
  breaker: number | null;
  voltage: number | null;
  current: number | null;
  pf: number | null;
  frequencyHz: number | null;
  kwhToday: number | null;
  loadPct: number | null;
  outputVoltageV: number | null;
  outputFreqHz: number | null;
  batteryV: number | null;
  batteryTempC: number | null;
  backupMin: number | null;
  healthPct: number | null;
  rackKw: number | null;
  rackTempC: number | null;
  pduAStatus: number | null;
  pduBStatus: number | null;
  pduUtilPct: number | null;
  outletsUsed: number | null;
  supplyAirTempC: number | null;
  returnAirTempC: number | null;
  fanRpm: number | null;
  fanSpeedPct: number | null;
  chwFlowLps: number | null;
  chwSupplyTempC: number | null;
  chwReturnTempC: number | null;
  /** 1 = OK, 0 = trip (HVAC). */
  compressorOk: number | null;
  coolingKw: number | null;
  temperatureC: number | null;
  humidityPct: number | null;
  /** 0 = dry, 1 = wet. */
  leakState: number | null;
  /** 0 = normal, 1 = alarm. */
  smokeState: number | null;
  lastSeenMs: number | null;
};

export function emptySlice(): SchematicTelemetrySlice {
  return {
    kw: null,
    kvar: null,
    breaker: null,
    voltage: null,
    current: null,
    pf: null,
    frequencyHz: null,
    kwhToday: null,
    loadPct: null,
    outputVoltageV: null,
    outputFreqHz: null,
    batteryV: null,
    batteryTempC: null,
    backupMin: null,
    healthPct: null,
    rackKw: null,
    rackTempC: null,
    pduAStatus: null,
    pduBStatus: null,
    pduUtilPct: null,
    outletsUsed: null,
    supplyAirTempC: null,
    returnAirTempC: null,
    fanRpm: null,
    fanSpeedPct: null,
    chwFlowLps: null,
    chwSupplyTempC: null,
    chwReturnTempC: null,
    compressorOk: null,
    coolingKw: null,
    temperatureC: null,
    humidityPct: null,
    leakState: null,
    smokeState: null,
    lastSeenMs: null,
  };
}

/**
 * Freshness evidence carried by one reading, clamped to the present (`F4.37`).
 *
 * **The clamp is the fix, and it must happen here — at write time — not in
 * `deriveStatus`.** Two placements look equivalent and are both wrong:
 *
 * - Clamping at *read* time (`Math.min(lastSeenMs, now)` inside the staleness
 *   comparison) is **worse than the bug**: a future reading would evaluate as
 *   0 ms old on every render, so the asset would be permanently fresh rather
 *   than merely fresh until its timestamp passed. Clamping once, on arrival, is
 *   what bounds the damage to `FRESH_MS`.
 * - `Math.abs(now - lastSeenMs) > FRESH_MS` would treat any future timestamp as
 *   instantly stale. That breaks the live pilot rather than a hostile input:
 *   `F4.28` measured the PHE MQTT feed writing **33 minutes ahead of `now()`**
 *   in production, so every asset on it would render offline permanently.
 *
 * Clamping keeps the honest reading — we did just receive this — while making
 * staleness degrade toward *offline*, which is the safe direction for a BMS.
 * A skewed producer costs at most `FRESH_MS` of delayed offline detection
 * instead of an unbounded, silent "running".
 *
 * **Why the fix is here and not in the API schema.** `F4.36` added
 * `telemetryReadingSchema` and deliberately did not bound `time`, because
 * `resolveSamples` trusts `sample.at` from the adapter and an RTU with a skewed
 * clock emits future timestamps *legitimately* (the unclamped `sample.at` is
 * `F1.7`). A server-side reject would delete real telemetry to fix a
 * client-side arithmetic bug.
 *
 * **Zone-less timestamps.** `Date.parse` accepts forms with no offset
 * (`"2026-08-14 15:00:00"`), which every browser then reads in its *own* local
 * zone — up to ±14 h of disagreement between two operators looking at the same
 * asset. The clamp settles the question the `F4.37` row left open: both
 * directions now degrade safely. A zone that lands the reading in the past
 * shows offline sooner, and one that lands it in the future is clamped. Neither
 * producer emits such a form today (both use `toISOString()`), so this bounds a
 * future drift rather than a live defect.
 *
 * Returns `null` when `time` is unparsable, so the caller keeps whatever
 * evidence it already had rather than inventing fresh. This is defence at the
 * sink, not a live defect: the socket route is validated by `F4.36` and the
 * REST route reads a `timestamptz` column. It is here because the whole point
 * of `F4.37` is that this client must be correct on its own.
 */
export function readingTimestampMs(time: string, nowMs: number): number | null {
  const parsed = new Date(time).getTime();
  if (Number.isNaN(parsed)) {
    return null;
  }
  return Math.min(parsed, nowMs);
}

/**
 * Merges one reading into a slice.
 *
 * `lastSeenMs` only ever moves through `readingTimestampMs`; an unparsable
 * `time` leaves the previous value alone, because a reading we cannot date is
 * no evidence of freshness — and overwriting with `null` would flip a healthy
 * asset offline on one bad message.
 */
export function applyReading(
  prev: SchematicTelemetrySlice,
  r: TelemetryReading,
  nowMs: number,
): SchematicTelemetrySlice {
  const t = readingTimestampMs(r.time, nowMs);
  const next = { ...prev, lastSeenMs: t ?? prev.lastSeenMs };
  switch (r.pointKey) {
    case "kw":
      return { ...next, kw: r.value };
    case "kvar":
      return { ...next, kvar: r.value };
    case "breaker_main":
      return { ...next, breaker: r.value };
    case "voltage_l1_v":
      return { ...next, voltage: r.value };
    case "current_a":
      return { ...next, current: r.value };
    case "pf":
      return { ...next, pf: r.value };
    case "frequency_hz":
      return { ...next, frequencyHz: r.value };
    case "kwh_today":
      return { ...next, kwhToday: r.value };
    case "load_pct":
      return { ...next, loadPct: r.value };
    case "output_voltage_v":
      return { ...next, outputVoltageV: r.value };
    case "output_freq_hz":
      return { ...next, outputFreqHz: r.value };
    case "battery_v":
      return { ...next, batteryV: r.value };
    case "battery_temp_c":
      return { ...next, batteryTempC: r.value };
    case "backup_min":
      return { ...next, backupMin: r.value };
    case "health_pct":
      return { ...next, healthPct: r.value };
    case "rack_kw":
      return { ...next, rackKw: r.value };
    case "rack_temp_c":
      return { ...next, rackTempC: r.value };
    case "pdu_a_status":
      return { ...next, pduAStatus: r.value };
    case "pdu_b_status":
      return { ...next, pduBStatus: r.value };
    case "pdu_util_pct":
      return { ...next, pduUtilPct: r.value };
    case "outlets_used":
      return { ...next, outletsUsed: r.value };
    case "supply_air_temp_c":
      return { ...next, supplyAirTempC: r.value };
    case "return_air_temp_c":
      return { ...next, returnAirTempC: r.value };
    case "fan_rpm":
      return { ...next, fanRpm: r.value };
    case "fan_speed_pct":
      return { ...next, fanSpeedPct: r.value };
    case "chw_flow_lps":
      return { ...next, chwFlowLps: r.value };
    case "chw_supply_temp_c":
      return { ...next, chwSupplyTempC: r.value };
    case "chw_return_temp_c":
      return { ...next, chwReturnTempC: r.value };
    case "compressor_ok":
      return { ...next, compressorOk: r.value };
    case "cooling_kw":
      return { ...next, coolingKw: r.value };
    case "temperature_c":
      return { ...next, temperatureC: r.value };
    case "humidity_pct":
      return { ...next, humidityPct: r.value };
    case "leak_state":
      return { ...next, leakState: r.value };
    case "smoke_state":
      return { ...next, smokeState: r.value };
    default:
      return next;
  }
}

/**
 * Whether a slice's last reading is old enough that its values cannot be
 * trusted as current.
 *
 * A slice that has never carried a reading is stale — "no evidence" and "fresh"
 * are different things, and only one of them is safe to render as `running`.
 *
 * The `null` branch is carried by the **type system, not by a test**, and the
 * distinction is worth recording: deleting it does not change behaviour, since
 * `nowMs - null` coerces to `nowMs` and still exceeds `FRESH_MS` for any real
 * clock. It fails to compile instead — `TS18047: 'lastSeenMs' is possibly
 * 'null'` — which is why no mutation of it is listed as killed by a spec.
 */
export function isStale(lastSeenMs: number | null, nowMs: number): boolean {
  return lastSeenMs === null || nowMs - lastSeenMs > FRESH_MS;
}

/**
 * Equipment status for one slice.
 *
 * Staleness wins over every value-derived state: a `breaker` of 0 read four
 * hours ago says nothing about the breaker now.
 *
 * **This is the only freshness gate in the web client, and it does not cover
 * the pages most operators watch.** It reaches the SVG schematics through
 * `useSchematicTelemetry`; the seven control-room pages derive their own tile
 * status from `deriveRuleState`, which never consults `lastSeenMs` at all
 * (`control-room-env-page` and `-hvac-page` check only that it is not `null`,
 * i.e. "has this asset *ever* reported"). A dead leak or smoke sensor therefore
 * keeps rendering its last known value as `normal` indefinitely. That is
 * `F4.38`, deliberately not fixed here: it needs no clock skew and no attacker,
 * and choosing what a stale-but-last-known-wet sensor should render is a
 * product decision in a safety path — `mergeStatus` currently ranks `critical`
 * above `offline`, so suppressing a frozen escalation is not obviously right.
 */
export function deriveStatus(
  slice: SchematicTelemetrySlice,
  nowMs: number,
): { status: LiveSvgStatus; stale: boolean } {
  if (isStale(slice.lastSeenMs, nowMs)) {
    return { status: "offline", stale: true };
  }
  if (slice.breaker === 0) {
    return { status: "fault", stale: false };
  }
  if (slice.compressorOk === 0) {
    return { status: "fault", stale: false };
  }
  return { status: "running", stale: false };
}

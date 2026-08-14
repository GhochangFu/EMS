import type { TelemetryReading } from "@bms/shared";

import type { LiveSvgStatus } from "../components/live-svg/types";

/**
 * Pure telemetry-slice core for the live schematics (`F4.37`).
 *
 * Moved out of `components/live-svg/schematic-telemetry-context.tsx`. The move
 * is faithful — the 34-arm point-key switch is byte-identical apart from the
 * added `nowMs` parameter — but it is **not** behaviour-preserving in two
 * places, both deliberate and both `F4.37`: the clamp in `readingTimestampMs`,
 * and `lastSeenMs: t ?? prev.lastSeenMs` in `applyReading`. The second is a
 * separate defect of the same family: previously an unparsable `time` stored
 * `NaN`, and `Date.now() - NaN > FRESH_MS` is `false`, so the asset was
 * permanently fresh. `F4.36` closed that on the socket path; this closes it on
 * the REST path, which its schema does not cover.
 *
 * The extraction happened for two reasons: the context module
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
 * Nothing else re-renders on a timer. The two pages where this status is
 * actually visible — `sld-page.tsx` and `crac-page.tsx` — have **no**
 * `refetchInterval` at all. The seven control-room pages do have one at 15 s,
 * and it is still not a substitute: each reads only `rulesQuery.data`, and
 * TanStack Query v5 tracks accessed properties and structurally shares results,
 * so an unchanged rule list notifies no observer and re-renders nothing.
 * Relying on it would make this guard fire only when unrelated data happened to
 * change — the same "guard that cannot fire under the condition it guards"
 * trap AGENTS.md §4.4 records.
 *
 * 5 s bounds the offline transition to `FRESH_MS + 5 s` **in a visible tab
 * only**. Browsers throttle `setInterval` in a hidden tab to roughly once a
 * minute, so a backgrounded control room can take ~85 s to show offline; the
 * open WebSocket keeps the tab from freezing outright, so it degrades rather
 * than stops, and a wall display — the case that matters here — is visible by
 * definition. Raised by the `F4.37` security review against an earlier version
 * of this comment that stated the bound unconditionally.
 *
 * The cost is paid unconditionally, which is worth stating plainly rather than
 * describing it as free: the interval has an empty dependency array and ticks
 * every 5 s whether or not telemetry is flowing, and each tick changes the
 * context value's identity, so **every** `useContext` consumer in the subtree
 * re-renders — including the seven control-room pages, which gain nothing from
 * it until `F4.38` lands. On a healthy system that is still fewer re-renders
 * than the socket already causes; on a silent one it is the only thing keeping
 * the schematic honest.
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

/** A slice with no telemetry yet — every point `null`, never contacted. */
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
 *   comparison) is **no better than the bug — it is arithmetically identical to
 *   no clamp at all.** `now - min(t, now)` is `max(0, now - t)`, so a future
 *   reading reads 0 ms old only while `now < t`, and from then on ages exactly
 *   as the unclamped value does. Measured on the 33-minute case: 2,006,000 ms
 *   to offline either way, against **26,000 ms** clamping at write time.
 *   (An earlier draft of this comment claimed a read-time clamp would be
 *   *permanently* fresh and therefore worse. That was wrong, and it was caught
 *   by the `F4.37` compliance review running the arithmetic — the same class of
 *   plausible-but-unrun claim as `F4.34`'s ESM/CJS argument and `F4.36`'s
 *   `.finite()` attribution. The conclusion survives; the reason did not.)
 *
 *   Clamping at write time is what bounds *producer* skew to `FRESH_MS`. It
 *   does **not** bound skew in the client's own clock — see the backward-step
 *   clause in `isStale`.
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
 * **Known residual on the REST hydration path.** `nowMs` means "this reading
 * arrived now", which is true on the socket path and false on hydration:
 * `recentForPoint` bounds its window only below (`time >= now() - interval`)
 * and orders `desc`, so `rows[0]` can be a *future-dated* row from a device
 * that has since died. Clamping it to `nowMs` asserts contact that did not
 * happen, and the tile reads `running` for up to `FRESH_MS` after each mount.
 *
 * Measured rather than argued, because the `F4.37` security review raised this
 * as a regression and the arithmetic says otherwise: across the whole timeline
 * of a device dying at `T` with a row dated `T+33min`, there is **no** moment
 * at which this renders `running` where the pre-fix code rendered `offline`.
 * `Math.min` does not re-arm — once `nowMs` passes the row's time the clamp is
 * a no-op and the row reads as genuinely old (mount at `T+40min` yields
 * `lastSeenMs = T+33min`, which is stale). Pre-fix held `running` continuously
 * until `T+33min+25s`; this holds it for 25 s per mount and less overall. So
 * the residual is a *smaller* version of the original defect, not a new one.
 *
 * Left rather than fixed, because the obvious fix — treat a future-dated
 * historical row as no evidence — makes every healthy asset on a skewed
 * producer render `offline` on page load until its next socket reading, and
 * trading a brief false-`running` for a brief false-`offline` on live plant is
 * the owner's call. The real repair is upstream in `F1.7`: clamp `sample.at` at
 * ingest and no future-dated row exists to read.
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
 *
 * **`lastSeenMs > nowMs` is stale, and that clause closes the F4.37 defect
 * against the client's own clock.** The write-time clamp bounds a skewed
 * *producer*, but the bound only holds while the two `Date.now()` readings move
 * forward together. If the workstation clock steps backward — an NTP correction
 * after a bad RTC, or an operator changing system time — every stored
 * `lastSeenMs` becomes future-relative to `now`, the difference goes negative,
 * nothing is `> FRESH_MS`, and every tile reads `running` again. A live asset
 * self-heals on its next reading; a dead one never does, which is exactly the
 * F4.37 symptom re-entered through a different door. Found by the `F4.37`
 * security review, which also falsified this file's earlier claim that clamping
 * on arrival "bounds the damage to `FRESH_MS`" — it bounds producer skew only.
 *
 * The clause cannot fire spuriously *because* of the write-time clamp: after
 * it, `lastSeenMs <= nowMs` at the moment of the write, and renders happen
 * after writes, so `lastSeenMs > nowMs` can only mean the clock moved back.
 */
export function isStale(lastSeenMs: number | null, nowMs: number): boolean {
  return (
    lastSeenMs === null || lastSeenMs > nowMs || nowMs - lastSeenMs > FRESH_MS
  );
}

/**
 * Equipment status for one slice.
 *
 * Staleness wins over every value-derived state: a `breaker` of 0 read four
 * hours ago says nothing about the breaker now.
 *
 * **This is the only freshness gate in the web client, and it does not cover
 * the pages most operators watch.** It reaches the SVG schematics through
 * `useSchematicTelemetry`; the seven control-room pages each derive their own
 * tile status locally, and until `F4.38` none of them consulted `lastSeenMs` as
 * a clock. **They do now** — `ADR 0027` makes staleness a gate in front of
 * every derived status and every rendered value, and the helpers below are the
 * shared implementation. This function remains the schematic's own path.
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

// ---------------------------------------------------------------------------
// ADR 0027 — the staleness gate shared by the seven control-room pages (F4.38)
// ---------------------------------------------------------------------------

/**
 * What a tile shows in place of a number it can no longer vouch for.
 *
 * ADR 0027 decision 3. A stale tile renders this rather than its last reading,
 * because **a number with no timestamp beside it is exactly what made this
 * failure invisible**: a dead sensor's last value looks identical to a live
 * one. Blanking forces the reader to notice there is no current data.
 */
export const STALE_VALUE = "—";

/**
 * A point value, or `null` once the slice is stale (ADR 0027 decision 3).
 *
 * Callers render `STALE_VALUE` for `null`. Returning `null` rather than the
 * string keeps the formatting decision — units, precision, `toFixed` — with the
 * caller that owns it, and keeps this function usable for a value that feeds
 * arithmetic rather than a label.
 */
export function freshValue(
  value: number | null,
  stale: boolean,
): number | null {
  return stale ? null : value;
}

/**
 * How many of these slices have stopped reporting.
 *
 * Used for the "· N assets stale" flag beside an aggregate (ADR 0027
 * decision 4). A dropped contribution that is not counted is worse than one
 * that is silently included: the number moves and nothing explains it.
 */
export function staleCount(
  slices: readonly SchematicTelemetrySlice[],
  nowMs: number,
): number {
  let n = 0;
  for (const s of slices) {
    if (isStale(s.lastSeenMs, nowMs)) {
      n += 1;
    }
  }
  return n;
}

/** A summed aggregate and the number of assets left out of it. */
export type FreshSum = {
  /** `null` when no slice contributed — distinct from a genuine `0`. */
  readonly total: number | null;
  /** Slices excluded because they are stale. */
  readonly staleExcluded: number;
};

/**
 * Sums one numeric point across only the slices still reporting (ADR 0027
 * decision 4).
 *
 * **`null` total and `0` total are different answers and must stay so.** `null`
 * means nothing contributed — every asset stale, or none carrying the point;
 * `0` means assets are reporting and the load really is zero. Collapsing them
 * would let a fully dead bus render `0 MW`, which reads as "measured" rather
 * than "unknown" and is the same class of failure this ADR exists to close.
 *
 * `NaN` values are skipped rather than propagated: one `NaN` would otherwise
 * turn the whole sum into `NaN`, which renders as nothing useful and loses the
 * contributions that were valid. The unconstrained `double precision` column
 * (`F4.32`) makes that reachable from the database rather than only in theory.
 */
export function sumFresh(
  slices: readonly SchematicTelemetrySlice[],
  pick: (slice: SchematicTelemetrySlice) => number | null,
  nowMs: number,
): FreshSum {
  let total = 0;
  let contributed = false;
  let staleExcluded = 0;
  for (const s of slices) {
    if (isStale(s.lastSeenMs, nowMs)) {
      staleExcluded += 1;
      continue;
    }
    const v = pick(s);
    if (v === null || Number.isNaN(v)) {
      continue;
    }
    total += v;
    contributed = true;
  }
  return { total: contributed ? total : null, staleExcluded };
}

import type {
  ControlRoomEnvironmentPointKey,
  ControlRoomItPointKey,
  ControlRoomUpsPointKey,
  ElectricalPointKey,
  HvacPointKey,
  TelemetryReading,
} from "@bms/shared";

import {
  applyReading,
  deriveStatus,
  emptySlice,
  FRESH_MS,
  isStale,
  readingTimestampMs,
  type SchematicTelemetrySlice,
} from "./schematic-telemetry";

/**
 * Every point key `applyReading` handles.
 *
 * The five shared sets cover 32 of the 34 arms. `frequency_hz` and `kwh_today`
 * are named explicitly because they are in **no** shared set, which typing this
 * table surfaced. They are not dead code: both are real, live points (35,789
 * and 33,327 rows in the pilot database at the time of writing), and they reach
 * `applyReading` because `onSocketPayload` filters by tracked **asset**, not by
 * point key. What they miss is REST hydration, which iterates the subscribed
 * key list — so `frequencyHz` and `kwhToday` read `null` until the first socket
 * payload lands. Pre-existing and out of `F4.37`'s scope; recorded here rather
 * than papered over with a `string` key.
 */
type KnownPointKey =
  | ElectricalPointKey
  | HvacPointKey
  | ControlRoomUpsPointKey
  | ControlRoomItPointKey
  | ControlRoomEnvironmentPointKey
  | "frequency_hz"
  | "kwh_today";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** Fixed clock so every assertion below is exact rather than approximate. */
const NOW = Date.parse("2026-08-14T12:00:00.000Z");

function reading(over: Partial<TelemetryReading> = {}): TelemetryReading {
  return {
    time: new Date(NOW).toISOString(),
    assetId: "11111111-1111-1111-1111-111111111111",
    pointKey: "kw",
    value: 42,
    unit: "kW",
    ...over,
  } as TelemetryReading;
}

function freshAt(ms: number): SchematicTelemetrySlice {
  return { ...emptySlice(), lastSeenMs: ms };
}

/** Unit checks for the schematic telemetry slice core (`F4.37`). */
export function runSchematicTelemetryTests(): void {
  // --- readingTimestampMs -------------------------------------------------

  assert(
    readingTimestampMs(new Date(NOW - 5_000).toISOString(), NOW) === NOW - 5_000,
    "a past timestamp is kept exactly — genuine staleness must survive",
  );
  assert(
    readingTimestampMs(new Date(NOW).toISOString(), NOW) === NOW,
    "a timestamp equal to now is kept",
  );
  assert(
    readingTimestampMs(new Date(NOW + 60_000).toISOString(), NOW) === NOW,
    "a future timestamp is clamped to now",
  );
  assert(
    readingTimestampMs("not a date", NOW) === null,
    "an unparsable timestamp yields no freshness evidence",
  );

  // The `F4.28` production case: the PHE MQTT feed was measured writing 33
  // minutes ahead of `now()`. It must clamp, not be rejected — rejecting it
  // would delete real telemetry.
  const pheAhead = 33 * 60_000;
  assert(
    readingTimestampMs(new Date(NOW + pheAhead).toISOString(), NOW) === NOW,
    "a 33-minute-ahead pilot reading clamps to now rather than being dropped",
  );

  // --- isStale ------------------------------------------------------------

  assert(isStale(null, NOW), "never seen is stale, not fresh");
  assert(!isStale(NOW, NOW), "a reading taken now is fresh");
  assert(
    !isStale(NOW - FRESH_MS, NOW),
    "exactly FRESH_MS old is still fresh (the comparison is strict)",
  );
  assert(
    isStale(NOW - FRESH_MS - 1, NOW),
    "one millisecond past FRESH_MS is stale",
  );

  // The client's own clock stepping backward (NTP correction, an operator
  // changing system time) makes every stored lastSeenMs future-relative to now.
  // Without this clause the difference is negative, nothing exceeds FRESH_MS,
  // and every tile reads `running` again — the F4.37 defect through a different
  // door, and one the write-time clamp cannot reach. Raised by the security
  // review, which falsified the "clamping bounds the damage" claim.
  assert(isStale(NOW + 1, NOW), "a lastSeenMs ahead of now is stale, not fresh");
  assert(
    isStale(NOW, NOW - 60_000),
    "a clock stepping back a minute makes prior readings stale, not fresh",
  );

  // --- deriveStatus -------------------------------------------------------

  assert(
    deriveStatus(emptySlice(), NOW).status === "offline",
    "an empty slice is offline",
  );
  assert(
    deriveStatus(freshAt(NOW), NOW).status === "running",
    "a fresh slice with no fault is running",
  );
  assert(
    deriveStatus({ ...freshAt(NOW), breaker: 0 }, NOW).status === "fault",
    "a fresh open breaker is a fault",
  );
  assert(
    deriveStatus({ ...freshAt(NOW), compressorOk: 0 }, NOW).status === "fault",
    "a fresh tripped compressor is a fault",
  );
  // Staleness outranks every value-derived state: an open breaker read four
  // hours ago says nothing about the breaker now.
  const staleFault = { ...freshAt(NOW - 4 * 3_600_000), breaker: 0 };
  assert(
    deriveStatus(staleFault, NOW).status === "offline",
    "a stale slice reads offline even when its last values looked like a fault",
  );
  assert(
    deriveStatus(staleFault, NOW).stale,
    "the stale flag follows the offline status",
  );

  // --- applyReading -------------------------------------------------------

  // `F4.37` moved this switch out of the context module. The move was
  // mechanical, which is exactly why it needs checking: a mis-pasted arm — two
  // keys writing one field, or a key writing its neighbour's — changes what an
  // operator reads off a schematic and is invisible to every other test.
  //
  // Each key must set **exactly** its own field, so a duplicated arm fails on
  // the field it wrongly wrote rather than passing on the one it got right.
  // Keys are typed against the shared unions, not `string`, so a typo shared
  // between this table and the switch cannot pass silently — raised by the
  // `F4.37` compliance review, which noted a `string` key would let both sides
  // be wrong in the same way.
  const POINT_KEY_FIELDS: ReadonlyArray<
    readonly [KnownPointKey, keyof SchematicTelemetrySlice]
  > = [
    ["kw", "kw"],
    ["kvar", "kvar"],
    ["breaker_main", "breaker"],
    ["voltage_l1_v", "voltage"],
    ["current_a", "current"],
    ["pf", "pf"],
    ["frequency_hz", "frequencyHz"],
    ["kwh_today", "kwhToday"],
    ["load_pct", "loadPct"],
    ["output_voltage_v", "outputVoltageV"],
    ["output_freq_hz", "outputFreqHz"],
    ["battery_v", "batteryV"],
    ["battery_temp_c", "batteryTempC"],
    ["backup_min", "backupMin"],
    ["health_pct", "healthPct"],
    ["rack_kw", "rackKw"],
    ["rack_temp_c", "rackTempC"],
    ["pdu_a_status", "pduAStatus"],
    ["pdu_b_status", "pduBStatus"],
    ["pdu_util_pct", "pduUtilPct"],
    ["outlets_used", "outletsUsed"],
    ["supply_air_temp_c", "supplyAirTempC"],
    ["return_air_temp_c", "returnAirTempC"],
    ["fan_rpm", "fanRpm"],
    ["fan_speed_pct", "fanSpeedPct"],
    ["chw_flow_lps", "chwFlowLps"],
    ["chw_supply_temp_c", "chwSupplyTempC"],
    ["chw_return_temp_c", "chwReturnTempC"],
    ["compressor_ok", "compressorOk"],
    ["cooling_kw", "coolingKw"],
    ["temperature_c", "temperatureC"],
    ["humidity_pct", "humidityPct"],
    ["leak_state", "leakState"],
    ["smoke_state", "smokeState"],
  ];

  for (const [pointKey, field] of POINT_KEY_FIELDS) {
    const applied = applyReading(
      emptySlice(),
      reading({ pointKey, value: 7 }),
      NOW,
    );
    assert(
      applied[field] === 7,
      `${pointKey} must set ${String(field)}, got ${String(applied[field])}`,
    );
    assert(
      applied.lastSeenMs === NOW,
      `${pointKey} must record contact time`,
    );
    const touched = (
      Object.keys(applied) as Array<keyof SchematicTelemetrySlice>
    ).filter((k) => k !== "lastSeenMs" && applied[k] !== null);
    assert(
      touched.length === 1 && touched[0] === field,
      `${pointKey} must set only ${String(field)}, also set: ${touched
        .filter((k) => k !== field)
        .join(", ")}`,
    );
  }

  const unknown = applyReading(
    emptySlice(),
    reading({ pointKey: "not_a_point" }),
    NOW,
  );
  assert(
    unknown.lastSeenMs === NOW && unknown.kw === null,
    "an unknown point key still counts as contact but sets no value",
  );

  // A reading we cannot date must not erase the freshness we already had —
  // otherwise one malformed message flips a healthy asset offline.
  const afterBadTime = applyReading(
    freshAt(NOW - 1_000),
    reading({ time: "not a date" }),
    NOW,
  );
  assert(
    afterBadTime.lastSeenMs === NOW - 1_000,
    "an undateable reading leaves the previous lastSeenMs alone",
  );

  // --- The F4.37 defect, end to end ---------------------------------------

  // This is the assertion the item exists for. Before the fix, `applyReading`
  // stored the raw future timestamp, so `Date.now() - lastSeenMs` stayed
  // negative — never greater than FRESH_MS — and the asset rendered `running`
  // until the future caught up. For an asset that never sends again, that is
  // forever.
  const poisoned = applyReading(
    emptySlice(),
    reading({ time: new Date(NOW + 33 * 60_000).toISOString() }),
    NOW,
  );
  assert(
    poisoned.lastSeenMs === NOW,
    "a future-dated reading is stored clamped, not raw",
  );
  assert(
    deriveStatus(poisoned, NOW).status === "running",
    "the asset is running at the moment the reading arrives",
  );
  assert(
    deriveStatus(poisoned, NOW + FRESH_MS + 1).status === "offline",
    "and goes offline one tick past FRESH_MS — the whole point of F4.37",
  );
  // Pin the bound explicitly: without the clamp this asset would have stayed
  // `running` for 33 minutes plus FRESH_MS.
  assert(
    deriveStatus(poisoned, NOW + 33 * 60_000).status === "offline",
    "it is offline well before its own timestamp would have expired",
  );
  // And the same asset must not come back to life if the workstation clock is
  // wound back past the reading — the whole point of the isStale clause.
  assert(
    deriveStatus(poisoned, NOW - 10 * 60_000).status === "offline",
    "a rewound client clock does not resurrect a dead asset",
  );
}

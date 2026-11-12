import { decodeMqttPayload, MQTT_BUILTIN_PAYLOAD_FORMAT_DEFINITION } from "@bms/shared/ingest";

import { samplesFromPayload } from "../adapters/mqtt.js";
import { resolveSamples, type PointIndex, type PointTarget } from "./normaliser.js";
import { receivedTogether } from "./received-sample.js";

/**
 * `F4.354` — RTU `PHE-AIRSP1051M-000000004` (Lotapata II) stored
 * `battery_charge_pct` = −1239.13 on every sample for 30 days.
 *
 * Two claims, each through the decoder call production makes for a topic that
 * names no payload format (`decodeMqttPayload` with the built-in
 * `thinkiot-envelope`, then `samplesFromPayload`) and the real normaliser
 * (`resolveSamples`), on the envelope `exports/PHE-MQTT-REFERENCE.md`
 * transcribes:
 *
 * 1. **Diagnosis.** With the built-in format and the five ADR 0056 metadata
 *    fields resolving to `NULL` — the live state of the `battery_charge_pct`
 *    point on all 12 `PHE-RTU-HEALTH` assets on 2026-11-12 — nothing between
 *    the payload and the row changes the number. The ThinkIoT device sends
 *    `batt_volt` as a percentage already (`"100.00"` in the reference sample),
 *    so a stored −1239.13 means the device published `"batt_volt": "-1239.13"`
 *    — unless RTU 004's topic names a declarative format whose `scale` /
 *    `offset` maps it, which the plan asks the owner to rule out.
 * 2. **The guard.** ADR 0056 decision 4's engineering band, `eng_min 0` /
 *    `eng_max 100` on the point, drops that sample as `outOfRange` and keeps a
 *    normal reading (the 94.35 % RTU 002 averaged) and both inclusive edges.
 */
function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** The Bhutnirghat I pilot device from the reference doc; the value is routing only. */
const DEV_ID = "861736076104923";
const TOPIC = `Airsprint-1051/Data/${DEV_ID}`;
const ASSET_ID = "00000000-0000-4000-8000-000000000004";
const RECEIVED_AT = new Date("2026-11-12T07:31:00.000Z");

/** The raw value RTU 004 published, as the device's own string. */
export const RTU_004_BATT_VOLT = "-1239.13";

const NO_METADATA: PointTarget = {
  assetId: ASSET_ID,
  pointKey: "battery_charge_pct",
  unit: "%",
  scaleMultiplier: null,
  scaleOffset: null,
  engMin: null,
  engMax: null,
  qualityPolicy: null,
};

/** The fix the owner applies on the template point: a 0–100 % plausibility band. */
const PERCENT_BAND: PointTarget = { ...NO_METADATA, engMin: 0, engMax: 100 };

function indexFor(target: PointTarget): PointIndex {
  return new Map([[DEV_ID, new Map([["batt_volt", [target]]])]]);
}

/** One ThinkIoT envelope carrying `batt_volt`, decoded and resolved end to end. */
function ingest(battVolt: string, target: PointTarget) {
  const payload = new TextEncoder().encode(
    JSON.stringify({
      dev_id: DEV_ID,
      ts: "1794468660000",
      rssi: "29",
      values: { di1: "1", pwr_stat: "1", batt_volt: battVolt },
    }),
  );
  const decoded = decodeMqttPayload(MQTT_BUILTIN_PAYLOAD_FORMAT_DEFINITION, TOPIC, payload);
  assert(decoded.ok && decoded.records.length === 1, "the built-in envelope decodes to one record");
  const record = decoded.ok ? decoded.records[0] : undefined;
  if (record === undefined) {
    throw new Error("no record");
  }
  const { samples } = samplesFromPayload(
    { devId: record.deviceKey, values: record.values },
    ["batt_volt"],
  );
  assert(samples.length === 1, `the decoder yields one batt_volt sample for "${battVolt}"`);
  return resolveSamples(receivedTogether(samples, RECEIVED_AT), indexFor(target));
}

/** Claim 1: with no point metadata, RTU 004's raw value is stored unchanged. */
export function runPheBatteryDiagnosisTests(): void {
  const { rows, counters } = ingest(RTU_004_BATT_VOLT, NO_METADATA);
  assert(rows.length === 1, "with no metadata the sample is stored");
  assert(
    rows[0]?.value === -1239.13,
    `the stored value is the raw batt_volt unchanged, got ${rows[0]?.value}`,
  );
  assert(counters.outOfRange === 0, "no band, no range test");
}

/** Claim 2: a 0–100 band refuses −1239.13 and keeps 94.35, 0 and 100. */
export function runPheBatteryRangeTests(): void {
  {
    const { rows, counters } = ingest(RTU_004_BATT_VOLT, PERCENT_BAND);
    assert(rows.length === 0, "−1239.13 % never becomes a stored row under a 0–100 band");
    assert(counters.outOfRange === 1, `it counts outOfRange, got ${counters.outOfRange}`);
  }

  {
    // The positive twin: RTU 002's 24 h average on the same template point.
    const { rows, counters } = ingest("94.35", PERCENT_BAND);
    assert(rows.length === 1, "a normal reading is still stored");
    assert(rows[0]?.value === 94.35, `stored as sent, got ${rows[0]?.value}`);
    assert(counters.outOfRange === 0, "a normal reading is not out of range");
  }

  // Inclusive edges: RTU 005 and 011 read exactly 100, and an empty battery is 0.
  for (const edge of ["0.00", "100.00"]) {
    const { rows, counters } = ingest(edge, PERCENT_BAND);
    assert(rows.length === 1, `${edge} is inside the inclusive band and is stored`);
    assert(counters.outOfRange === 0, `${edge} must not count as out of range`);
  }

  {
    // A reading just past full is refused too — the band is a ceiling as well as a floor.
    const { rows, counters } = ingest("100.01", PERCENT_BAND);
    assert(rows.length === 0 && counters.outOfRange === 1, "100.01 % is refused");
  }
}

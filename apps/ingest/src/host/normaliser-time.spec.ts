import {
  assert,
  makeFakeClient,
  PILOT_INDEX,
  RECEIVED_AT,
  sample,
} from "./normaliser.spec.js";
import { resolveSamples, writeResolved, type PointValueRow } from "./normaliser.js";
import { receivedTogether } from "./received-sample.js";

/**
 * ADR 0061 — `time` is the receive time and `device_time` keeps what the RTU
 * said (`F4.57`).
 *
 * **Why this is its own file.** `runNormaliserTests` in `normaliser.spec.ts` is
 * a single `it()` over fifteen blocks joined by a throwing `assert`, so only the
 * first failure in it is ever observed. A claim appended there would sit behind
 * fourteen earlier blocks and could not be shown to redden on its own mutation.
 * One exported function per claim, one `it()` each in the wrapper, so every
 * mutation below reddens a named assertion rather than "the normaliser suite".
 *
 * The fixtures and the index come from `normaliser.spec.ts` — the same shape
 * `disk-buffer-refused.spec.ts` and `supervisor-valve.spec.ts` already use — so
 * the two files cannot drift into describing two different pilots.
 */

/**
 * The two extremes ADR 0061 §Context measured on 2026-08-22, as offsets from
 * the receive time rather than as absolute instants: `861736076128211` ran
 * 3 h 02 m 36 s **behind** the server and `861736076104923` 34 m 31 s **ahead**.
 * They are written as arithmetic on `RECEIVED_AT` so the offset is the thing a
 * reader checks, and so a re-synced device cannot silently make the fixture
 * mean something else — these are shapes of skew, not a pin on that day's
 * measurement.
 */
const LAGGING_DEVICE_TIME = new Date(RECEIVED_AT.getTime() - (3 * 3600 + 2 * 60 + 36) * 1000);
const LEADING_DEVICE_TIME = new Date(RECEIVED_AT.getTime() + (34 * 60 + 31) * 1000);

function rowFor(rows: readonly PointValueRow[], pointKey: string): PointValueRow {
  const row = rows.find((r) => r.pointKey === pointKey);
  if (row === undefined) {
    throw new Error(
      `no row for ${pointKey}; the batch wrote ${rows.map((r) => r.pointKey).join(",") || "nothing"}`,
    );
  }
  return row;
}

/**
 * `null` prints as `null` rather than vanishing from a template literal, and an
 * Invalid Date prints rather than throwing.
 *
 * The `Number.isFinite` guard is not decoration. `toISOString()` raises
 * `RangeError: Invalid time value` on an Invalid Date, so a naive formatter
 * throws while building the failure message of the very assertion that exists
 * to keep an Invalid Date out of `device_time` — the run goes red with
 * `RangeError` and the sentence explaining why is lost. Measured: it is what
 * the mutation "accept an Invalid Date as a device time" printed before this
 * guard was added.
 */
function show(value: Date | null): string {
  if (value === null) {
    return "null";
  }
  return Number.isFinite(value.getTime()) ? value.toISOString() : "an Invalid Date";
}

/**
 * Decisions 2 and 3 — a device timestamp never reaches `time`, in either
 * direction, and `device_time` is stored unclamped.
 */
export function assertDeviceTimeNeverReachesTime(): void {
  const { rows, counters } = resolveSamples(
    receivedTogether(
      [
        sample({ sourceKey: "flow", at: LAGGING_DEVICE_TIME }),
        sample({ sourceKey: "press", at: LEADING_DEVICE_TIME }),
      ],
      RECEIVED_AT,
    ),
    PILOT_INDEX,
    "RTU-1",
  );

  const flow = rowFor(rows, "FLOW_RATE");
  const press = rowFor(rows, "PRESSURE");

  assert(
    flow.time.getTime() === RECEIVED_AT.getTime(),
    `ADR 0061 decision 2: time is the receive time for every row, whatever the ` +
      `device said. Expected ${RECEIVED_AT.toISOString()}, got ${flow.time.toISOString()}`,
  );
  assert(
    flow.deviceTime?.getTime() === LAGGING_DEVICE_TIME.getTime(),
    `ADR 0061 decision 3: a device 3:02:36 behind keeps its own stamp in ` +
      `device_time. Expected ${LAGGING_DEVICE_TIME.toISOString()}, got ${show(flow.deviceTime)}`,
  );
  assert(
    press.deviceTime?.getTime() === LEADING_DEVICE_TIME.getTime(),
    `ADR 0061 decision 3: device_time is UNCLAMPED, so a device 34:31 ahead is ` +
      `stored ahead — clamping it forward is exactly what ruling 1 declined, ` +
      `because the skew has to stay measurable after the fact. Expected ` +
      `${LEADING_DEVICE_TIME.toISOString()}, got ${show(press.deviceTime)}`,
  );
  assert(
    counters.invalidTimestamp === 0,
    `a readable device timestamp is not an unreadable one: invalidTimestamp ` +
      `must stay 0, got ${counters.invalidTimestamp}`,
  );
}

/** Decision 4 case 2 — a payload carrying no `ts` at all. */
export function assertOmittedTimestampYieldsNullDeviceTime(): void {
  const { rows, counters } = resolveSamples(
    receivedTogether([sample({ sourceKey: "flow" })], RECEIVED_AT),
    PILOT_INDEX,
    "RTU-1",
  );

  assert(
    rows[0].deviceTime === null,
    `ADR 0061 decision 4 case 2: a sample with no 'at' has no device time, and ` +
      `the receive time must not be substituted into device_time — that is the ` +
      `invention ruling 2 refused. Got ${show(rows[0].deviceTime)}`,
  );
  assert(
    counters.invalidTimestamp === 0,
    `an honest absence is not an unreadable timestamp, got ${counters.invalidTimestamp}`,
  );
}

/** Decision 4 case 3 and decision 5 — an `at` this host cannot read. */
export function assertUnreadableTimestampYieldsNullDeviceTimeAndCounts(): void {
  const { rows, counters } = resolveSamples(
    receivedTogether([sample({ sourceKey: "flow", at: new Date("nonsense") })], RECEIVED_AT),
    PILOT_INDEX,
    "RTU-1",
  );

  assert(
    rows.length === 1,
    `an unreadable device timestamp must not lose the reading, got ${rows.length} rows`,
  );
  assert(
    rows[0].deviceTime === null,
    `ADR 0061 decision 4 case 3: an Invalid Date must not be carried into ` +
      `device_time. 'pg' serialises a Date parameter with toISOString(), which ` +
      `THROWS on an Invalid Date and would fail the whole batch of good ` +
      `readings — this line is what stands between. Got ${show(rows[0].deviceTime)}`,
  );
  assert(
    counters.invalidTimestamp === 1,
    `ADR 0061 decision 5: the counter keeps firing once the value no longer ` +
      `steers 'time'. It records "the device sent a timestamp this host could ` +
      `not read". Got ${counters.invalidTimestamp}`,
  );
}

/**
 * Decision 6 — the dedupe key is the stored key, and the collapse it causes is
 * attributed rather than anonymous.
 */
export function assertCollapseIsAttributed(): void {
  const at1 = new Date(RECEIVED_AT.getTime() - 60_000);
  const at2 = new Date(RECEIVED_AT.getTime() - 30_000);
  const { rows, counters } = resolveSamples(
    receivedTogether(
      [
        sample({ sourceKey: "flow", value: 1, at: at1 }),
        sample({ sourceKey: "flow", value: 2, at: at2 }),
      ],
      RECEIVED_AT,
    ),
    PILOT_INDEX,
    "RTU-1",
  );

  assert(
    rows.length === 1,
    `ADR 0061 decision 6: the in-batch key is the STORED key ` +
      `(receivedAt, assetId, pointKey), so two samples for one point in one ` +
      `batch collapse whatever their device times say. Keying on the device ` +
      `time is ruling 3's first form, which Postgres rejects with "ON CONFLICT ` +
      `DO UPDATE command cannot affect row a second time". Got ${rows.length} rows`,
  );
  assert(
    counters.duplicateInBatch === 1,
    `the collapse is counted, got ${counters.duplicateInBatch}`,
  );
  assert(
    counters.firstDuplicate?.assetId === "asset-a" &&
      counters.firstDuplicate.pointKey === "FLOW_RATE",
    `ADR 0061 decision 6: the reading cannot be kept, so the FACT of losing it ` +
      `is what gets kept — the collapse names the (assetId, pointKey) it ` +
      `discarded instead of folding it anonymously into a count. Got ` +
      `${JSON.stringify(counters.firstDuplicate)}`,
  );
  assert(
    rows[0].value === 2 && rows[0].deviceTime?.getTime() === at2.getTime(),
    `the last sample wins, matching what sequential upserts would have left ` +
      `behind — value and device_time both. Got value ${rows[0].value} and ` +
      `device_time ${show(rows[0].deviceTime)}`,
  );
}

/**
 * Decision 6 says the **first** collapsed point is the one recorded. One
 * collapsing pair cannot tell "first" from "last", so this is its own function
 * with two of them.
 */
export function assertTheFirstCollapseIsTheOneNamed(): void {
  const { counters } = resolveSamples(
    receivedTogether(
      [
        sample({ sourceKey: "press", value: 1 }),
        sample({ sourceKey: "press", value: 2 }),
        sample({ sourceKey: "flow", value: 3 }),
        sample({ sourceKey: "flow", value: 4 }),
      ],
      RECEIVED_AT,
    ),
    PILOT_INDEX,
    "RTU-1",
  );

  assert(
    counters.duplicateInBatch === 2,
    `two points collapsed once each, got ${counters.duplicateInBatch}`,
  );
  assert(
    counters.firstDuplicate?.pointKey === "PRESSURE",
    `the FIRST collapse is the one named, not the last — recording the latest ` +
      `would leave duplicateInBatch === 2 green and this line is the only one ` +
      `that can tell them apart. Got ${String(counters.firstDuplicate?.pointKey)}`,
  );
}

/**
 * ADR 0061 Amendment 1 item 2 — the notify payload is **not** widened.
 *
 * Async, and every caller must `await` it. Asserting inside a floating promise
 * turns a failure into an unhandled rejection the runner reports as a pass —
 * the trap `normaliser.spec.ts` records above `runNormaliserWriteTests`.
 */
export async function assertNotifyPayloadKeepsFiveFields(): Promise<void> {
  const { client, calls } = makeFakeClient();
  await writeResolved(client, [
    {
      time: RECEIVED_AT,
      assetId: "asset-a",
      pointKey: "FLOW_RATE",
      value: 1,
      unit: "m³/h",
      deviceTime: LEADING_DEVICE_TIME,
    },
  ]);

  const notify = calls.find((c) => c.text.includes("pg_notify"));
  assert(notify !== undefined, "the write must notify at all, or this assertion proves nothing");
  const payload = JSON.parse(String(notify?.values?.[1])) as {
    readings: Record<string, unknown>[];
  };
  assert(payload.readings.length === 1, `one row, one reading, got ${payload.readings.length}`);

  const keys = Object.keys(payload.readings[0]).sort().join(",");
  assert(
    keys === "assetId,pointKey,time,unit,value",
    `ADR 0061 Amendment 1 item 2: 'NotifyReading' is one wire shape declared ` +
      `TWICE — apps/ingest/src/host/chunk.ts:25 and ` +
      `apps/api/src/admin/telemetry-entry/notify-chunk.ts:20 — and carried over ` +
      `the 'bms_telemetry' channel to the API's relay and on to the socket. ` +
      `Decision 7's "no API and no web work" holds only while this payload is ` +
      `left alone, and decision 3 says nothing reads device_time yet. Do not ` +
      `add it to toNotifyReading. Got: ${keys}`,
  );
}

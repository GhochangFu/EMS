import type { SourceSample } from "@bms/shared/ingest";

import {
  buildUpsert,
  droppedCount,
  emptyCounters,
  resolveSamples,
  writeResolved,
  type PointIndex,
  type PointTarget,
  type PointValueRow,
  type QueryableClient,
  type SampleCounters,
} from "./normaliser.js";

/**
 * Exported, with the fixtures below, so `normaliser-time.spec.ts` can state
 * ADR 0061's claims against the same index and the same receive time — the
 * shape `disk-buffer-refused.spec.ts` and `supervisor-valve.spec.ts` already
 * use. Those claims live in their own file because `runNormaliserTests` is one
 * `it()` over fifteen blocks, and a claim added at the end of it would sit
 * behind every earlier `assert` and could never redden alone.
 */
export function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

export const RECEIVED_AT = new Date("2026-08-05T10:00:00.000Z");

function makeIndex(
  entries: Record<string, Record<string, PointTarget[]>>,
): PointIndex {
  return new Map(
    Object.entries(entries).map(([deviceKey, bySource]) => [
      deviceKey,
      new Map(Object.entries(bySource)),
    ]),
  );
}

/**
 * A point with no resolved metadata — five `NULL` columns, which ADR 0056
 * decision 1 defines as today's behaviour: multiplier `1`, offset `0`, no range
 * test, `discard_bad`. Every pre-`F2.7` case below is written against this, so
 * the cases that were green before decision 4 must stay green after it.
 */
const NO_METADATA = {
  scaleMultiplier: null,
  scaleOffset: null,
  engMin: null,
  engMax: null,
  qualityPolicy: null,
} as const;

/** A `PointTarget`, metadata-free unless the case under test sets some. */
function target(
  assetId: string,
  pointKey: string,
  unit: string | null,
  metadata: Partial<PointTarget> = {},
): PointTarget {
  return { ...NO_METADATA, assetId, pointKey, unit, ...metadata };
}

export const PILOT_INDEX = makeIndex({
  "RTU-1": {
    flow: [target("asset-a", "FLOW_RATE", "m³/h")],
    press: [target("asset-a", "PRESSURE", "bar")],
    // One meter feeding two assets — the fan-out case a Map<string, target>
    // would silently drop.
    shared: [target("asset-a", "TOTALISER", "m³"), target("asset-b", "INLET_TOTAL", "m³")],
    unitless: [target("asset-a", "STATUS", null)],
  },
  "RTU-2": {
    flow: [target("asset-c", "FLOW_RATE", "m³/h")],
  },
});

/** Records every statement so ordering and parameters can be asserted. */
export function makeFakeClient(failOn?: RegExp): {
  client: QueryableClient;
  calls: { text: string; values?: readonly unknown[] }[];
} {
  const calls: { text: string; values?: readonly unknown[] }[] = [];
  const client: QueryableClient = {
    async query(text, values) {
      calls.push({ text, values });
      if (failOn !== undefined && failOn.test(text)) {
        throw new Error("simulated database failure");
      }
      return undefined;
    },
  };
  return { client, calls };
}

export function sample(overrides: Partial<SourceSample> & { sourceKey: string }): SourceSample {
  return { value: 1, ...overrides };
}

/** The host write path (ADR 0016 §2). */
export function runNormaliserTests(): void {
  // ---- fan-out: one source key, several destinations ----------------------

  {
    const { rows, counters } = resolveSamples(
      [sample({ sourceKey: "shared", value: 42 })],
      PILOT_INDEX,
      RECEIVED_AT,
      "RTU-1",
    );
    assert(rows.length === 2, `a shared source_data_key must fan out to both assets, got ${rows.length}`);
    const points = rows.map((r) => `${r.assetId}/${r.pointKey}`).sort();
    assert(
      points.join(",") === "asset-a/TOTALISER,asset-b/INLET_TOTAL",
      `fan-out wrote the wrong destinations: ${points.join(",")}`,
    );
    assert(rows.every((r) => r.value === 42), "every fanned-out row carries the sample value");
    assert(counters.duplicateInBatch === 0, "distinct assets are not duplicates");
  }

  // ---- unit comes from the point mapping, not the sample -------------------

  {
    const { rows } = resolveSamples(
      [sample({ sourceKey: "unitless" })],
      PILOT_INDEX,
      RECEIVED_AT,
      "RTU-1",
    );
    assert(rows[0].unit === null, "a null unit must survive as null, not become undefined");
  }

  // ---- quality flag --------------------------------------------------------

  {
    const { rows, counters } = resolveSamples(
      [
        sample({ sourceKey: "flow", good: false }),
        sample({ sourceKey: "flow", good: true }),
        sample({ sourceKey: "press" }),
      ],
      PILOT_INDEX,
      RECEIVED_AT,
      "RTU-1",
    );
    assert(counters.badQuality === 1, `good:false must be dropped and counted, got ${counters.badQuality}`);
    // `good` omitted means "no quality information", which is not "bad".
    assert(rows.length === 2, `good:true and an absent flag must both write, got ${rows.length}`);
  }

  // ---- non-finite values ---------------------------------------------------

  {
    const { rows, counters } = resolveSamples(
      [
        sample({ sourceKey: "flow", value: Number.NaN }),
        sample({ sourceKey: "flow", value: Number.POSITIVE_INFINITY }),
        sample({ sourceKey: "press", value: 0 }),
      ],
      PILOT_INDEX,
      RECEIVED_AT,
      "RTU-1",
    );
    assert(counters.nonFinite === 2, `NaN and Infinity must be dropped, got ${counters.nonFinite}`);
    // Zero is a real reading. `index.js` skips "" but not 0, and so must this.
    assert(rows.length === 1 && rows[0].value === 0, "0 is a valid reading and must be written");
  }

  // ---- device resolution ---------------------------------------------------

  {
    const { counters } = resolveSamples(
      [sample({ sourceKey: "flow", deviceKey: "RTU-NOPE" })],
      PILOT_INDEX,
      RECEIVED_AT,
    );
    assert(counters.unknownDevice === 1, "an unmatched deviceKey is counted as unknownDevice");
    assert(counters.unmappedSourceKey === 0, "an unknown device is not an unmapped source key");
  }

  {
    const { counters } = resolveSamples(
      [sample({ sourceKey: "not-mapped", deviceKey: "RTU-1" })],
      PILOT_INDEX,
      RECEIVED_AT,
    );
    assert(
      counters.unmappedSourceKey === 1,
      "a known device with an unmapped source key is counted separately",
    );
  }

  {
    // Several bindings on the endpoint: an omitted deviceKey is ambiguous and
    // must be dropped rather than attributed to whichever binding came first.
    const { rows, counters } = resolveSamples(
      [sample({ sourceKey: "flow" })],
      PILOT_INDEX,
      RECEIVED_AT,
      undefined,
    );
    assert(rows.length === 0, "an ambiguous sample must not be written");
    assert(counters.ambiguousDevice === 1, "an omitted deviceKey with many bindings is counted");
  }

  {
    // Exactly one binding: the host supplies the deviceKey the adapter omitted.
    const { rows } = resolveSamples(
      [sample({ sourceKey: "flow", value: 7 })],
      PILOT_INDEX,
      RECEIVED_AT,
      "RTU-2",
    );
    assert(
      rows.length === 1 && rows[0].assetId === "asset-c",
      "a sole binding supplies the omitted deviceKey",
    );
  }

  {
    // An explicit deviceKey always wins over the sole-binding default.
    const { rows } = resolveSamples(
      [sample({ sourceKey: "flow", deviceKey: "RTU-2" })],
      PILOT_INDEX,
      RECEIVED_AT,
      "RTU-1",
    );
    assert(rows[0].assetId === "asset-c", "an explicit deviceKey must not be overridden");
  }

  // ---- timestamps ----------------------------------------------------------
  //
  // "a device timestamp must be used as-is" used to stand here. ADR 0061
  // decision 2 inverted it: a device timestamp never reaches `time` again. The
  // replacement claims — `time` is always the receive time, `device_time`
  // carries the device's own value unclamped, and the three NULL cases — are in
  // `normaliser-time.spec.ts`, one `it()` each.

  {
    const { rows } = resolveSamples(
      [sample({ sourceKey: "flow" })],
      PILOT_INDEX,
      RECEIVED_AT,
      "RTU-1",
    );
    assert(
      rows[0].time.getTime() === RECEIVED_AT.getTime(),
      "an omitted timestamp writes at receive time — the rule, not a fallback (ADR 0061 decision 2)",
    );
  }

  {
    // `new Date("nonsense")` is an Invalid Date: `toISOString()` throws on it,
    // which would take the whole batch down rather than one sample.
    const { rows, counters } = resolveSamples(
      [sample({ sourceKey: "flow", at: new Date("nonsense") })],
      PILOT_INDEX,
      RECEIVED_AT,
      "RTU-1",
    );
    assert(rows.length === 1, "an invalid timestamp must not lose the reading");
    assert(
      rows[0].time.getTime() === RECEIVED_AT.getTime(),
      "an invalid timestamp writes at receive time — as every row does since ADR 0061 decision 2",
    );
    assert(counters.invalidTimestamp === 1, "an invalid timestamp is counted");
  }

  // ---- in-batch dedupe -----------------------------------------------------

  {
    // Two samples for the same point in one batch. Postgres rejects an
    // ON CONFLICT DO UPDATE statement that touches one row twice, so this must
    // collapse before it reaches the database. Since ADR 0061 decision 6 the
    // key is the stored key, `(receivedAt, assetId, pointKey)`, so the shared
    // `at` below is no longer what makes these two a duplicate — the shared
    // batch is. `normaliser-time.spec.ts` owns the attribution half.
    const at = new Date("2026-08-05T09:00:00.000Z");
    const { rows, counters } = resolveSamples(
      [
        sample({ sourceKey: "flow", value: 1, at }),
        sample({ sourceKey: "flow", value: 2, at }),
      ],
      PILOT_INDEX,
      RECEIVED_AT,
      "RTU-1",
    );
    assert(rows.length === 1, `duplicates must collapse to one row, got ${rows.length}`);
    assert(rows[0].value === 2, "the last value wins, matching sequential upserts");
    assert(counters.duplicateInBatch === 1, "the collapsed row is counted");
  }

  {
    // Same point, different device instants. "distinct timestamps are distinct
    // rows" was true while `time` came from `at`; ADR 0061 decision 6 inverts
    // it. The device's clock no longer reaches the key, so these two are one
    // row — the reading this schema cannot keep, and §Consequences says so in
    // as many words.
    const { rows, counters } = resolveSamples(
      [
        sample({ sourceKey: "flow", at: new Date("2026-08-05T09:00:00.000Z") }),
        sample({ sourceKey: "flow", at: new Date("2026-08-05T09:00:01.000Z") }),
      ],
      PILOT_INDEX,
      RECEIVED_AT,
      "RTU-1",
    );
    assert(
      rows.length === 1,
      `distinct device timestamps no longer make distinct rows, got ${rows.length}`,
    );
    assert(counters.duplicateInBatch === 1, "the collapse the stored key causes is counted");
  }

  // ---- SQL shape -----------------------------------------------------------

  {
    // Six columns since ADR 0061 decision 1, with `device_time` **last** so the
    // bind order of the five that were already here does not move.
    const deviceTime = new Date("2026-08-05T06:57:24.000Z");
    const rows: PointValueRow[] = [
      { time: RECEIVED_AT, assetId: "a", pointKey: "P", value: 1, unit: "kW", deviceTime },
      { time: RECEIVED_AT, assetId: "b", pointKey: "Q", value: 2, unit: null, deviceTime: null },
    ];
    const { text, values } = buildUpsert(rows);
    assert(values.length === 12, `six parameters per row, got ${values.length}`);
    assert(
      text.includes("($1, $2, $3, $4, $5, $6), ($7, $8, $9, $10, $11, $12)"),
      `wrong tuple list: ${text}`,
    );
    assert(
      text.includes("(time, asset_id, point_key, value, unit, device_time)"),
      `the column list must name device_time, last: ${text}`,
    );
    assert(
      text.includes("ON CONFLICT (time, asset_id, point_key) DO UPDATE"),
      "the upsert clause must match the conflict target index.js relies on",
    );
    // The parallel-run window (ADR 0016 §6, commit 3) depends on this being an
    // idempotent upsert — two processes writing the same rows must not corrupt.
    assert(
      text.includes("value = EXCLUDED.value") && text.includes("unit = EXCLUDED.unit"),
      "the update clause must refresh both value and unit",
    );
    // ADR 0061 Amendment 1 item 1. Without this clause a re-delivered reading
    // updates `value` and `unit` and keeps the **first** delivery's
    // `device_time`, so the column stops describing the row it sits on — the
    // exact failure this ADR exists to prevent, one column over.
    assert(
      text.includes("device_time = EXCLUDED.device_time"),
      `a second delivery must move the stored device_time: ${text}`,
    );
    assert(
      values[5] === deviceTime && values[11] === null,
      `device_time binds sixth in each row, as a Date or as null; got ${String(values[5])} and ${String(values[11])}`,
    );
    assert(values[4] === "kW" && values[10] === null, "a null unit binds as null");
  }

}

/**
 * The `writeResolved` half, kept separate because it is async.
 *
 * Everything here must be `await`ed by the wrapper. Asserting inside a
 * `void promise.then(…)` from the synchronous function above would turn a
 * failed assertion into an unhandled rejection that the runner reports as a
 * pass — a test that cannot fail is worse than no test.
 */
export async function runNormaliserWriteTests(): Promise<void> {
  const rows: PointValueRow[] = [
    { time: RECEIVED_AT, assetId: "a", pointKey: "P", value: 1, unit: "kW", deviceTime: null },
    { time: RECEIVED_AT, assetId: "b", pointKey: "Q", value: 2, unit: null, deviceTime: null },
  ];

  // ---- transaction ordering ------------------------------------------------

  {
    const { client, calls } = makeFakeClient();
    await writeResolved(client, rows);
    assert(calls[0].text === "BEGIN", `the batch must open a transaction, got "${calls[0].text}"`);
    assert(calls[1].text.startsWith("INSERT INTO"), "the upsert runs inside the transaction");
    assert(calls[2].text === "COMMIT", `the transaction must commit, got "${calls[2].text}"`);
  }

  // ---- notify is unconditional (ADR 0016 §6 commit 4) ----------------------

  {
    // There is no way to write rows without notifying. Until commit 4 there was:
    // `notify` defaulted to off, which was right only while the ADR 0007 pilot
    // was also notifying, and afterwards was the one configuration that wrote
    // telemetry while every dashboard went silently dead.
    //
    // Reinstating a suppression path — an option, a flag, an early return — makes
    // this assertion fail, which is the point of stating it positively on the
    // plain call rather than only testing the enabled case.
    const { client, calls } = makeFakeClient();
    const result = await writeResolved(client, rows);
    assert(
      calls.some((c) => c.text.includes("pg_notify")),
      "a plain writeResolved must notify — no argument, environment or default " +
        "may suppress realtime (ADR 0016 §6 commit 4, Amendment 3)",
    );
    assert(result.notificationsSent === 1, "the notification is reported, not merely sent");
    assert(result.rowsWritten === 2, "both rows are still written");
  }

  // ---- the notification's shape and ordering -------------------------------

  {
    const { client, calls } = makeFakeClient();
    const result = await writeResolved(client, rows);
    const notifies = calls.filter((c) => c.text.includes("pg_notify"));
    assert(notifies.length === 1, `two small rows fit one notification, got ${notifies.length}`);
    assert(result.notificationsSent === 1, "the notification count is reported");
    assert(notifies[0].values?.[0] === "bms_telemetry", "the channel must match the API's LISTEN");

    const payload = JSON.parse(String(notifies[0].values?.[1])) as {
      readings: { time: string; assetId: string; value: number; unit: string | null }[];
    };
    assert(payload.readings.length === 2, "both rows appear in the payload");
    assert(
      payload.readings[0].time === RECEIVED_AT.toISOString(),
      "the payload carries an ISO string, not a Date",
    );
    assert(payload.readings[1].unit === null, "a null unit survives serialisation");

    // Notification comes after COMMIT: a listener must never be told about a
    // reading that then rolls back.
    const commitAt = calls.findIndex((c) => c.text === "COMMIT");
    const notifyAt = calls.findIndex((c) => c.text.includes("pg_notify"));
    assert(commitAt >= 0 && notifyAt > commitAt, "NOTIFY must follow COMMIT");
  }

  // ---- notify carries the deduped set, not the raw samples -----------------

  {
    const at = new Date("2026-08-05T09:00:00.000Z");
    const { rows: resolved } = resolveSamples(
      [
        sample({ sourceKey: "flow", value: 1, at }),
        sample({ sourceKey: "flow", value: 2, at }),
      ],
      PILOT_INDEX,
      RECEIVED_AT,
      "RTU-1",
    );
    const { client, calls } = makeFakeClient();
    await writeResolved(client, resolved);
    const payload = JSON.parse(
      String(calls.find((c) => c.text.includes("pg_notify"))?.values?.[1]),
    ) as { readings: { value: number }[] };
    assert(
      payload.readings.length === 1 && payload.readings[0].value === 2,
      "the payload must announce what was written, not what arrived",
    );
  }

  // ---- large batches split across statements and notifications ------------

  {
    const many: PointValueRow[] = Array.from({ length: 2500 }, (_unused, i) => ({
      time: RECEIVED_AT,
      assetId: `aaaaaaaa-0000-4000-8000-${String(i).padStart(12, "0")}`,
      pointKey: "FLOW_RATE",
      value: i,
      unit: "m³/h",
      deviceTime: null,
    }));
    const { client, calls } = makeFakeClient();
    const result = await writeResolved(client, many);
    const inserts = calls.filter((c) => c.text.startsWith("INSERT INTO telemetry.point_values"));
    assert(inserts.length === 3, `2500 rows must split into 3 statements, got ${inserts.length}`);
    assert(
      inserts.every((c) => (c.values?.length ?? 0) <= 65535),
      "no statement may exceed the Postgres bind-parameter ceiling",
    );
    assert(
      inserts.reduce((n, c) => n + (c.values?.length ?? 0) / 6, 0) === 2500,
      "every row is written exactly once across the statements",
    );
    assert(result.rowsWritten === 2500, "the written count covers every row");
    assert(result.notificationsSent > 1, "a large batch needs several notifications");
    // Every statement is inside the one transaction, which is what makes the
    // batch atomic rather than partially visible.
    assert(calls[0].text === "BEGIN", "the multi-statement batch opens one transaction");
    assert(
      calls.filter((c) => c.text === "COMMIT").length === 1,
      "the multi-statement batch commits exactly once",
    );
  }

  // ---- rollback on failure -------------------------------------------------

  {
    const { client, calls } = makeFakeClient(/^INSERT/);
    let rejected = false;
    try {
      await writeResolved(client, rows);
    } catch {
      rejected = true;
    }
    assert(rejected, "a failing upsert must reject so the supervisor sees it");
    assert(calls.some((c) => c.text === "ROLLBACK"), "a failing upsert must roll back");
    assert(
      !calls.some((c) => c.text.includes("pg_notify")),
      "a rolled-back batch must never notify",
    );
  }

  // ---- an empty batch touches nothing --------------------------------------

  {
    const { client, calls } = makeFakeClient();
    const result = await writeResolved(client, []);
    assert(calls.length === 0, "an empty batch must not open a transaction or notify");
    assert(result.rowsWritten === 0, "an empty batch writes nothing");
  }
}

/**
 * `F2.7` / ADR 0056 decision 4 — the resolved point metadata, applied **per
 * target** in one fixed order: quality policy → scale → finite → range.
 *
 * The order is the decision, not an implementation detail, so the cases below
 * are written in that order and the two that make it observable (case 7) fail
 * on any other. A `discard_bad` sample that the range test would also have
 * refused must count `badQuality` and not `outOfRange`, or the two policies are
 * indistinguishable in the counters — which is the reason the ADR fixes the
 * order at all.
 */
export function runMetadataTests(): void {
  /** One sample, one target, no fan-out — the shape most cases below need. */
  function resolveOne(
    pointTarget: PointTarget,
    overrides: Partial<SourceSample> = {},
  ): ReturnType<typeof resolveSamples> {
    const index = makeIndex({ "RTU-1": { flow: [pointTarget] } });
    return resolveSamples(
      [sample({ sourceKey: "flow", ...overrides })],
      index,
      RECEIVED_AT,
      "RTU-1",
    );
  }

  const point = (metadata: Partial<PointTarget> = {}): PointTarget =>
    target("asset-a", "FLOW_RATE", "m³/h", metadata);

  // ---- 1. quality policy: NULL is `discard_bad`, today's rule --------------

  {
    const { rows, counters } = resolveOne(point(), { good: false });
    assert(
      counters.badQuality === 1,
      `a NULL quality policy discards a bad sample, got badQuality ${counters.badQuality}`,
    );
    assert(rows.length === 0, "a discarded sample writes no row");
  }

  // ---- 2. `accept_bad` stores the reading ---------------------------------

  {
    const { rows, counters } = resolveOne(point({ qualityPolicy: "accept_bad" }), {
      value: 12,
      good: false,
    });
    assert(rows.length === 1, `accept_bad must store the sample, got ${rows.length} rows`);
    assert(rows[0].value === 12, `accept_bad stores the value unchanged, got ${rows[0].value}`);
    assert(counters.badQuality === 0, "an accepted sample is not counted as bad quality");
  }

  // ---- 3. scale: value × multiplier + offset ------------------------------

  {
    const { rows } = resolveOne(point({ scaleMultiplier: 0.5, scaleOffset: 2 }), { value: 10 });
    assert(
      rows.length === 1 && rows[0].value === 7,
      `10 × 0.5 + 2 must be stored as 7, got ${rows[0]?.value}`,
    );
  }

  // ---- 4. finite runs on the SCALED value, before the range test ----------

  {
    // Scaling overflows to Infinity. The range test would also refuse it — and
    // must not be the one that does, or an overflow is reported as an
    // instrument reading outside its band rather than as arithmetic that broke.
    const { rows, counters } = resolveOne(
      point({ scaleMultiplier: 1e308, engMin: 0, engMax: 100 }),
      { value: 1e10 },
    );
    assert(rows.length === 0, "an overflowed value must not be written");
    assert(counters.nonFinite === 1, `the overflow is nonFinite, got ${counters.nonFinite}`);
    assert(
      counters.outOfRange === 0,
      `the finite test runs before the range test, so outOfRange must stay 0, got ${counters.outOfRange}`,
    );
  }

  // ---- 5. range is inclusive at both ends ---------------------------------

  {
    const banded = point({ engMin: 0, engMax: 100 });

    const above = resolveOne(banded, { value: 150 });
    assert(above.rows.length === 0, "150 is outside [0, 100] and must not be written");
    assert(above.counters.outOfRange === 1, "an over-range sample is counted");

    const below = resolveOne(banded, { value: -1 });
    assert(below.rows.length === 0, "-1 is outside [0, 100] and must not be written");
    assert(below.counters.outOfRange === 1, "an under-range sample is counted");

    for (const edge of [0, 100]) {
      const { rows, counters } = resolveOne(banded, { value: edge });
      assert(rows.length === 1, `${edge} is inside the inclusive band and must be written`);
      assert(rows[0].value === edge, `the edge value is stored unchanged, got ${rows[0].value}`);
      assert(counters.outOfRange === 0, `${edge} must not count as out of range`);
    }
  }

  // ---- 5b. the two bounds are independent ---------------------------------

  {
    // The CHECK constrains only the both-non-null pair, so one bound alone is a
    // valid row and a `&&` between the two tests would let its half through.
    const floorOnly = resolveOne(point({ engMin: 0 }), { value: -5 });
    assert(floorOnly.rows.length === 0, "engMin alone still refuses a value below it");
    assert(floorOnly.counters.outOfRange === 1, "engMin alone counts the refusal");

    const ceilingOnly = resolveOne(point({ engMax: 10 }), { value: 1e9 });
    assert(ceilingOnly.rows.length === 0, "engMax alone still refuses a value above it");
    assert(ceilingOnly.counters.outOfRange === 1, "engMax alone counts the refusal");

    const inside = resolveOne(point({ engMin: 0 }), { value: 1e9 });
    assert(inside.rows.length === 1, "engMin alone imposes no ceiling");
  }

  // ---- 6. the range tests the scaled value, not the raw one ---------------

  {
    const { rows, counters } = resolveOne(
      point({ scaleMultiplier: 0.01, engMin: 0, engMax: 100 }),
      { value: 1000 },
    );
    assert(
      rows.length === 1 && rows[0].value === 10,
      `a raw 1000 scaled by 0.01 is 10 and inside [0, 100], got ${rows.length} rows`,
    );
    assert(counters.outOfRange === 0, "the raw value is not what the band is about");
  }

  // ---- 7. the order is observable in the counters -------------------------

  {
    const accepted = resolveOne(
      point({ qualityPolicy: "accept_bad", engMin: 0, engMax: 100 }),
      { value: 150, good: false },
    );
    assert(accepted.counters.outOfRange === 1, "accept_bad lets the sample reach the range test");
    assert(accepted.counters.badQuality === 0, "accept_bad never counts badQuality");

    const discarded = resolveOne(
      point({ qualityPolicy: "discard_bad", engMin: 0, engMax: 100 }),
      { value: 150, good: false },
    );
    assert(discarded.counters.badQuality === 1, "discard_bad refuses before the range test");
    assert(
      discarded.counters.outOfRange === 0,
      `a sample refused by policy never reaches the band, got outOfRange ${discarded.counters.outOfRange}`,
    );
  }

  // ---- 7b. the raw pre-check still runs ahead of every target -------------

  {
    // A non-numeric or non-finite raw value cannot be scaled, so it is dropped
    // once per sample rather than once per target — which is why the pre-check
    // stays where it is and a bad-quality NaN counts `nonFinite`, not
    // `badQuality`.
    const { rows, counters } = resolveOne(point(), { value: Number.NaN, good: false });
    assert(rows.length === 0, "NaN is dropped whatever the policy says");
    assert(counters.nonFinite === 1, "an unscalable raw value is nonFinite");
    assert(
      counters.badQuality === 0,
      `the raw pre-check runs before the per-target policy, got badQuality ${counters.badQuality}`,
    );
  }

  // ---- 8. no metadata means no arithmetic ---------------------------------

  {
    // `x * 1 + 0` is not the identity: it turns -0 into 0, and -0 is what a
    // signed power meter reports for an idle circuit. With both scale fields
    // NULL the stored value must be the sample's own.
    const { rows } = resolveOne(point(), { value: -0 });
    assert(
      Object.is(rows[0].value, -0),
      `both scale fields NULL must skip the arithmetic, got ${Object.is(rows[0].value, 0) ? "0" : String(rows[0].value)}`,
    );

    // One field set is enough to make it a scaled point, and then the
    // arithmetic runs as written.
    const scaled = resolveOne(point({ scaleOffset: 0 }), { value: -0 });
    assert(
      Object.is(scaled.rows[0].value, 0) && !Object.is(scaled.rows[0].value, -0),
      "an offset of 0 is still a scaling rule, and -0 + 0 is 0",
    );
  }

  // ---- 9. fan-out resolves metadata per target ----------------------------

  {
    const index = makeIndex({
      "RTU-1": {
        shared: [
          target("asset-a", "TOTALISER", "m³", { scaleMultiplier: 0.001 }),
          target("asset-b", "INLET_TOTAL", "m³"),
        ],
      },
    });
    const { rows } = resolveSamples(
      [sample({ sourceKey: "shared", value: 2500 })],
      index,
      RECEIVED_AT,
      "RTU-1",
    );
    const byAsset = new Map(rows.map((r) => [r.assetId, r.value]));
    assert(byAsset.get("asset-a") === 2.5, `the scaled target stores 2.5, got ${byAsset.get("asset-a")}`);
    assert(
      byAsset.get("asset-b") === 2500,
      `the unscaled target stores the raw value, got ${byAsset.get("asset-b")}`,
    );
  }

  {
    // A counter counts a refused **write**, not a refused sample: one target of
    // a fan-out can be out of range while the other is written.
    const index = makeIndex({
      "RTU-1": {
        shared: [
          target("asset-a", "TOTALISER", "m³", { engMax: 10 }),
          target("asset-b", "INLET_TOTAL", "m³"),
        ],
      },
    });
    const { rows, counters } = resolveSamples(
      [sample({ sourceKey: "shared", value: 42 })],
      index,
      RECEIVED_AT,
      "RTU-1",
    );
    assert(rows.length === 1 && rows[0].assetId === "asset-b", "the in-range target is written");
    assert(counters.outOfRange === 1, `the refused target is counted once, got ${counters.outOfRange}`);
  }

  // ---- 10. the counters and the dropped-sample sum ------------------------

  {
    const zeroed = emptyCounters();
    assert(zeroed.outOfRange === 0, "emptyCounters must zero the new bucket too");
    assert(droppedCount(zeroed) === 0, "a zeroed counter set has dropped nothing");

    // Powers of two, so a missing or extra key names itself in the arithmetic
    // rather than hiding in a sum that happens to match.
    const filled: SampleCounters = {
      badQuality: 1,
      nonFinite: 2,
      unknownDevice: 4,
      unmappedSourceKey: 8,
      ambiguousDevice: 16,
      outOfRange: 32,
      invalidTimestamp: 64,
      duplicateInBatch: 128,
      // ADR 0061 decision 6's datum. Not a number, so it cannot reach a sum —
      // which is the strongest form of "droppedCount ignores it".
      firstDuplicate: null,
    };
    assert(
      droppedCount(filled) === 63,
      `droppedCount sums the six drop buckets and ignores invalidTimestamp and duplicateInBatch, got ${droppedCount(filled)}`,
    );
  }
}

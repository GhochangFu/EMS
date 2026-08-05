import type { SourceSample } from "@bms/shared/ingest";

import {
  buildUpsert,
  resolveSamples,
  writeResolved,
  type PointIndex,
  type PointTarget,
  type PointValueRow,
  type QueryableClient,
} from "./normaliser.js";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const RECEIVED_AT = new Date("2026-08-05T10:00:00.000Z");

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

const PILOT_INDEX = makeIndex({
  "RTU-1": {
    flow: [{ assetId: "asset-a", pointKey: "FLOW_RATE", unit: "m³/h" }],
    press: [{ assetId: "asset-a", pointKey: "PRESSURE", unit: "bar" }],
    // One meter feeding two assets — the fan-out case a Map<string, target>
    // would silently drop.
    shared: [
      { assetId: "asset-a", pointKey: "TOTALISER", unit: "m³" },
      { assetId: "asset-b", pointKey: "INLET_TOTAL", unit: "m³" },
    ],
    unitless: [{ assetId: "asset-a", pointKey: "STATUS", unit: null }],
  },
  "RTU-2": {
    flow: [{ assetId: "asset-c", pointKey: "FLOW_RATE", unit: "m³/h" }],
  },
});

/** Records every statement so ordering and parameters can be asserted. */
function makeFakeClient(failOn?: RegExp): {
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

function sample(overrides: Partial<SourceSample> & { sourceKey: string }): SourceSample {
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

  {
    const deviceTime = new Date("2026-08-05T09:59:12.000Z");
    const { rows, counters } = resolveSamples(
      [sample({ sourceKey: "flow", at: deviceTime })],
      PILOT_INDEX,
      RECEIVED_AT,
      "RTU-1",
    );
    assert(rows[0].time.getTime() === deviceTime.getTime(), "a device timestamp must be used as-is");
    assert(counters.invalidTimestamp === 0, "a valid timestamp is not counted as invalid");
  }

  {
    const { rows } = resolveSamples(
      [sample({ sourceKey: "flow" })],
      PILOT_INDEX,
      RECEIVED_AT,
      "RTU-1",
    );
    assert(
      rows[0].time.getTime() === RECEIVED_AT.getTime(),
      "an omitted timestamp falls back to receive time",
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
      "an invalid timestamp falls back to receive time",
    );
    assert(counters.invalidTimestamp === 1, "an invalid timestamp is counted");
  }

  // ---- in-batch dedupe -----------------------------------------------------

  {
    // Two samples for the same point at the same instant. Postgres rejects an
    // ON CONFLICT DO UPDATE statement that touches one row twice, so this must
    // collapse before it reaches the database.
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
    // Same point, different instants: not a duplicate.
    const { rows } = resolveSamples(
      [
        sample({ sourceKey: "flow", at: new Date("2026-08-05T09:00:00.000Z") }),
        sample({ sourceKey: "flow", at: new Date("2026-08-05T09:00:01.000Z") }),
      ],
      PILOT_INDEX,
      RECEIVED_AT,
      "RTU-1",
    );
    assert(rows.length === 2, "distinct timestamps are distinct rows");
  }

  // ---- SQL shape -----------------------------------------------------------

  {
    const rows: PointValueRow[] = [
      { time: RECEIVED_AT, assetId: "a", pointKey: "P", value: 1, unit: "kW" },
      { time: RECEIVED_AT, assetId: "b", pointKey: "Q", value: 2, unit: null },
    ];
    const { text, values } = buildUpsert(rows);
    assert(values.length === 10, `five parameters per row, got ${values.length}`);
    assert(text.includes("($1, $2, $3, $4, $5), ($6, $7, $8, $9, $10)"), `wrong tuple list: ${text}`);
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
    assert(values[4] === "kW" && values[9] === null, "a null unit binds as null");
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
    { time: RECEIVED_AT, assetId: "a", pointKey: "P", value: 1, unit: "kW" },
    { time: RECEIVED_AT, assetId: "b", pointKey: "Q", value: 2, unit: null },
  ];

  // ---- transaction ordering ------------------------------------------------

  {
    const { client, calls } = makeFakeClient();
    await writeResolved(client, rows);
    assert(calls[0].text === "BEGIN", `the batch must open a transaction, got "${calls[0].text}"`);
    assert(calls[1].text.startsWith("INSERT INTO"), "the upsert runs inside the transaction");
    assert(calls[2].text === "COMMIT", `the transaction must commit, got "${calls[2].text}"`);
  }

  // ---- notify defaults to OFF ---------------------------------------------

  {
    const { client, calls } = makeFakeClient();
    const result = await writeResolved(client, rows);
    assert(
      !calls.some((c) => c.text.includes("pg_notify")),
      "NOTIFY must be off unless explicitly enabled — two notifying processes " +
        "double-deliver every PHE reading to live dashboards (ADR 0016 §6)",
    );
    assert(result.notificationsSent === 0, "no notifications are reported when notify is off");
    assert(result.rowsWritten === 2, "rows are still written with notify off");
  }

  {
    const { client, calls } = makeFakeClient();
    const result = await writeResolved(client, rows, { notify: false });
    assert(!calls.some((c) => c.text.includes("pg_notify")), "notify:false suppresses NOTIFY");
    assert(result.notificationsSent === 0, "notify:false reports no notifications");
  }

  // ---- notify on -----------------------------------------------------------

  {
    const { client, calls } = makeFakeClient();
    const result = await writeResolved(client, rows, { notify: true });
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
    await writeResolved(client, resolved, { notify: true });
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
    }));
    const { client, calls } = makeFakeClient();
    const result = await writeResolved(client, many, { notify: true });
    const inserts = calls.filter((c) => c.text.startsWith("INSERT INTO telemetry.point_values"));
    assert(inserts.length === 3, `2500 rows must split into 3 statements, got ${inserts.length}`);
    assert(
      inserts.every((c) => (c.values?.length ?? 0) <= 65535),
      "no statement may exceed the Postgres bind-parameter ceiling",
    );
    assert(
      inserts.reduce((n, c) => n + (c.values?.length ?? 0) / 5, 0) === 2500,
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
      await writeResolved(client, rows, { notify: true });
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
    const result = await writeResolved(client, [], { notify: true });
    assert(calls.length === 0, "an empty batch must not open a transaction or notify");
    assert(result.rowsWritten === 0, "an empty batch writes nothing");
  }
}

import type { SourceSample } from "@bms/shared/ingest";

import { chunkReadings, type NotifyReading } from "./chunk.js";

/**
 * The host's write path (ADR 0016 §2).
 *
 * Adapters emit `SourceSample[]` and nothing else. Everything below — resolving
 * `source_data_key` to `(assetId, pointKey, unit)`, the timestamp fallback, the
 * batched upsert into `telemetry.point_values`, and the `pg_notify` fan-out —
 * belongs to the host. That is the clause that makes six protocol adapters safe
 * to build in parallel, and it is what makes `F1.11` ("ingest is the only
 * `telemetry.*` writer") a one-module change rather than a six-module
 * migration.
 *
 * Split into a **pure** half (`resolveSamples`) and an **I/O** half
 * (`writeResolved`) so the interesting logic is testable with no database at
 * all, per ADR 0016 §9.
 */

/** One destination a `source_data_key` writes to. */
export type PointTarget = {
  readonly assetId: string;
  readonly pointKey: string;
  readonly unit: string | null;
};

/**
 * `deviceKey → sourceKey → targets`.
 *
 * The innermost value is a **list**, not a single target. Two assets bound to
 * the same RTU can legitimately carry the same `source_data_key` — a shared
 * flow meter feeding both a plant asset and a header asset, say. `index.js`
 * fans out correctly today only because `mappingByRtu` holds a flat array it
 * loops over; a `Map<string, PointTarget>` would silently write one of them and
 * drop the rest, with no error anywhere.
 */
export type PointIndex = ReadonlyMap<string, ReadonlyMap<string, readonly PointTarget[]>>;

/** One row destined for `telemetry.point_values`. */
export type PointValueRow = {
  readonly time: Date;
  readonly assetId: string;
  readonly pointKey: string;
  readonly value: number;
  readonly unit: string | null;
};

/**
 * Why samples were dropped, so a silent `catch {}` never has to stand in for an
 * explanation (ADR 0016 §Context, "Failure handling is currently absent").
 */
export type SampleCounters = {
  /** Samples the adapter flagged `good: false`. */
  badQuality: number;
  /** `value` was `NaN` or infinite. */
  nonFinite: number;
  /** No binding matched the sample's `deviceKey`. */
  unknownDevice: number;
  /** The device matched but no active `asset_points` row maps that `source_data_key`. */
  unmappedSourceKey: number;
  /** `deviceKey` omitted while the endpoint serves more than one device. */
  ambiguousDevice: number;
  /** `at` was present but not a usable `Date`; receive time was substituted. */
  invalidTimestamp: number;
  /** Rows collapsed by the in-batch `(time, assetId, pointKey)` dedupe. */
  duplicateInBatch: number;
};

/** A zeroed counter set. Exported so a caller can accumulate across batches. */
export function emptyCounters(): SampleCounters {
  return {
    badQuality: 0,
    nonFinite: 0,
    unknownDevice: 0,
    unmappedSourceKey: 0,
    ambiguousDevice: 0,
    invalidTimestamp: 0,
    duplicateInBatch: 0,
  };
}

/**
 * Separator for composite in-memory keys.
 *
 * `\u0000` written as an escape, never as a literal byte. A literal NUL makes
 * the file binary to git — no reviewable diff, which is how it got here
 * unnoticed in the first place — while the escape keeps the source text plain
 * ASCII. NUL is the right *value* because it cannot occur in a UUID, an ISO
 * timestamp or a point key, so the key is unambiguous in a way a space or a
 * colon would not be.
 */
const KEY_SEPARATOR = "\u0000";

export type ResolveResult = {
  readonly rows: readonly PointValueRow[];
  readonly counters: SampleCounters;
};

/**
 * Turns raw samples into the rows to write. Pure — no clock, no database.
 *
 * `receivedAt` is passed in rather than read from `Date.now()` so a test can
 * pin it. `soleDeviceKey` is the endpoint's only binding when it has exactly
 * one, which is the case in which `SourceSample.deviceKey` may be omitted; pass
 * `undefined` when the endpoint serves several devices, and a sample without a
 * `deviceKey` is then counted and dropped rather than guessed at.
 */
export function resolveSamples(
  samples: readonly SourceSample[],
  index: PointIndex,
  receivedAt: Date,
  soleDeviceKey?: string,
): ResolveResult {
  const counters = emptyCounters();
  // Dedupe key → row. Postgres rejects an `ON CONFLICT DO UPDATE` statement
  // that would touch the same row twice ("cannot affect row a second time"), so
  // a batch carrying two samples for one `(time, asset, point)` would fail the
  // whole INSERT. `index.js` never hit this because it issues one statement per
  // row. Last value wins, matching what the sequential upserts would have left
  // behind.
  const deduped = new Map<string, PointValueRow>();

  for (const sample of samples) {
    if (sample.good === false) {
      counters.badQuality += 1;
      continue;
    }
    if (typeof sample.value !== "number" || !Number.isFinite(sample.value)) {
      counters.nonFinite += 1;
      continue;
    }

    const deviceKey = sample.deviceKey ?? soleDeviceKey;
    if (deviceKey === undefined) {
      counters.ambiguousDevice += 1;
      continue;
    }

    const bySourceKey = index.get(deviceKey);
    if (bySourceKey === undefined) {
      counters.unknownDevice += 1;
      continue;
    }

    const targets = bySourceKey.get(sample.sourceKey);
    if (targets === undefined || targets.length === 0) {
      counters.unmappedSourceKey += 1;
      continue;
    }

    let time = receivedAt;
    if (sample.at !== undefined) {
      // An adapter that fabricates a timestamp is worse than one that omits it,
      // but a malformed `Date` must not reach `toISOString()` — it throws, and
      // that would take down a whole batch of good readings.
      if (sample.at instanceof Date && Number.isFinite(sample.at.getTime())) {
        time = sample.at;
      } else {
        counters.invalidTimestamp += 1;
      }
    }

    for (const target of targets) {
      const key = [time.toISOString(), target.assetId, target.pointKey].join(KEY_SEPARATOR);
      if (deduped.has(key)) {
        counters.duplicateInBatch += 1;
      }
      deduped.set(key, {
        time,
        assetId: target.assetId,
        pointKey: target.pointKey,
        value: sample.value,
        unit: target.unit,
      });
    }
  }

  return { rows: [...deduped.values()], counters };
}

/** The slice of a `pg` client this module needs; a fake satisfies it in tests. */
export type QueryableClient = {
  query(text: string, values?: readonly unknown[]): Promise<unknown>;
};

/**
 * Rows per `INSERT` statement.
 *
 * Postgres caps a statement at 65535 bind parameters. At five parameters per
 * row the hard ceiling is 13107, so 1000 leaves a wide margin and keeps any
 * single statement small enough to stay off the slow-query log. A poll adapter
 * reading a few thousand registers is the case that makes this matter — the
 * MQTT pilot never exceeds a handful.
 */
const MAX_ROWS_PER_STATEMENT = 1000;

const NOTIFY_CHANNEL = "bms_telemetry";

const UPSERT_HEAD =
  "INSERT INTO telemetry.point_values (time, asset_id, point_key, value, unit) VALUES ";
const UPSERT_TAIL =
  " ON CONFLICT (time, asset_id, point_key) DO UPDATE SET value = EXCLUDED.value, unit = EXCLUDED.unit";

/** Builds one multi-row upsert. Exported so a test can read the SQL without a database. */
export function buildUpsert(rows: readonly PointValueRow[]): {
  text: string;
  values: unknown[];
} {
  const values: unknown[] = [];
  const tuples = rows.map((row, i) => {
    const base = i * 5;
    values.push(row.time, row.assetId, row.pointKey, row.value, row.unit);
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`;
  });
  return { text: UPSERT_HEAD + tuples.join(", ") + UPSERT_TAIL, values };
}

function toNotifyReading(row: PointValueRow): NotifyReading {
  return {
    time: row.time.toISOString(),
    assetId: row.assetId,
    pointKey: row.pointKey,
    value: row.value,
    unit: row.unit,
  };
}

export type WriteResult = {
  readonly rowsWritten: number;
  readonly notificationsSent: number;
};

/**
 * Writes resolved rows and notifies.
 *
 * **Notification is unconditional (ADR 0016 §6 commit 4).** It used to sit
 * behind a `notify` option defaulting to off, which was right only while the
 * ADR 0007 pilot entry point was also notifying — two notifying processes
 * deliver every PHE reading to live dashboards twice, because writes are
 * idempotent under `ON CONFLICT DO UPDATE` and notifications are not. With one
 * ingest process there is nothing to double, and the option had become the
 * *dangerous* direction: it was the only way to run ingest writing rows while
 * every dashboard went dead, with no error and no alarm. It is deleted rather
 * than defaulted to `true` so that state is unreachable.
 *
 * The upsert runs inside a transaction and the notifications are sent **after**
 * `COMMIT`, exactly as the pilot did it — a listener must never be told about a
 * reading that then rolls back. `pg_notify` is not transactional in the same
 * direction either: payloads queued inside a transaction are delivered on
 * commit, so ordering here is about the failure path, not the happy one.
 */
export async function writeResolved(
  client: QueryableClient,
  rows: readonly PointValueRow[],
): Promise<WriteResult> {
  if (rows.length === 0) {
    return { rowsWritten: 0, notificationsSent: 0 };
  }

  await client.query("BEGIN");
  try {
    for (let i = 0; i < rows.length; i += MAX_ROWS_PER_STATEMENT) {
      const batch = rows.slice(i, i + MAX_ROWS_PER_STATEMENT);
      const { text, values } = buildUpsert(batch);
      await client.query(text, values);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }

  // Notify the deduped set — the rows actually written. Notifying the raw
  // sample list would announce readings the upsert collapsed.
  let notificationsSent = 0;
  for (const chunk of chunkReadings(rows.map(toNotifyReading))) {
    await client.query("SELECT pg_notify($1, $2)", [
      NOTIFY_CHANNEL,
      JSON.stringify({ readings: chunk }),
    ]);
    notificationsSent += 1;
  }
  return { rowsWritten: rows.length, notificationsSent };
}

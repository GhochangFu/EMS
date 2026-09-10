import type { QualityPolicy } from "@bms/shared/ingest";

import { chunkReadings, type NotifyReading } from "./chunk.js";
import type { ReceivedSample } from "./received-sample.js";

/**
 * The host's write path (ADR 0016 §2).
 *
 * Adapters emit `SourceSample[]` and nothing else. Everything below — resolving
 * `source_data_key` to `(assetId, pointKey, unit)`, stamping the receive time
 * and keeping the device's own beside it (ADR 0061), the
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

/**
 * One destination a `source_data_key` writes to.
 *
 * The five metadata fields are ADR 0056 decision 1's resolved values —
 * `coalesce(asset_points.<c>, template_points.<c>)`, computed in
 * `BINDING_QUERY`. **`null` is not "unset", it is a stated rule**: multiplier
 * `1`, offset `0`, no range test, `discard_bad`. That is what every point did
 * before `F2.7`, so a target carrying five nulls behaves exactly as it did.
 */
export type PointTarget = {
  readonly assetId: string;
  readonly pointKey: string;
  readonly unit: string | null;
  /** `value × multiplier + offset`; both `null` means the value is stored as it is. */
  readonly scaleMultiplier: number | null;
  readonly scaleOffset: number | null;
  /** Inclusive plausibility band on the **scaled** value. Either bound alone is valid. */
  readonly engMin: number | null;
  readonly engMax: number | null;
  /** What to do with a sample the protocol marks bad. `null` is `discard_bad`. */
  readonly qualityPolicy: QualityPolicy | null;
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
  /**
   * The host's **receive** time, always (ADR 0061 decision 2). It is the first
   * component of the primary key, the `ON CONFLICT` target and the in-batch
   * dedupe key, so a device's clock steering it made three things wrong at
   * once.
   */
  readonly time: Date;
  readonly assetId: string;
  readonly pointKey: string;
  readonly value: number;
  readonly unit: string | null;
  /**
   * What the device said its own time was, stored **unclamped** — hours ahead
   * or behind, exactly as reported (ADR 0061 decision 3).
   *
   * `null` means "no trustworthy device time" and decision 4's three cases are
   * indistinguishable here by design: no `at` at all, an `at` this host could
   * not read, and (in the table, not in this type) every row written before
   * migration `0069`. **Required, never optional**: an optional field at this
   * seam is invisible to `tsc` and to every fake-based suite, so a builder that
   * forgot to fill it would compile and pass.
   */
  readonly deviceTime: Date | null;
};

/**
 * Why samples were dropped, so a silent `catch {}` never has to stand in for an
 * explanation (ADR 0016 §Context, "Failure handling is currently absent").
 */
export type SampleCounters = {
  /** Samples the adapter flagged `good: false`, refused by the target's quality policy. */
  badQuality: number;
  /** `value` was `NaN` or infinite. */
  nonFinite: number;
  /** No binding matched the sample's `deviceKey`. */
  unknownDevice: number;
  /** The device matched but no active `asset_points` row maps that `source_data_key`. */
  unmappedSourceKey: number;
  /** `deviceKey` omitted while the endpoint serves more than one device. */
  ambiguousDevice: number;
  /**
   * The scaled value fell outside the point's inclusive engineering band
   * (ADR 0056 decision 4). An instrument plausibility band, **not** an operating
   * limit — decision 5 keeps "in safe range" with the threshold rules, and an
   * out-of-range sample leaves a counter rather than a row.
   */
  outOfRange: number;
  /**
   * The device sent a timestamp this host could not read — `at` was present and
   * was not a usable `Date`.
   *
   * It no longer means "receive time was substituted", because since ADR 0061
   * decision 2 receive time is what every row gets anyway. Decision 5 keeps the
   * counter: what it records is that the device tried to tell this host the
   * time and failed, which is worth knowing once the value no longer steers
   * `time`. The row is still written, so this is not a drop.
   */
  invalidTimestamp: number;
  /** Rows collapsed by the in-batch `(receivedAt, assetId, pointKey)` dedupe. */
  duplicateInBatch: number;
  /**
   * The **first** `(assetId, pointKey)` a collapse discarded in this batch, or
   * `null` if nothing collapsed (ADR 0061 decision 6).
   *
   * The reading itself cannot be kept — two samples for one point in one batch
   * share the stored primary key — so the *fact of losing it* is what gets
   * kept, attributed instead of folded anonymously into `duplicateInBatch`. The
   * first, not the last, so the datum is stable for a batch that collapses
   * several times. `F3.16` owns the operator-facing surface for it.
   */
  firstDuplicate: { readonly assetId: string; readonly pointKey: string } | null;
};

/** A zeroed counter set. Exported so a caller can accumulate across batches. */
export function emptyCounters(): SampleCounters {
  return {
    badQuality: 0,
    nonFinite: 0,
    unknownDevice: 0,
    unmappedSourceKey: 0,
    ambiguousDevice: 0,
    outOfRange: 0,
    invalidTimestamp: 0,
    duplicateInBatch: 0,
    firstDuplicate: null,
  };
}

/**
 * How many writes this batch refused, and why the other three fields are not in
 * the sum.
 *
 * `invalidTimestamp` and `duplicateInBatch` are **not** drops: a sample with an
 * unusable `at` is still written, at receive time like every other row, and a
 * collapsed duplicate is one row written rather than one lost. Adding either to
 * this total would make `main.ts` log "samples discarded" for a batch that
 * discarded nothing. `firstDuplicate` is not a count at all — it is
 * `duplicateInBatch`'s attribution (ADR 0061 decision 6) and cannot reach a sum
 * even by accident, because it is not a number.
 *
 * Lives here, next to the counters, because `main.ts` summed the buckets by hand
 * and a new bucket was therefore invisible to the log that exists to explain it
 * — `outOfRange` would have been the second counter added and the second one
 * forgotten. A caller cannot forget a field of a function it does not write.
 *
 * The unit is a refused **write**, not a refused sample: the checks run per
 * target, so a fan-out sample refused for two of its three targets counts twice
 * and writes once.
 */
export function droppedCount(counters: SampleCounters): number {
  return (
    counters.badQuality +
    counters.nonFinite +
    counters.unknownDevice +
    counters.unmappedSourceKey +
    counters.ambiguousDevice +
    counters.outOfRange
  );
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
 * Applies the target's scale rule to one raw value (ADR 0056 decision 4, step 2).
 *
 * With **both** fields `null` the sample's own value is returned, object-
 * identical. `value * 1 + 0` is not the identity: it turns `-0` into `0`, and
 * `-0` is what a signed power meter reports for an idle circuit. One field set
 * is enough to make the point a scaled one, and then the arithmetic runs as
 * ADR 0056 decision 1 writes it, with the unset half at its documented default.
 */
function scaleValue(value: number, target: PointTarget): number {
  if (target.scaleMultiplier === null && target.scaleOffset === null) {
    return value;
  }
  return value * (target.scaleMultiplier ?? 1) + (target.scaleOffset ?? 0);
}

/**
 * Whether the scaled value sits inside the target's inclusive band.
 *
 * The two bounds are **independent**: migration `0063`'s CHECK constrains only
 * the both-non-null pair, so `eng_min` alone is a valid row and imposes a floor
 * with no ceiling.
 */
function isInEngineeringRange(value: number, target: PointTarget): boolean {
  if (target.engMin !== null && value < target.engMin) {
    return false;
  }
  return !(target.engMax !== null && value > target.engMax);
}

/**
 * Turns raw samples into the rows to write. Pure — no clock, no database.
 *
 * Each sample arrives with the instant this host received it
 * (`ReceivedSample`), so this function reads no clock at all: the drain loop
 * stamps a live batch once, and the disk buffer revives the `rx` it wrote at
 * spill (ADR 0016 Amendment 5). The receive time is a **required field on each
 * sample** rather than a batch argument with a per-sample override, because an
 * optional receive time at this seam is invisible to `tsc` and to every
 * fake-based suite — a path that forgot to set it would compile, pass, and
 * silently take the replay instant. `soleDeviceKey` is the endpoint's only
 * binding when it has exactly one, which is the case in which
 * `SourceSample.deviceKey` may be omitted; pass `undefined` when the endpoint
 * serves several devices, and a sample without a `deviceKey` is then counted
 * and dropped rather than guessed at.
 *
 * ## The two times (`F4.57` / ADR 0061)
 *
 * **`receivedAt` is what `time` gets, for every row, unconditionally**
 * (decision 2). What the device said goes to `deviceTime`, unclamped in either
 * direction (decision 3), or `null` when there is no trustworthy value for it
 * (decision 4). Nine RTUs measured on 2026-08-22 spanned 3 h 37 m of skew and
 * `time` is the primary key, the `ON CONFLICT` target and the dedupe key, so a
 * device's clock steering it made three things wrong at once — including a
 * future-dated row that every `time > now() - interval 'N'` window read as
 * fresh for half an hour.
 *
 * `receivedAt` is a **receive** time, not necessarily this instant: for a live
 * sample it is the batch's own instant, and for a replayed one it is the
 * arrival the disk buffer recorded (ADR 0061 Amendment 2 ruling 4), so a
 * re-replayed segment keeps writing the same primary key.
 *
 * Both are computed once per sample, before the target loop, so a sample
 * fanning out to three points counts `invalidTimestamp` once rather than three
 * times — the same reason the raw non-finite pre-check sits outside the loop.
 *
 * ## The point metadata (`F2.7` / ADR 0056 decision 4)
 *
 * Quality policy → scale → finite → range, **inside the target loop and in that
 * order**. All four are properties of the resolved point, not of the sample, so
 * they cannot be applied before the `source_data_key` names its targets: one
 * `sourceKey` can fan out to two assets whose templates scale differently, and
 * a pre-loop check would have to pick one of them.
 *
 * The order is a decision, not an implementation detail. A policy that stored a
 * bad-quality sample only for the range test to drop it would be
 * indistinguishable from `discard_bad` in the counters, and an overflow that the
 * range test refused first would be reported as an instrument out of its band
 * rather than as arithmetic that broke.
 *
 * Three consequences of moving the quality check inside the loop, all intended:
 * a `good: false` sample for an **unknown device** now counts `unknownDevice`
 * rather than `badQuality`; a counter counts a refused *write* rather than a
 * refused sample; and a `good: false` sample with a malformed `at` now also
 * counts `invalidTimestamp`, which used to be unreachable for it — harmless,
 * because `invalidTimestamp` is not a drop and `droppedCount` never sums it. The
 * raw `typeof value !== "number" || !isFinite` pre-check stays **outside** the
 * loop: an unscalable value is dropped once, not once per target — so a
 * bad-quality `NaN` counts `nonFinite`.
 */
export function resolveSamples(
  samples: readonly ReceivedSample[],
  index: PointIndex,
  soleDeviceKey?: string,
): ResolveResult {
  const counters = emptyCounters();
  // Dedupe key → row. Postgres rejects an `ON CONFLICT DO UPDATE` statement
  // that would touch the same row twice ("cannot affect row a second time"), so
  // a batch carrying two samples for one `(time, asset, point)` would fail the
  // whole INSERT. `index.js` never hit this because it issues one statement per
  // row. Last value wins, matching what the sequential upserts would have left
  // behind.
  //
  // **The key is the STORED key** — `(receivedAt, assetId, pointKey)`, ADR 0061
  // decision 6 — so this map's notion of uniqueness and Postgres's cannot
  // disagree. Keying on the device time instead is ruling 3's first form, and
  // it is not implementable: with `time` fixed at `receivedAt`, two samples
  // deduped on device time produce two rows whose stored keys are identical, so
  // either one statement raises "cannot affect row a second time" and rolls the
  // batch back, or the 1000-row statement boundary falls between them and the
  // second silently updates the first. It preserves nothing, order-dependently.
  const deduped = new Map<string, PointValueRow>();

  for (const { sample, receivedAt } of samples) {
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

    // ADR 0061 decisions 3-5. `time` is not computed here at all any more —
    // it is `receivedAt` below, always.
    let deviceTime: Date | null = null;
    if (sample.at !== undefined) {
      // An adapter that fabricates a timestamp is worse than one that omits it,
      // but a malformed `Date` must not reach `toISOString()` — `pg` serialises
      // a `Date` parameter that way, it throws on an Invalid Date, and that
      // would take down a whole batch of good readings. So an unreadable `at`
      // leaves `deviceTime` null (decision 4 case 3) and counts, exactly as an
      // absent one leaves it null (case 2). A reader cannot tell the two apart
      // from the column, which decision 4 accepts rather than repairs.
      if (sample.at instanceof Date && Number.isFinite(sample.at.getTime())) {
        deviceTime = sample.at;
      } else {
        counters.invalidTimestamp += 1;
      }
    }

    for (const target of targets) {
      // 1. Quality policy. A null policy is `discard_bad` — today's rule.
      if (sample.good === false && target.qualityPolicy !== "accept_bad") {
        counters.badQuality += 1;
        continue;
      }

      // 2. Scale.
      const value = scaleValue(sample.value, target);

      // 3. Finite. Scaling can overflow, so the test runs on what would be
      //    stored rather than on what arrived.
      if (!Number.isFinite(value)) {
        counters.nonFinite += 1;
        continue;
      }

      // 4. Range, on the scaled value.
      if (!isInEngineeringRange(value, target)) {
        counters.outOfRange += 1;
        continue;
      }

      const key = [receivedAt.toISOString(), target.assetId, target.pointKey].join(KEY_SEPARATOR);
      if (deduped.has(key)) {
        counters.duplicateInBatch += 1;
        // The first collapse, not the latest: a batch that collapses several
        // times still names one point, and it names the same one on every run.
        if (counters.firstDuplicate === null) {
          counters.firstDuplicate = { assetId: target.assetId, pointKey: target.pointKey };
        }
      }
      deduped.set(key, {
        time: receivedAt,
        assetId: target.assetId,
        pointKey: target.pointKey,
        value,
        unit: target.unit,
        deviceTime,
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
 * Postgres caps a statement at 65535 bind parameters. At **six** parameters per
 * row — `device_time` joined them at ADR 0061 decision 1 — the hard ceiling is
 * 65535 / 6 = 10922, so 1000 leaves a wide margin and keeps any single
 * statement small enough to stay off the slow-query log. A poll adapter reading
 * a few thousand registers is the case that makes this matter — the MQTT pilot
 * never exceeds a handful.
 *
 * The derivation is re-stated here rather than left at the five-parameter
 * figure it used to give, because a stale ceiling is the kind of comment a
 * later reader would divide a batch size by.
 */
const MAX_ROWS_PER_STATEMENT = 1000;

const NOTIFY_CHANNEL = "bms_telemetry";

const UPSERT_HEAD =
  "INSERT INTO telemetry.point_values (time, asset_id, point_key, value, unit, device_time) VALUES ";
/**
 * `device_time` is in the `SET` list, and that is ADR 0061 Amendment 1 item 1
 * rather than symmetry: a re-delivered reading refreshes `value` and `unit`,
 * and if it did not also refresh `device_time` the column would keep the first
 * delivery's stamp and stop describing its own row.
 */
const UPSERT_TAIL =
  " ON CONFLICT (time, asset_id, point_key) DO UPDATE SET value = EXCLUDED.value, unit = EXCLUDED.unit, device_time = EXCLUDED.device_time";

/** Builds one multi-row upsert. Exported so a test can read the SQL without a database. */
export function buildUpsert(rows: readonly PointValueRow[]): {
  text: string;
  values: unknown[];
} {
  const values: unknown[] = [];
  const tuples = rows.map((row, i) => {
    const base = i * 6;
    values.push(row.time, row.assetId, row.pointKey, row.value, row.unit, row.deviceTime);
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`;
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

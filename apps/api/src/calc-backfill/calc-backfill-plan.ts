import { inputKey } from "../calc/calc-batch";
import type { CalcInputAssemblyDeps } from "../calc/calc-input-assembly";
import type { CalcInputSample } from "../calc/calc-inputs";
import { parameterValueAt, type ParameterSeriesRow } from "../calc/calc-parameter-series";

/**
 * `F4.311` PR 5a (ADR 0109 decision 7) — the backfill's pure arithmetic: the
 * bucket grid, the chunking, and the as-of reads that let the live engine's
 * input assembly run unchanged against history.
 *
 * Nothing here reads a clock or a database. `calc-backfill.service.ts` reads
 * one chunk of samples, builds an {@link asOfIndex} over it, and hands
 * `assembleInputs` an {@link asOfInputs} fake per bucket — so a backfilled
 * value is classified (fresh / stale / missing) exactly as the sweep would
 * have classified it at that bucket's time.
 */

/**
 * Buckets per chunk: one `CalcWriteService` statement
 * (`MAX_ROWS_PER_STATEMENT`). The worst case (31 days at 10 s) is 267,840
 * buckets, so 536 chunks.
 */
export const BACKFILL_CHUNK_BUCKETS = 500;

/**
 * The most sample rows one chunk's input read may return (`F4.311` PR 5
 * review). `CalcBackfillReads.readSamples` returns at most one sample per
 * `(input pair, instant)` — the newest at or before it — so a chunk reads at
 * most `pairs × instants` rows, whatever the input's sampling rate or
 * `max_input_age_seconds`. {@link bucketsPerChunk} shrinks the chunk so that
 * product stays within this cap: 100,000 rows of `{ value, timeMs }` plus the
 * row objects `pg` builds is tens of MB of worker heap, not the millions of
 * rows a range read of 31 dense days could hold.
 */
export const BACKFILL_MAX_SAMPLE_ROWS = 100_000;

/**
 * Instants per chunk for a definition reading `pairs` input pairs: the full
 * {@link BACKFILL_CHUNK_BUCKETS} while `pairs × 500` fits the cap, fewer
 * beyond it, and never fewer than one. Past `BACKFILL_MAX_SAMPLE_ROWS` pairs a
 * single instant already exceeds the cap; the read refuses that by name
 * rather than load it.
 */
export function bucketsPerChunk(pairs: number): number {
  return Math.max(1, Math.min(BACKFILL_CHUNK_BUCKETS, Math.floor(BACKFILL_MAX_SAMPLE_ROWS / Math.max(1, pairs))));
}

/**
 * The scheduled grid over `[fromMs, toMs)`: every multiple of the interval —
 * the instants `bucketTimeMs` produces, so a backfilled row lands on the same
 * timestamps the sweep writes — from the first at or after `fromMs` to the
 * last strictly before `toMs`. Half-open, so a window of whole intervals
 * holds exactly `(toMs - fromMs) / intervalMs` buckets.
 */
export function bucketGrid(fromMs: number, toMs: number, intervalSeconds: number): number[] {
  const intervalMs = intervalSeconds * 1000;
  if (!(intervalMs > 0)) {
    throw new Error("calc backfill: a scheduled grid needs a positive interval");
  }
  const out: number[] = [];
  for (let t = Math.ceil(fromMs / intervalMs) * intervalMs; t < toMs; t += intervalMs) {
    out.push(t);
  }
  return out;
}

/** `items` in consecutive slices of at most `size`, in order. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/** The newest sample at or before an instant, per `inputKey`. */
export type AsOfIndex = {
  latestAtOrBefore(key: string, tMs: number): CalcInputSample | undefined;
};

/**
 * An as-of index over one chunk's samples, keyed by `inputKey(assetId,
 * pointKey)`. Each key keeps a cursor that only moves forward while the
 * queried instants rise — the walk asks bucket after bucket — so a chunk is
 * one pass over its samples (two pointers, O(n)). A query earlier than the
 * previous one for its key restarts that key's cursor, so the answer never
 * depends on the order of the questions.
 */
export function asOfIndex(samples: ReadonlyMap<string, readonly CalcInputSample[]>): AsOfIndex {
  const sorted = new Map<string, CalcInputSample[]>();
  for (const [key, list] of samples) {
    sorted.set(key, [...list].sort((a, b) => a.timeMs - b.timeMs));
  }
  const cursor = new Map<string, { index: number; lastT: number }>();
  return {
    latestAtOrBefore(key, tMs) {
      const list = sorted.get(key);
      if (list === undefined) {
        return undefined;
      }
      let state = cursor.get(key);
      if (state === undefined || tMs < state.lastT) {
        state = { index: -1, lastT: tMs };
      }
      while (state.index + 1 < list.length && (list[state.index + 1] as CalcInputSample).timeMs <= tMs) {
        state.index += 1;
      }
      state.lastT = tMs;
      cursor.set(key, state);
      return state.index >= 0 ? list[state.index] : undefined;
    },
  };
}

/**
 * The `inputs` dependency `assembleInputs` reads, answering "as of `tMs`"
 * from the index instead of "latest now" from the database. Both reads key
 * exactly as `CalcInputsService` does: `getLatestSamples` by point key,
 * `getLatestSamplesForPairs` by `inputKey`. A key with no sample at or before
 * `tMs` is absent — `missing_input`, as the live read would make it.
 */
export function asOfInputs(index: AsOfIndex, tMs: number): CalcInputAssemblyDeps["inputs"] {
  return {
    getLatestSamples: async (assetId, pointKeys) => {
      const out = new Map<string, CalcInputSample>();
      for (const pointKey of pointKeys) {
        const sample = index.latestAtOrBefore(inputKey(assetId, pointKey), tMs);
        if (sample !== undefined) out.set(pointKey, sample);
      }
      return out;
    },
    getLatestSamplesForPairs: async (pairs) => {
      const out = new Map<string, CalcInputSample>();
      for (const pair of pairs) {
        const key = inputKey(pair.assetId, pair.pointKey);
        const sample = index.latestAtOrBefore(key, tMs);
        if (sample !== undefined) out.set(key, sample);
      }
      return out;
    },
  };
}

/**
 * The fourth `evaluate()` map at `tMs`, keyed by `inputKey(assetId, key)` as
 * `resolveForAssets` keys it. A pair no row covers at `tMs` is absent, so the
 * assembly refuses `parameter_unset` exactly as the sweep would.
 */
export function parametersAt(
  series: ReadonlyMap<string, readonly ParameterSeriesRow[]>,
  tMs: number,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const [key, rows] of series) {
    const value = parameterValueAt(rows, tMs);
    if (value !== undefined) out.set(key, value);
  }
  return out;
}

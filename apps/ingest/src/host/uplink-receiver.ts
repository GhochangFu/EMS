import {
  type SourceSample,
  UPLINK_MAX_AGE_MS,
  UPLINK_MAX_FUTURE_MS,
  type UplinkBatch,
} from "@bms/shared/ingest";

import type { ReceivedSample } from "./received-sample.js";

/**
 * The uplink receiver's batch handling (`E7.2`, ADR 0123 decisions 4, 5 and 8,
 * plan T3.2).
 *
 * A batch from an authenticated gateway is screened here, then fed to the same
 * `resolveSamples` → `writeResolved` path the supervisor uses. Screening is
 * pure: no clock of its own, no database.
 *
 * **Three guards, in a fixed order, each counted and none refusing the batch**
 * — one bad sample must never block a gateway's queue for ever (decision 8),
 * so the batch still answers `200` with the counts:
 *
 * 1. `foreignDevice` — the `deviceKey` is not one of the calling gateway's
 *    RTUs (decision 5, the `F1.7` topic-binding rule on a new transport). The
 *    sample is dropped and never resolved, so a token cannot write another
 *    gateway's or the cloud's own RTUs. A box deployed before its RTUs are
 *    assigned has every sample counted here (ruling P10 (a): assign first).
 * 2. `futureRx` — `rx` more than `UPLINK_MAX_FUTURE_MS` (60 s) ahead of this
 *    host's clock. A row at a future `time` reads as fresh to every recency
 *    window until the clock catches up.
 * 3. `tooOld` — `rx` more than `UPLINK_MAX_AGE_MS` (6 d 12 h) behind it, which
 *    keeps a backlog out of compressed chunks (ADR 0123 F3).
 *
 * Both bounds are inclusive: a sample exactly at either passes.
 */

/** The three screening reasons. `unresolved` is `resolveSamples`'s, counted later. */
export type ScreenCounts = {
  foreignDevice: number;
  futureRx: number;
  tooOld: number;
};

export type ScreenResult = {
  /** Samples that passed, with `rx` as their receive time. */
  readonly samples: readonly ReceivedSample[];
  readonly rejected: ScreenCounts;
};

/**
 * Screens one batch against the calling gateway's device keys and `now`.
 *
 * `rx` becomes `receivedAt` **unchanged**: for an edge sample the receive time
 * is its arrival at the edge (ADR 0061 Amendment 4), and that is what keeps a
 * retried batch on the same primary key (decision 8). `at` is kept as the
 * device's claim and becomes `device_time`; an absent `at` stays absent.
 */
export function screenBatch(batch: UplinkBatch, deviceKeys: ReadonlySet<string>, now: Date): ScreenResult {
  const rejected: ScreenCounts = { foreignDevice: 0, futureRx: 0, tooOld: 0 };
  const samples: ReceivedSample[] = [];
  const nowMs = now.getTime();

  for (const wire of batch.samples) {
    if (!deviceKeys.has(wire.deviceKey)) {
      rejected.foreignDevice += 1;
      continue;
    }
    const receivedAt = new Date(wire.rx);
    const rxMs = receivedAt.getTime();
    if (rxMs - nowMs > UPLINK_MAX_FUTURE_MS) {
      rejected.futureRx += 1;
      continue;
    }
    if (nowMs - rxMs > UPLINK_MAX_AGE_MS) {
      rejected.tooOld += 1;
      continue;
    }
    const sample: SourceSample = {
      sourceKey: wire.sourceKey,
      value: wire.value,
      deviceKey: wire.deviceKey,
      ...(wire.at === undefined ? {} : { at: new Date(wire.at) }),
      ...(wire.good === undefined ? {} : { good: wire.good }),
    };
    samples.push({ sample, receivedAt });
  }

  return { samples, rejected };
}

import type { SourceSample } from "@bms/shared/ingest";

/**
 * A sample and the instant this host received it — the **host-internal**
 * shape ADR 0016 Amendment 5 names, and the one thing that crosses from the
 * supervisor to the normaliser.
 *
 * Why it exists as its own type rather than as a field on `SourceSample`:
 * `SourceSample` is the adapter contract, and `adapter-contract.spec.ts`
 * forbids an adapter fabricating a time. A receive time set by an adapter is
 * exactly that. So the receive time is attached *after* the contract — by the
 * drain loop for a live batch, and by the disk buffer for a replayed one, where
 * it is the `rx` the buffer wrote once at spill (ADR 0061 Amendment 2 ruling 4:
 * a buffered sample's receive time is its original arrival, not the replay
 * instant).
 *
 * **`receivedAt` is required, and the sample is wrapped rather than extended.**
 * A batch-level receive time with an optional per-sample override would let a
 * path that forgot to set it compile, pass every fake-based suite, and silently
 * take the replay instant — a fresh primary key on every replay, the
 * duplicate-row failure Amendment 4 decision 5 exists to rule out. A required
 * field on a distinct type makes `tsc` enumerate every construction site
 * instead. Wrapping (not `SourceSample & { receivedAt }`) keeps the two shapes
 * non-assignable in either direction, so a `SourceSample` cannot reach
 * `resolveSamples` without passing through one of the two sites that know when
 * it arrived.
 */
export type ReceivedSample = {
  readonly sample: SourceSample;
  /** The instant this host received `sample`; `telemetry.point_values.time` (ADR 0061 decision 2). */
  readonly receivedAt: Date;
};

/**
 * Stamps a live batch with one receive time — the drain loop's construction
 * site, and the only one for a sample that has not been to disk.
 *
 * One instant for the whole batch is ADR 0061 decision 2 as written ("the
 * batch's own `new Date()`"); decision 6's in-batch collapse is the accepted
 * consequence, measured at zero collisions on the live path.
 */
export function receivedTogether(
  samples: readonly SourceSample[],
  receivedAt: Date,
): readonly ReceivedSample[] {
  return samples.map((sample) => ({ sample, receivedAt }));
}

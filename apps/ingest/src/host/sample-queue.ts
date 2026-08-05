import type { SourceSample } from "@bms/shared/ingest";

/**
 * The host's bounded sample queue (ADR 0016 §5).
 *
 * A push adapter calls `emit` synchronously from its transport's message
 * handler, and the host must not block that call on a database round trip.
 * The queue is the seam: `emit` enqueues, a drain loop writes.
 *
 * **Bounded, drop-oldest, with a counter.** ADR 0016 Resolved decision 6
 * accepts that for the pilot and gates any poll adapter at a customer site
 * behind `F1.10` (backoff + 1 h disk buffering), where telemetry loss during a
 * database outage becomes bounded and recorded rather than silent. The counter
 * is what makes it recorded; the health endpoint reports it.
 *
 * Newest-wins is deliberate. When a database outage backs the queue up, the
 * readings an operator needs are the recent ones; discarding the oldest keeps
 * the dashboard honest about *now* rather than replaying an hour-old backlog
 * on recovery.
 */

export type SampleQueue = {
  /** Enqueues samples, dropping the oldest when full. */
  push(samples: readonly SourceSample[]): void;
  /** Removes and returns up to `max` samples, oldest first. */
  drain(max: number): SourceSample[];
  /** Samples currently held. */
  readonly depth: number;
  /** Total dropped since construction. Monotonic — it is a loss record, not a gauge. */
  readonly dropped: number;
  readonly capacity: number;
};

/** ADR 0016 §5: "In-memory sample queue — bounded, default 10 000 samples". */
export const DEFAULT_QUEUE_CAPACITY = 10_000;

/**
 * A fixed-capacity ring buffer.
 *
 * An array with `shift()` would be O(n) per drop, and dropping is exactly what
 * happens under the sustained pressure this queue exists to survive — so the
 * naive version degrades worst precisely when it matters most.
 */
export function createSampleQueue(capacity: number = DEFAULT_QUEUE_CAPACITY): SampleQueue {
  if (!Number.isInteger(capacity) || capacity <= 0) {
    throw new Error(`sample queue capacity must be a positive integer, got ${capacity}`);
  }
  const buffer = new Array<SourceSample | undefined>(capacity);
  let head = 0;
  let size = 0;
  let dropped = 0;

  return {
    capacity,

    push(samples) {
      for (const sample of samples) {
        if (size === capacity) {
          buffer[head] = undefined;
          head = (head + 1) % capacity;
          size -= 1;
          dropped += 1;
        }
        buffer[(head + size) % capacity] = sample;
        size += 1;
      }
    },

    drain(max) {
      const take = Math.min(max, size);
      const out: SourceSample[] = [];
      for (let i = 0; i < take; i += 1) {
        const sample = buffer[head];
        buffer[head] = undefined;
        head = (head + 1) % capacity;
        if (sample !== undefined) {
          out.push(sample);
        }
      }
      size -= take;
      return out;
    },

    get depth() {
      return size;
    },

    get dropped() {
      return dropped;
    },
  };
}

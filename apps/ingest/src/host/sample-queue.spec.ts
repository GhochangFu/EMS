import type { SourceSample } from "@bms/shared/ingest";

import { createSampleQueue, DEFAULT_QUEUE_CAPACITY } from "./sample-queue.js";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function sample(n: number): SourceSample {
  return { sourceKey: "flow", value: n, deviceKey: "RTU-1" };
}

/** The bounded host queue, ADR 0016 §5. */
export function runSampleQueueTests(): void {
  assert(DEFAULT_QUEUE_CAPACITY === 10_000, "the ADR states a 10 000-sample default");

  // ---- FIFO ----------------------------------------------------------------

  {
    const queue = createSampleQueue(10);
    queue.push([sample(1), sample(2), sample(3)]);
    assert(queue.depth === 3, `depth should be 3, got ${queue.depth}`);
    const drained = queue.drain(10);
    assert(
      drained.map((s) => s.value).join(",") === "1,2,3",
      `samples must drain oldest-first, got ${drained.map((s) => s.value).join(",")}`,
    );
    assert(queue.depth === 0, "a full drain empties the queue");
    assert(queue.dropped === 0, "nothing was dropped");
  }

  // ---- partial drain -------------------------------------------------------

  {
    const queue = createSampleQueue(10);
    queue.push([sample(1), sample(2), sample(3), sample(4)]);
    const first = queue.drain(2);
    assert(first.map((s) => s.value).join(",") === "1,2", "a partial drain takes the oldest");
    assert(queue.depth === 2, "the rest stays queued");
    const second = queue.drain(10);
    assert(second.map((s) => s.value).join(",") === "3,4", "the remainder drains in order");
  }

  {
    const queue = createSampleQueue(5);
    assert(queue.drain(100).length === 0, "draining an empty queue yields nothing, not an error");
  }

  // ---- drop-oldest at capacity --------------------------------------------

  {
    const queue = createSampleQueue(5);
    queue.push([1, 2, 3, 4, 5, 6, 7].map(sample));
    assert(queue.depth === 5, `depth must stay at capacity, got ${queue.depth}`);
    assert(queue.dropped === 2, `two samples were dropped, got ${queue.dropped}`);
    // Newest-wins: under a database outage the readings an operator needs are
    // the recent ones, not an hour-old backlog replayed on recovery.
    const survivors = queue.drain(10).map((s) => s.value);
    assert(
      survivors.join(",") === "3,4,5,6,7",
      `the newest samples must survive, got ${survivors.join(",")}`,
    );
  }

  // ---- the ring wraps correctly across many cycles -------------------------

  {
    // A ring buffer that mis-handles wrap-around returns stale or `undefined`
    // entries, and only after the head has lapped the array — which a single
    // small test never reaches.
    const queue = createSampleQueue(4);
    let next = 0;
    for (let cycle = 0; cycle < 50; cycle += 1) {
      queue.push([sample(next), sample(next + 1), sample(next + 2)]);
      next += 3;
      const out = queue.drain(2);
      assert(out.length === 2, `cycle ${cycle}: expected 2 samples, got ${out.length}`);
      assert(
        out.every((s) => typeof s.value === "number" && Number.isFinite(s.value)),
        `cycle ${cycle}: the ring returned an undefined slot`,
      );
    }
  }

  {
    // Sustained overflow — the case the ring exists for. An array with shift()
    // would be O(n) per drop, degrading worst exactly under this pressure.
    const queue = createSampleQueue(100);
    for (let i = 0; i < 5_000; i += 1) {
      queue.push([sample(i)]);
    }
    assert(queue.depth === 100, `depth must stay bounded, got ${queue.depth}`);
    assert(queue.dropped === 4_900, `every overflow must be counted, got ${queue.dropped}`);
    const survivors = queue.drain(100).map((s) => s.value);
    assert(survivors[0] === 4_900 && survivors[99] === 4_999, "the newest 100 survive, in order");
  }

  // ---- the drop counter is a loss record, not a gauge ---------------------

  {
    const queue = createSampleQueue(2);
    queue.push([sample(1), sample(2), sample(3)]);
    assert(queue.dropped === 1, "one drop so far");
    queue.drain(10);
    assert(queue.dropped === 1, "draining must not reset the loss record");
    queue.push([sample(4), sample(5), sample(6)]);
    assert(queue.dropped === 2, "the counter accumulates across cycles");
  }

  // ---- capacity is validated ----------------------------------------------

  for (const bad of [0, -1, 1.5, Number.NaN]) {
    let threw = false;
    try {
      createSampleQueue(bad);
    } catch {
      threw = true;
    }
    assert(threw, `capacity ${bad} must be rejected — a zero-capacity queue drops everything silently`);
  }

  // ---- pushing nothing is a no-op -----------------------------------------

  {
    const queue = createSampleQueue(5);
    queue.push([]);
    assert(queue.depth === 0 && queue.dropped === 0, "an empty push changes nothing");
  }
}

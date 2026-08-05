import { backoffDelayMs, DEFAULT_BACKOFF } from "./backoff.js";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** Reconnect backoff, ADR 0016 §5's table. */
export function runBackoffTests(): void {
  const mid = (): number => 0.5;
  const low = (): number => 0;
  const high = (): number => 1;

  // ---- the stated policy ---------------------------------------------------

  assert(DEFAULT_BACKOFF.baseMs === 1_000, "base is 1 s");
  assert(DEFAULT_BACKOFF.factor === 2, "factor is 2");
  assert(DEFAULT_BACKOFF.capMs === 60_000, "cap is 60 s");
  assert(DEFAULT_BACKOFF.jitter === 0.2, "jitter is ±20%");

  // ---- exponential growth --------------------------------------------------

  // With the jitter source pinned mid-band the delay is the un-jittered value,
  // which is what makes the doubling assertable at all.
  const sequence = [0, 1, 2, 3, 4, 5].map((attempt) => backoffDelayMs(attempt, mid));
  assert(
    sequence.join(",") === "1000,2000,4000,8000,16000,32000",
    `wrong backoff sequence: ${sequence.join(",")}`,
  );

  // ---- the cap is a hard ceiling ------------------------------------------

  // Attempt 6 would be 64 s un-capped.
  assert(backoffDelayMs(6, mid) === 60_000, `attempt 6 must cap at 60 s, got ${backoffDelayMs(6, mid)}`);
  for (const attempt of [6, 7, 20, 100]) {
    for (const random of [low, mid, high]) {
      const delay = backoffDelayMs(attempt, random);
      assert(
        delay <= DEFAULT_BACKOFF.capMs,
        `attempt ${attempt} produced ${delay} ms, over the stated 60 s cap. A supervisor ` +
          `that waits longer than its documented ceiling is the surprising failure.`,
      );
    }
  }

  // A very large attempt must not overflow into NaN or Infinity — `2 ** 1024`
  // is Infinity in JS, and `Infinity * 0.2` is `NaN` under the wrong ordering.
  {
    const delay = backoffDelayMs(2000, mid);
    assert(
      Number.isFinite(delay) && delay === 60_000,
      `a huge attempt count must still cap cleanly, got ${delay}`,
    );
  }

  // ---- jitter spans the band and never goes negative ----------------------

  assert(backoffDelayMs(0, low) === 800, `−20% of 1 s is 800 ms, got ${backoffDelayMs(0, low)}`);
  assert(backoffDelayMs(0, high) === 1_200, `+20% of 1 s is 1200 ms, got ${backoffDelayMs(0, high)}`);

  {
    // The point of jitter: a broker outage must not turn every endpoint into a
    // synchronised thundering herd on recovery. Distinct random draws must give
    // distinct delays.
    const draws = [0.1, 0.3, 0.5, 0.7, 0.9].map((r) => backoffDelayMs(3, () => r));
    assert(new Set(draws).size === draws.length, `jitter collapsed to one value: ${draws.join(",")}`);
    for (const delay of draws) {
      assert(delay >= 6_400 && delay <= 9_600, `attempt 3 must stay within ±20% of 8 s, got ${delay}`);
    }
  }

  for (const attempt of [0, 1, 5, 10]) {
    for (const r of [0, 0.25, 0.5, 0.75, 1]) {
      const delay = backoffDelayMs(attempt, () => r);
      assert(delay >= 0, `a delay must never be negative, got ${delay}`);
      assert(Number.isInteger(delay), `a delay must be a whole number of ms, got ${delay}`);
    }
  }

  // ---- a negative attempt is treated as the first retry -------------------

  assert(backoffDelayMs(-1, mid) === 1_000, "a negative attempt must not shrink below the base");
}

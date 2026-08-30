import { type AggregateLevel, bucketSeconds } from "../telemetry/point-aggregates";

import { levelRollupSql } from "./health-rollup-sql";
import {
  HEALTH_TICK_MS,
  type HealthRollupLoopDeps,
  LEVEL_STEPS,
  TRAILING_WINDOW_MS,
  alignedWindow,
  runHealthRollupLoop,
  runHealthRollupSweep,
} from "./health-rollup.service";

/**
 * `E1.3` — the scheduled roll-up host (ADR 0050 decision 4/8, Amendment 1
 * decision 4).
 *
 * Assertions live here; `health-rollup.test.ts` is the vitest wrapper (ADR
 * 0014). Everything below is pure: the loop's `sleep`/`now` are injected and
 * the per-organization work is a callback, so nothing here waits out a real
 * 60-second tick or opens a database connection. The wiring that does both is
 * `HealthRollupService`, and it is deliberately a thin shell over these
 * functions for exactly that reason.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * The newest bucket is EXCLUDED, and this is ADR 0050 decision 5 becoming true.
 *
 * A partial bucket rolled up now would be overwritten by a larger count on the
 * next tick, so a score would drift within a bucket for no reason a reader
 * could see — and the chart beside it, which reads
 * `materialized_only = false` aggregates and IS exact to the partial bucket,
 * would disagree in a way that looks like arithmetic rather than like the
 * stated asymmetry.
 */
function testWindowExcludesTheIncompleteBucket(): void {
  const levels: AggregateLevel[] = ["1m", "5m", "1h", "1d"];
  for (const level of levels) {
    const widthMs = bucketSeconds(level) * 1000;

    // Mid-bucket: `to` must fall BACK to the boundary, never forward to `now`.
    const midBucket = new Date(3 * widthMs + Math.floor(widthMs / 2));
    const mid = alignedWindow(level, midBucket);
    assert(
      mid.to.getTime() === 3 * widthMs,
      `${level}: to must floor to the bucket boundary, got ${mid.to.toISOString()}`,
    );
    assert(
      mid.to.getTime() < midBucket.getTime(),
      `${level}: the bucket still filling at ${midBucket.toISOString()} must be excluded`,
    );

    // Exactly on a boundary: that bucket has not started filling, so the
    // boundary itself is the right exclusive end. Asserted because an
    // off-by-one here would silently drop a whole complete bucket every tick.
    const onBoundary = new Date(4 * widthMs);
    assert(
      alignedWindow(level, onBoundary).to.getTime() === 4 * widthMs,
      `${level}: an exact boundary must be its own end`,
    );

    assert(
      mid.to.getTime() - mid.from.getTime() === TRAILING_WINDOW_MS[level],
      `${level}: the window must span exactly its trailing constant`,
    );
    assert(mid.from.getTime() < mid.to.getTime(), `${level}: from must precede to`);
  }
}

/**
 * The ladder is finest-first and every step is adjacent.
 *
 * ADR 0050 decision 9 as extended by Amendment 1 decision 8: a coarse level
 * derived from a stale fine one propagates the error upward. `levelRollupSql`
 * refuses a non-adjacent pair, so this asserts the ORDER as well — the one way
 * to break it from the service side is to reverse or reorder this array, which
 * the SQL builder cannot detect because every individual pair would still be
 * legal.
 */
function testLadderIsFinestFirstAndAdjacent(): void {
  assert(LEVEL_STEPS.length === 3, `expected three steps, got ${LEVEL_STEPS.length}`);

  const expected = [
    ["1m", "5m"],
    ["5m", "1h"],
    ["1h", "1d"],
  ];
  assert(
    JSON.stringify(LEVEL_STEPS) === JSON.stringify(expected),
    `the ladder must run finest first: got ${JSON.stringify(LEVEL_STEPS)}`,
  );

  // Each step's `to` is the next step's `from`, so nothing is skipped. A ladder
  // of [1m→5m, 1h→1d] would satisfy the adjacency check inside the SQL builder
  // and silently never derive `1h`.
  for (let i = 1; i < LEVEL_STEPS.length; i += 1) {
    assert(
      LEVEL_STEPS[i][0] === LEVEL_STEPS[i - 1][1],
      `step ${i} must start where step ${i - 1} ended`,
    );
  }

  // And every pair is one the builder accepts — proved by calling it rather
  // than by restating its rule here, so the two cannot drift.
  for (const [from, to] of LEVEL_STEPS) {
    levelRollupSql(from, to, new Date(0), new Date(1));
  }
}

/**
 * Trailing windows never narrow going up the ladder.
 *
 * Not a style rule: a `1d` window shorter than the `1m` one would leave `1d`
 * unable to see buckets `1m` had just rewritten, so a repaired minute would
 * never reach the day above it and the two levels would disagree permanently.
 */
function testTrailingWindowsDoNotNarrow(): void {
  const levels: AggregateLevel[] = ["1m", "5m", "1h", "1d"];
  for (let i = 1; i < levels.length; i += 1) {
    assert(
      TRAILING_WINDOW_MS[levels[i]] >= TRAILING_WINDOW_MS[levels[i - 1]],
      `${levels[i]}'s trailing window must not be shorter than ${levels[i - 1]}'s`,
    );
  }
  // Amendment 1 decision 4 names this number. If it changes, the ADR changes.
  assert(
    TRAILING_WINDOW_MS["1m"] === 24 * 60 * 60 * 1000,
    "Amendment 1 decision 4 fixes the 1m trailing window at 24 hours",
  );
  assert(HEALTH_TICK_MS === 60_000, "Amendment 1 decision 4 fixes the tick at 60 s");
}

/**
 * **One organization's failure must not end the sweep.**
 *
 * This is the assertion worth the file. The sweep runs in a background loop
 * with no request to fail, so a single tenant holding a lock or carrying a
 * malformed rule would otherwise stop every organization AFTER it from being
 * scored — and the only symptom would be stale scores for an arbitrary subset
 * of tenants, with nothing in any log tying the subset to its cause.
 */
async function testOneOrganizationFailureDoesNotStopTheSweep(): Promise<void> {
  const swept: string[] = [];
  const warnings: string[] = [];

  await runHealthRollupSweep(
    {
      listOrganizationIds: async () => ["org-a", "org-b", "org-c"],
      rollUpOrganization: async (organizationId) => {
        swept.push(organizationId);
        if (organizationId === "org-b") {
          throw new Error("lock timeout");
        }
      },
      logger: { warn: (message: string) => warnings.push(message) } as never,
    },
    new Date(),
  );

  assert(
    swept.join(",") === "org-a,org-b,org-c",
    `every organization must be attempted in order, got ${swept.join(",")}`,
  );
  assert(warnings.length === 1, `expected one warning, got ${warnings.length}`);
  assert(
    warnings[0].includes("org-b") && warnings[0].includes("lock timeout"),
    `the warning must name the organization and the cause, got: ${warnings[0]}`,
  );
}

/**
 * Sweep, THEN sleep — and abort ends the loop rather than waiting out a tick.
 *
 * `setInterval` is the shape this rejects: it would let a slow sweep overlap
 * the next tick, doubling load exactly when the database is already the reason
 * the sweep was slow. The `await` ordering is what makes that impossible, so it
 * is asserted as an ordering and not merely as "both happened".
 */
async function testLoopSweepsThenSleepsAndStopsOnAbort(): Promise<void> {
  const events: string[] = [];
  const controller = new AbortController();
  let ticks = 0;

  const deps: HealthRollupLoopDeps = {
    listOrganizationIds: async () => ["org-a"],
    rollUpOrganization: async () => {
      events.push("sweep");
    },
    logger: { warn: () => undefined } as never,
    sleep: async () => {
      events.push("sleep");
      ticks += 1;
      if (ticks === 2) {
        controller.abort();
      }
    },
    now: () => 0,
    baseTickMs: 1,
  };

  await runHealthRollupLoop(deps, controller.signal);

  assert(
    events.join(",") === "sweep,sleep,sweep,sleep",
    `the loop must sweep before it sleeps, got ${events.join(",")}`,
  );
}

/** A sweep that throws outright is logged and the loop keeps its cadence. */
async function testLoopSurvivesASweepThatThrows(): Promise<void> {
  const warnings: string[] = [];
  const controller = new AbortController();

  await runHealthRollupLoop(
    {
      listOrganizationIds: async () => {
        throw new Error("fleet read failed");
      },
      rollUpOrganization: async () => undefined,
      logger: { warn: (message: string) => warnings.push(message) } as never,
      sleep: async () => {
        controller.abort();
      },
      now: () => 0,
      baseTickMs: 1,
    },
    controller.signal,
  );

  assert(warnings.length === 1, `expected one warning, got ${warnings.length}`);
  assert(
    warnings[0].includes("fleet read failed"),
    `the warning must carry the cause, got: ${warnings[0]}`,
  );
}

/** An already-aborted signal does no work at all. */
async function testAbortedSignalDoesNothing(): Promise<void> {
  let swept = 0;
  const controller = new AbortController();
  controller.abort();

  await runHealthRollupLoop(
    {
      listOrganizationIds: async () => ["org-a"],
      rollUpOrganization: async () => {
        swept += 1;
      },
      logger: { warn: () => undefined } as never,
      sleep: async () => undefined,
      now: () => 0,
      baseTickMs: 1,
    },
    controller.signal,
  );

  assert(swept === 0, "an aborted loop must not sweep");
}

export async function runHealthRollupTests(): Promise<void> {
  testWindowExcludesTheIncompleteBucket();
  testLadderIsFinestFirstAndAdjacent();
  testTrailingWindowsDoNotNarrow();
  await testOneOrganizationFailureDoesNotStopTheSweep();
  await testLoopSweepsThenSleepsAndStopsOnAbort();
  await testLoopSurvivesASweepThatThrows();
  await testAbortedSignalDoesNothing();
}

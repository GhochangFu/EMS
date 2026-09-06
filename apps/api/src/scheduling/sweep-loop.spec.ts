import { type SweepLoopDeps, runSweepLoop } from "./sweep-loop";

/**
 * `F3.10` U1 — the shared sweep loop every scheduled host in `apps/api` is a
 * wrapper over (ADR 0037 decision 7's shape).
 *
 * Assertions live here; `sweep-loop.test.ts` is the vitest wrapper (ADR 0014).
 * Everything below is pure: `sleep`/`now` are injected and the sweep is a
 * callback, so nothing waits out a real tick. The three hosts' own specs
 * (`calc-scheduler.spec.ts`, `health-rollup.spec.ts`, the alarm lifecycle's)
 * prove their wrappers still behave; this file proves the shape itself, once.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const LABEL = "unit label";

/** Deps that do nothing, with a warn sink; each case overrides what it exercises. */
function loopDeps(overrides: Partial<SweepLoopDeps>, warnings: string[] = []): SweepLoopDeps {
  return {
    sweep: async () => undefined,
    sleep: async () => undefined,
    now: () => 0,
    baseTickMs: 1,
    label: LABEL,
    logger: {
      warn: (message: string) => {
        warnings.push(message);
      },
    },
    ...overrides,
  };
}

/**
 * `setInterval` is the shape this rejects: it would let a slow sweep overlap
 * the next tick. The `await` ordering is what makes that impossible, so it is
 * asserted as an ordering and not merely as "both happened".
 */
async function testSweepsBeforeItSleeps(): Promise<void> {
  const events: string[] = [];
  const controller = new AbortController();
  let sleeps = 0;

  await runSweepLoop(
    loopDeps({
      sweep: async () => {
        events.push("sweep");
      },
      sleep: async () => {
        events.push("sleep");
        sleeps += 1;
        if (sleeps === 2) {
          controller.abort();
        }
      },
    }),
    controller.signal,
  );

  assert(
    events.join(",") === "sweep,sleep,sweep,sleep",
    `the loop must sweep before it sleeps, got ${events.join(",")}`,
  );
}

/** A sweep that throws is warned with its cause, and the loop keeps its cadence. */
async function testThrowingSweepIsWarnedAndTheLoopContinues(): Promise<void> {
  const warnings: string[] = [];
  const controller = new AbortController();
  let sweeps = 0;

  await runSweepLoop(
    loopDeps(
      {
        sweep: async () => {
          sweeps += 1;
          if (sweeps === 1) {
            throw new Error("fleet read failed");
          }
        },
        sleep: async () => {
          if (sweeps === 2) {
            controller.abort();
          }
        },
      },
      warnings,
    ),
    controller.signal,
  );

  assert(sweeps === 2, `the loop must sweep again after a throw, got ${sweeps} sweeps`);
  assert(warnings.length === 1, `expected one warning, got ${warnings.length}`);
  assert(
    warnings[0] === `${LABEL}: sweep failed: fleet read failed`,
    `the warning must be "<label>: sweep failed: <cause>", got: ${warnings[0]}`,
  );
}

/** An already-aborted signal does no work at all — neither a sweep nor a sleep. */
async function testAlreadyAbortedSignalCallsNothing(): Promise<void> {
  let sweeps = 0;
  let sleeps = 0;
  const controller = new AbortController();
  controller.abort();

  await runSweepLoop(
    loopDeps({
      sweep: async () => {
        sweeps += 1;
      },
      sleep: async () => {
        sleeps += 1;
      },
    }),
    controller.signal,
  );

  assert(sweeps === 0, `an aborted loop must not sweep, got ${sweeps}`);
  assert(sleeps === 0, `an aborted loop must not sleep, got ${sleeps}`);
}

/** The sweep receives the tick's own `now()` — it never reads the clock itself. */
async function testSweepReceivesTheTicksNow(): Promise<void> {
  const seen: number[] = [];
  const controller = new AbortController();
  let ticks = 0;
  let sleeps = 0;

  await runSweepLoop(
    loopDeps({
      now: () => {
        ticks += 1;
        return ticks * 1000;
      },
      sweep: async (nowMs) => {
        seen.push(nowMs);
      },
      sleep: async () => {
        sleeps += 1;
        if (sleeps === 2) {
          controller.abort();
        }
      },
    }),
    controller.signal,
  );

  assert(
    JSON.stringify(seen) === JSON.stringify([1000, 2000]),
    `the sweep must see each tick's now(), got ${JSON.stringify(seen)}`,
  );
}

/** An abort raised inside a sweep returns before the sleep, not after it. */
async function testAbortInsideASweepReturnsBeforeSleep(): Promise<void> {
  let sweeps = 0;
  let sleeps = 0;
  const controller = new AbortController();

  await runSweepLoop(
    loopDeps({
      sweep: async () => {
        sweeps += 1;
        controller.abort();
      },
      sleep: async () => {
        sleeps += 1;
      },
    }),
    controller.signal,
  );

  assert(sweeps === 1, `expected exactly one sweep, got ${sweeps}`);
  assert(sleeps === 0, `an abort raised inside a sweep must return before sleep, got ${sleeps} sleeps`);
}

export async function runSweepLoopTests(): Promise<void> {
  await testSweepsBeforeItSleeps();
  await testThrowingSweepIsWarnedAndTheLoopContinues();
  await testAlreadyAbortedSignalCallsNothing();
  await testSweepReceivesTheTicksNow();
  await testAbortInsideASweepReturnsBeforeSleep();
}

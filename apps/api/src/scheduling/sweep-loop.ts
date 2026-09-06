import type { Logger } from "@nestjs/common";

/**
 * The self-scheduling sweep loop every scheduled host in `apps/api` is a
 * wrapper over (ADR 0037 decision 7's shape): `for (;;)`, return if aborted,
 * sweep, return if aborted, **then** sleep.
 *
 * **Never `setInterval`.** A slow sweep must delay the next tick, not overlap
 * it — two sweeps racing over the same rows would double the load exactly when
 * the database is already the reason the sweep was slow. The `await` ordering
 * is what makes an overlap impossible, and the spec asserts it as an ordering.
 * `apps/ingest/src/host/supervisor.ts`'s `runPollLoop` is the precedent.
 *
 * A sweep that throws is warned and the loop keeps its cadence — the loop
 * never rejects on a sweep's account, so a host's `.catch` on it is a last
 * resort, not the error path. `sleep`/`now` are injected —
 * `TelemetryListenerDeps.sleep`'s reason applies unchanged: a test must not
 * wait out a real tick.
 *
 * ADR 0037's Consequences said two hosts should share the shape and the second
 * (`E1.3`) chose to copy it rather than extract it prematurely; `F3.10`'s third
 * host is where the copy became a helper. Users: `runSchedulerLoop`
 * (`calc/calc-scheduler.service.ts`, 10 s), `runHealthRollupLoop`
 * (`asset-health/health-rollup.service.ts`, 60 s) and the alarm lifecycle
 * sweep (`alarms/alarm-lifecycle.service.ts`, 30 s). Each keeps its own
 * exported signature and owns whatever state outlives one sweep in its closure.
 */
export interface SweepLoopDeps {
  /** One pass. Receives the tick's own `now()` — a sweep never reads the clock itself. */
  sweep(nowMs: number): Promise<void>;
  sleep(ms: number, signal: AbortSignal): Promise<void>;
  now(): number;
  baseTickMs: number;
  /** Prefixes the warn line: "calc scheduler", "health roll-up", "alarm lifecycle". */
  label: string;
  logger: Pick<Logger, "warn">;
}

/** `for (;;)`: return if aborted → sweep (a throw is warned, never fatal) → return if aborted → sleep. */
export async function runSweepLoop(deps: SweepLoopDeps, signal: AbortSignal): Promise<void> {
  for (;;) {
    if (signal.aborted) {
      return;
    }
    try {
      await deps.sweep(deps.now());
    } catch (err) {
      deps.logger.warn(`${deps.label}: sweep failed: ${(err as Error)?.message ?? err}`);
    }
    if (signal.aborted) {
      return;
    }
    await deps.sleep(deps.baseTickMs, signal);
  }
}

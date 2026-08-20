import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";

import { evaluate } from "@bms/shared";

import { sleep } from "../telemetry/sleep";
import type { CalcDefinition } from "./calc-definition";
import { CalcDefinitionsService } from "./calc-definitions.service";
import { classifyInput } from "./calc-inputs";
import { CalcInputsService } from "./calc-inputs.service";
import { bucketTimeMs, isDue } from "./calc-schedule";
import { CalcWriteService, type CalcWriteInput } from "./calc-write.service";
import { MetricsService } from "../observability/metrics.service";

/** Never one timer per formula (ADR 0037 decision 7) — one loop, this base
 * tick, each sweep checking every scheduled formula's own `isDue`. */
const BASE_TICK_MS = 10_000;

export interface CalcSchedulerDeps {
  definitions: Pick<CalcDefinitionsService, "getScheduledDefinitions">;
  inputs: Pick<CalcInputsService, "getLatestSamples">;
  writer: Pick<CalcWriteService, "writeValues">;
  metrics: Pick<MetricsService, "countCalcSkipped">;
  logger: Pick<Logger, "warn">;
}

async function evaluateOneScheduledFormula(
  deps: CalcSchedulerDeps,
  def: CalcDefinition,
  nowMs: number,
): Promise<CalcWriteInput | null> {
  const samples = await deps.inputs.getLatestSamples(def.assetId, def.refs);
  const inputs = new Map<string, number>();
  for (const ref of def.refs) {
    const sample = samples.get(ref);
    const classification = classifyInput(sample, nowMs, def.maxInputAgeSeconds);
    if (classification !== "fresh" || !sample) {
      deps.metrics.countCalcSkipped(classification === "missing" ? "missing_input" : "stale_input");
      return null;
    }
    inputs.set(ref, sample.value);
  }

  const result = evaluate(def.ast, inputs);
  if (!result.ok) {
    deps.metrics.countCalcSkipped("non_finite");
    return null;
  }

  return {
    assetId: def.assetId,
    pointKey: def.pointKey,
    // Tick time truncated to the formula's own interval (ADR 0037 decision
    // 8) — a late sweep still writes its bucket's timestamp, which is what
    // keeps a recompute a database no-op and the derived series regular.
    time: new Date(bucketTimeMs(nowMs, def.intervalSeconds ?? 0)),
    value: result.value,
  };
}

/**
 * One sweep: every active scheduled formula whose own interval has elapsed.
 * `lastRunMs` is owned by the caller and mutated in place — the loop's own
 * state, threaded through rather than captured, so this function stays
 * testable without a live timer. **No cap on formulas per tick** (decision
 * 7): silently computing a subset would be a worse failure than being slow.
 */
export async function runScheduledSweep(
  deps: CalcSchedulerDeps,
  lastRunMs: Map<string, number>,
  nowMs: number,
): Promise<void> {
  const scheduled = await deps.definitions.getScheduledDefinitions();
  const toWrite: CalcWriteInput[] = [];

  for (const def of scheduled) {
    const key = def.templatePointId;
    const intervalSeconds = def.intervalSeconds ?? 0;
    if (!isDue({ intervalSeconds, lastRunMs: lastRunMs.get(key) ?? null, nowMs })) {
      continue;
    }
    lastRunMs.set(key, nowMs);
    try {
      const outcome = await evaluateOneScheduledFormula(deps, def, nowMs);
      if (outcome) {
        toWrite.push(outcome);
      }
    } catch (err) {
      deps.logger.warn(
        `calc scheduler: formula "${def.pointKey}" on asset ${def.assetId} failed; continuing the ` +
          `sweep: ${(err as Error)?.message ?? err}`,
      );
    }
  }

  if (toWrite.length > 0) {
    await deps.writer.writeValues(toWrite);
  }
}

export interface CalcSchedulerLoopDeps extends CalcSchedulerDeps {
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  now: () => number;
  baseTickMs: number;
}

/**
 * The self-scheduling loop itself (ADR 0037 decision 7): `for (;;)`, do the
 * sweep, **then** sleep — never `setInterval`, which would let a slow sweep
 * overlap the next tick. `apps/ingest/src/host/supervisor.ts`'s
 * `runPollLoop` is the precedent this mirrors. `sleep`/`now` are injected —
 * `TelemetryListenerDeps.sleep`'s reason applies unchanged: tests must not
 * wait out real ticks.
 */
export async function runSchedulerLoop(
  deps: CalcSchedulerLoopDeps,
  lastRunMs: Map<string, number>,
  signal: AbortSignal,
): Promise<void> {
  for (;;) {
    if (signal.aborted) {
      return;
    }
    try {
      await runScheduledSweep(deps, lastRunMs, deps.now());
    } catch (err) {
      deps.logger.warn(`calc scheduler: sweep failed: ${(err as Error)?.message ?? err}`);
    }
    if (signal.aborted) {
      return;
    }
    await deps.sleep(deps.baseTickMs, signal);
  }
}

/**
 * Scheduled calc host (ADR 0037 decision 7) — a thin wiring shell over
 * {@link runSchedulerLoop}. Starts with the API process; `onModuleDestroy`
 * aborts the loop's `sleep` immediately rather than waiting out the current
 * tick, the same shutdown discipline `TelemetryNotifyService` uses.
 */
@Injectable()
export class CalcSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CalcSchedulerService.name);
  private readonly lastRunMs = new Map<string, number>();
  private readonly abortController = new AbortController();

  constructor(
    private readonly definitions: CalcDefinitionsService,
    private readonly inputs: CalcInputsService,
    private readonly writer: CalcWriteService,
    private readonly metrics: MetricsService,
  ) {}

  onModuleInit(): void {
    const deps: CalcSchedulerLoopDeps = {
      definitions: this.definitions,
      inputs: this.inputs,
      writer: this.writer,
      metrics: this.metrics,
      logger: this.logger,
      sleep,
      now: () => Date.now(),
      baseTickMs: BASE_TICK_MS,
    };
    void runSchedulerLoop(deps, this.lastRunMs, this.abortController.signal).catch((err: unknown) => {
      this.logger.warn(`calc scheduler loop exited: ${(err as Error)?.message ?? err}`);
    });
  }

  onModuleDestroy(): void {
    this.abortController.abort();
  }
}

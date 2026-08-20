import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";

import type { TelemetryReading } from "@bms/shared";
import { evaluate } from "@bms/shared";

import { TelemetryBroadcastHub } from "../telemetry/telemetry-broadcast.hub";
import { collapseLatest, filterToInputs } from "./calc-batch";
import type { CalcDefinition } from "./calc-definition";
import { CalcDefinitionsService } from "./calc-definitions.service";
import { classifyInput, newestTimeMs, type CalcInputSample } from "./calc-inputs";
import { CalcInputsService } from "./calc-inputs.service";
import { CalcWriteService, type CalcWriteInput } from "./calc-write.service";
import { MetricsService } from "../observability/metrics.service";

/** The narrow slice of each real dependency `evaluateStreamingBatch` needs —
 * `Pick`, not the concrete class, so a test can pass a plain fake without
 * satisfying the class's private fields (the same shape `buildListenerDeps`
 * uses in `telemetry-notify.service.ts`). `CalcStreamingService` below wires
 * real instances into it; nothing here is Nest-injectable on its own. */
export interface CalcStreamingDeps {
  definitions: Pick<CalcDefinitionsService, "getInputKeys" | "getDefinitionsForInput">;
  inputs: Pick<CalcInputsService, "getLatestSamples">;
  writer: Pick<CalcWriteService, "writeValues">;
  metrics: Pick<MetricsService, "countCalcSkipped">;
  logger: Pick<Logger, "warn">;
}

async function evaluateOneStreamingFormula(
  deps: CalcStreamingDeps,
  def: CalcDefinition,
  assetId: string,
  nowMs: number,
): Promise<CalcWriteInput | null> {
  const samples = await deps.inputs.getLatestSamples(assetId, def.refs);
  const inputs = new Map<string, number>();
  const used: CalcInputSample[] = [];
  for (const ref of def.refs) {
    const sample = samples.get(ref);
    const classification = classifyInput(sample, nowMs, def.maxInputAgeSeconds);
    if (classification !== "fresh" || !sample) {
      deps.metrics.countCalcSkipped(classification === "missing" ? "missing_input" : "stale_input");
      return null;
    }
    inputs.set(ref, sample.value);
    used.push(sample);
  }

  const result = evaluate(def.ast, inputs);
  if (!result.ok) {
    deps.metrics.countCalcSkipped("non_finite");
    return null;
  }

  return {
    assetId,
    pointKey: def.pointKey,
    value: result.value,
    // The newest time among the inputs actually used (ADR 0037 decision 8) —
    // never `Date.now()`, which would drift from what the formula computed.
    time: new Date(newestTimeMs(used) ?? nowMs),
  };
}

/**
 * Evaluates every active streaming formula that a readings batch might
 * trigger. Mirrors `AlarmEngineService.evaluateReadings` (ADR 0037
 * decision 6): collapse to the latest sample per `(assetId, pointKey)`,
 * filter to inputs before doing any other work (decision 11's re-entrancy
 * guard, not only an optimisation), then evaluate each matching formula in
 * its own `try`/`catch` so one formula's failure never costs the rest of
 * the batch (the `F4.36`/`F3.6` shape).
 */
export async function evaluateStreamingBatch(
  deps: CalcStreamingDeps,
  readings: TelemetryReading[],
): Promise<void> {
  const inputKeys = await deps.definitions.getInputKeys();
  const relevant = filterToInputs(collapseLatest(readings), inputKeys);
  if (relevant.length === 0) {
    return;
  }

  const nowMs = Date.now();
  const toWrite: CalcWriteInput[] = [];

  for (const reading of relevant) {
    const defs = await deps.definitions.getDefinitionsForInput(reading.assetId, reading.pointKey);
    for (const def of defs) {
      if (def.trigger !== "streaming") {
        continue;
      }
      try {
        const outcome = await evaluateOneStreamingFormula(deps, def, reading.assetId, nowMs);
        if (outcome) {
          toWrite.push(outcome);
        }
      } catch (err) {
        deps.logger.warn(
          `calc streaming: formula "${def.pointKey}" on asset ${reading.assetId} failed; continuing the ` +
            `batch: ${(err as Error)?.message ?? err}`,
        );
      }
    }
  }

  if (toWrite.length > 0) {
    await deps.writer.writeValues(toWrite);
  }
}

/**
 * Streaming calc host (ADR 0037 decision 6) — a thin wiring shell over
 * {@link evaluateStreamingBatch}. Subscribes `hub.on("readings")` in
 * `onModuleInit`, exactly like `AlarmEngineService`.
 */
@Injectable()
export class CalcStreamingService implements OnModuleInit {
  private readonly logger = new Logger(CalcStreamingService.name);

  constructor(
    private readonly hub: TelemetryBroadcastHub,
    private readonly definitions: CalcDefinitionsService,
    private readonly inputs: CalcInputsService,
    private readonly writer: CalcWriteService,
    private readonly metrics: MetricsService,
  ) {}

  onModuleInit(): void {
    this.hub.on("readings", (readings: TelemetryReading[]) => {
      const deps: CalcStreamingDeps = {
        definitions: this.definitions,
        inputs: this.inputs,
        writer: this.writer,
        metrics: this.metrics,
        logger: this.logger,
      };
      void evaluateStreamingBatch(deps, readings).catch((err: unknown) => {
        this.logger.warn(`calc streaming batch failed: ${(err as Error)?.message ?? err}`);
      });
    });
  }
}

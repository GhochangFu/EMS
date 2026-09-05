import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";

import type { TelemetryReading } from "@bms/shared";
import { evaluate } from "@bms/shared";

import { TelemetryBroadcastHub } from "../telemetry/telemetry-broadcast.hub";
import { collapseLatest, defKey, filterToInputs } from "./calc-batch";
import type { CalcDefinition } from "./calc-definition";
import { CalcDefinitionsService } from "./calc-definitions.service";
import { classifyInput, newestTimeMs, type CalcInputSample } from "./calc-inputs";
import { CalcInputsService } from "./calc-inputs.service";
import { CalcStatusRegistry } from "./calc-status.registry";
import { CalcWriteService, type CalcWriteInput } from "./calc-write.service";
import { MetricsService, type CalcRuntimeSkipReason } from "../observability/metrics.service";

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
  /** `F2.9` Task 16 — design decision 9, layer 3: what the per-asset page reads. */
  status: Pick<CalcStatusRegistry, "record">;
  logger: Pick<Logger, "warn">;
}

/**
 * **The one place this host refuses a formula**, the twin of the scheduler's
 * own `refuse`. The count and the record are one event: written out beside
 * each `if`, the next refusal added here would have two chances to be counted
 * without being recorded, and a streaming point would then sit on a stale
 * outcome — or on `null` forever — while `bms_api_calc_skipped_total` moved.
 *
 * A streaming formula that is never recorded is the worse half of the same
 * defect: the page would show every streaming point as "never evaluated",
 * which is indistinguishable from an engine that is not running.
 *
 * `tests/adr-0055-calc-v2-invariants.test.ts` part (e) holds it as source
 * structure: `countCalcSkipped(` may not appear in this file outside here.
 *
 * `assetId` comes from the reading, not from `def` — the same id the write
 * carries — so the registry entry and the written row name one asset.
 */
function refuse(
  deps: CalcStreamingDeps,
  def: CalcDefinition,
  assetId: string,
  reason: CalcRuntimeSkipReason,
  nowMs: number,
): null {
  deps.metrics.countCalcSkipped(reason);
  deps.status.record(assetId, def.templatePointId, { outcome: "skipped", reason, atMs: nowMs });
  return null;
}

/** The other half of {@link refuse}: a formula that produced a value this batch. */
function noteWritten(deps: CalcStreamingDeps, def: CalcDefinition, assetId: string, nowMs: number): void {
  deps.status.record(assetId, def.templatePointId, { outcome: "written", reason: null, atMs: nowMs });
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
      return refuse(deps, def, assetId, classification === "missing" ? "missing_input" : "stale_input", nowMs);
    }
    inputs.set(ref, sample.value);
    used.push(sample);
  }

  const result = evaluate(def.ast, inputs);
  if (!result.ok) {
    return refuse(deps, def, assetId, "non_finite", nowMs);
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
 *
 * A formula with more than one ref (e.g. `{A}+{B}`) can be returned by
 * `getDefinitionsForInput` more than once in the same batch — once per
 * matching reading, if the batch happens to carry fresh readings for both
 * `A` and `B`. Every candidate `(assetId, def)` pair is collected into a map
 * first, keyed on `defKey`, so each formula instance is evaluated at most
 * once per batch regardless of how many of its refs the batch touched.
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

  const toEvaluate = new Map<string, { assetId: string; def: CalcDefinition }>();
  for (const reading of relevant) {
    const defs = await deps.definitions.getDefinitionsForInput(reading.assetId, reading.pointKey);
    for (const def of defs) {
      if (def.trigger !== "streaming") {
        continue;
      }
      toEvaluate.set(defKey(reading.assetId, def.templatePointId), { assetId: reading.assetId, def });
    }
  }

  for (const { assetId, def } of toEvaluate.values()) {
    try {
      const outcome = await evaluateOneStreamingFormula(deps, def, assetId, nowMs);
      if (outcome) {
        toWrite.push(outcome);
        noteWritten(deps, def, assetId, nowMs);
      }
    } catch (err) {
      deps.logger.warn(
        `calc streaming: formula "${def.pointKey}" on asset ${assetId} failed; continuing the ` +
          `batch: ${(err as Error)?.message ?? err}`,
      );
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
    private readonly status: CalcStatusRegistry,
  ) {}

  onModuleInit(): void {
    this.hub.on("readings", (readings: TelemetryReading[]) => {
      const deps: CalcStreamingDeps = {
        definitions: this.definitions,
        inputs: this.inputs,
        writer: this.writer,
        metrics: this.metrics,
        status: this.status,
        logger: this.logger,
      };
      void evaluateStreamingBatch(deps, readings).catch((err: unknown) => {
        this.logger.warn(`calc streaming batch failed: ${(err as Error)?.message ?? err}`);
      });
    });
  }
}

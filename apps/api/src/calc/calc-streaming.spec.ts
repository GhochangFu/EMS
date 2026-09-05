import { CALC_DIALECT, parseFormula, type TelemetryReading } from "@bms/shared";

import type { CalcDefinition } from "./calc-definition";
import type { CalcInputSample } from "./calc-inputs";
import type { CalcWriteInput } from "./calc-write.service";
import { evaluateStreamingBatch, type CalcStreamingDeps } from "./calc-streaming.service";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function reading(overrides: Partial<TelemetryReading>): TelemetryReading {
  return {
    time: "2026-08-20T12:00:00.000Z",
    assetId: "asset-1",
    pointKey: "P",
    value: 1,
    unit: null,
    ...overrides,
  };
}

function def(overrides: Partial<CalcDefinition> & { formula: string }): CalcDefinition {
  const parsed = parseFormula(overrides.formula);
  if (!parsed.ok) {
    throw new Error(`test formula "${overrides.formula}" failed to parse`);
  }
  return {
    templatePointId: "tp-1",
    assetId: "asset-1",
    pointKey: "DERIVED",
    ast: parsed.ast,
    refs: parsed.refs,
    trigger: "streaming",
    intervalSeconds: null,
    maxInputAgeSeconds: 300,
    // Always `v1` here: ADR 0055 decision 10 makes `v2` `scheduled`-only, so a
    // `v2` definition can never reach the streaming host.
    dialect: CALC_DIALECT,
    crossRefs: [],
    minCoverageRatio: null,
    ...overrides,
  };
}

interface Fakes {
  deps: CalcStreamingDeps;
  writes: CalcWriteInput[][];
  skips: string[];
  warnings: string[];
  getDefinitionsForInputCalls: { assetId: string; pointKey: string }[];
}

function buildFakes(
  inputKeys: Set<string>,
  definitionsByAssetPoint: Map<string, CalcDefinition[]>,
  samplesByAssetRef: Map<string, CalcInputSample | undefined>,
  options: { throwFor?: string } = {},
): Fakes {
  const writes: CalcWriteInput[][] = [];
  const skips: string[] = [];
  const warnings: string[] = [];
  const getDefinitionsForInputCalls: { assetId: string; pointKey: string }[] = [];

  const deps: CalcStreamingDeps = {
    definitions: {
      getInputKeys: async () => inputKeys,
      getDefinitionsForInput: async (assetId, pointKey) => {
        getDefinitionsForInputCalls.push({ assetId, pointKey });
        return definitionsByAssetPoint.get(`${assetId}:${pointKey}`) ?? [];
      },
    },
    inputs: {
      getLatestSamples: async (assetId, refs) => {
        if (options.throwFor && refs.includes(options.throwFor)) {
          throw new Error(`simulated failure reading ${options.throwFor}`);
        }
        const map = new Map<string, CalcInputSample>();
        for (const ref of refs) {
          const sample = samplesByAssetRef.get(`${assetId}:${ref}`);
          if (sample) {
            map.set(ref, sample);
          }
        }
        return map;
      },
    },
    writer: {
      writeValues: async (values) => {
        writes.push([...values]);
        return { written: values.length, assetPointsCreated: 0 };
      },
    },
    metrics: {
      countCalcSkipped: (reason) => {
        skips.push(reason);
      },
    },
    logger: {
      warn: (message: unknown) => {
        warnings.push(String(message));
      },
    },
  };

  return { deps, writes, skips, warnings, getDefinitionsForInputCalls };
}

export async function runCalcStreamingTests(): Promise<void> {
  // ---- a reading on a point that is nobody's input does zero definition work ---

  {
    const fakes = buildFakes(new Set(), new Map(), new Map());
    await evaluateStreamingBatch(fakes.deps, [reading({ assetId: "A", pointKey: "UNRELATED" })]);
    assert(
      fakes.getDefinitionsForInputCalls.length === 0,
      "a reading whose point key is nobody's input must never reach getDefinitionsForInput",
    );
    assert(fakes.writes.length === 0, "no write must be attempted");
  }

  // ---- asset isolation: a shared point key does not cross-trigger another asset -

  {
    const formulaB = def({ assetId: "B", pointKey: "DERIVED_B", formula: "{SHARED}" });
    const inputKeys = new Set(["A:SHARED", "B:SHARED"]);
    const definitionsByAssetPoint = new Map([["B:SHARED", [formulaB]]]);
    const now = Date.now();
    const samples = new Map([["B:SHARED", { value: 5, timeMs: now - 1000 }]]);
    const fakes = buildFakes(inputKeys, definitionsByAssetPoint, samples);

    await evaluateStreamingBatch(fakes.deps, [reading({ assetId: "A", pointKey: "SHARED" })]);
    assert(
      fakes.getDefinitionsForInputCalls.every((c) => c.assetId === "A"),
      "only asset A's reading must be looked up — asset B's formula must not fire off asset A's reading",
    );
    assert(fakes.writes.length === 0, "asset B's formula must not evaluate at all from asset A's reading");
  }

  // ---- a stale sibling input skips and counts stale_input ------------------------

  {
    const formula = def({ formula: "{TRIGGER} + {SIBLING}", maxInputAgeSeconds: 60 });
    const inputKeys = new Set(["asset-1:TRIGGER"]);
    const definitionsByAssetPoint = new Map([["asset-1:TRIGGER", [formula]]]);
    const now = Date.now();
    const samples = new Map([
      ["asset-1:TRIGGER", { value: 1, timeMs: now - 1000 }],
      ["asset-1:SIBLING", { value: 2, timeMs: now - 120_000 }], // 120s > 60s budget
    ]);
    const fakes = buildFakes(inputKeys, definitionsByAssetPoint, samples);

    await evaluateStreamingBatch(fakes.deps, [reading({ assetId: "asset-1", pointKey: "TRIGGER" })]);
    assert(fakes.skips.includes("stale_input"), "a sibling input past its staleness budget must be counted");
    assert(fakes.writes.length === 0, "a formula with a stale input must never write");
  }

  // ---- one formula's failure does not stop the next formula in the same batch ---

  {
    const throwing = def({ pointKey: "THROWS", formula: "{BAD}", templatePointId: "tp-throws" });
    const healthy = def({ pointKey: "HEALTHY", formula: "{TRIGGER} * 2", templatePointId: "tp-healthy" });
    const inputKeys = new Set(["asset-1:TRIGGER"]);
    const definitionsByAssetPoint = new Map([["asset-1:TRIGGER", [throwing, healthy]]]);
    const now = Date.now();
    const samples = new Map([
      ["asset-1:TRIGGER", { value: 3, timeMs: now - 1000 }],
      ["asset-1:BAD", { value: 1, timeMs: now - 1000 }],
    ]);
    const fakes = buildFakes(inputKeys, definitionsByAssetPoint, samples, { throwFor: "BAD" });

    await evaluateStreamingBatch(fakes.deps, [reading({ assetId: "asset-1", pointKey: "TRIGGER", value: 3 })]);
    assert(fakes.warnings.length === 1, `expected exactly 1 warning for the throwing formula, got ${fakes.warnings.length}`);
    assert(fakes.writes.length === 1, "the healthy formula must still write despite the other one throwing");
    assert(
      fakes.writes[0]?.[0]?.pointKey === "HEALTHY",
      "the surviving write must be the healthy formula's, not the throwing one's",
    );
  }

  // ---- a formula with 2 refs, both fresh in the same batch, evaluates only once -

  {
    const formula = def({ formula: "{TRIGGER} + {SIBLING}" });
    const inputKeys = new Set(["asset-1:TRIGGER", "asset-1:SIBLING"]);
    const definitionsByAssetPoint = new Map([
      ["asset-1:TRIGGER", [formula]],
      ["asset-1:SIBLING", [formula]],
    ]);
    const now = Date.now();
    const samples = new Map([
      ["asset-1:TRIGGER", { value: 3, timeMs: now - 1000 }],
      ["asset-1:SIBLING", { value: 4, timeMs: now - 2000 }],
    ]);
    const fakes = buildFakes(inputKeys, definitionsByAssetPoint, samples);

    await evaluateStreamingBatch(fakes.deps, [
      reading({ assetId: "asset-1", pointKey: "TRIGGER", value: 3 }),
      reading({ assetId: "asset-1", pointKey: "SIBLING", value: 4 }),
    ]);
    // evaluateStreamingBatch always makes exactly one writeValues call
    // (win or lose the dedup) — the signal is how many values landed in
    // THAT call, not how many calls happened. Under the bug both readings
    // evaluate the same formula, producing 2 duplicate outcomes in the same
    // batched call, so `writes.length === 1` alone can't tell the two
    // outcomes apart.
    assert(fakes.writes.length === 1, `expected exactly one writeValues call, got ${fakes.writes.length}`);
    assert(
      fakes.writes[0]?.length === 1,
      `a batch carrying readings for both of a formula's refs must evaluate it exactly once, got ` +
        `${fakes.writes[0]?.length} value(s) in the batched write — 2 means it was double-evaluated`,
    );
    assert(
      fakes.writes[0]?.[0]?.value === 7,
      `expected the single write to reflect the formula's own result (7), got ${fakes.writes[0]?.[0]?.value}`,
    );
  }

  // ---- output time is the newest input time, never Date.now() -------------------

  {
    const formula = def({ formula: "{TRIGGER} + {SIBLING}" });
    const inputKeys = new Set(["asset-1:TRIGGER"]);
    const definitionsByAssetPoint = new Map([["asset-1:TRIGGER", [formula]]]);
    const now = Date.now();
    const triggerTimeMs = now - 5000;
    const siblingTimeMs = now - 9000; // older — must not win
    const samples = new Map([
      ["asset-1:TRIGGER", { value: 1, timeMs: triggerTimeMs }],
      ["asset-1:SIBLING", { value: 2, timeMs: siblingTimeMs }],
    ]);
    const fakes = buildFakes(inputKeys, definitionsByAssetPoint, samples);

    await evaluateStreamingBatch(fakes.deps, [reading({ assetId: "asset-1", pointKey: "TRIGGER" })]);
    const written = fakes.writes[0]?.[0];
    assert(written !== undefined, "the formula must write");
    assert(
      written?.time.getTime() === triggerTimeMs,
      `expected the written time to equal the newer input's time (${triggerTimeMs}), got ${written?.time.getTime()}`,
    );
  }
}

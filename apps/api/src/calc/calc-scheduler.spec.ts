import { parseFormula } from "@bms/shared";

import type { CalcDefinition } from "./calc-definition";
import type { CalcInputSample } from "./calc-inputs";
import type { CalcWriteInput } from "./calc-write.service";
import { runSchedulerLoop, runScheduledSweep, type CalcSchedulerDeps, type CalcSchedulerLoopDeps } from "./calc-scheduler.service";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
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
    trigger: "scheduled",
    intervalSeconds: 60,
    maxInputAgeSeconds: 999_999,
    ...overrides,
  };
}

function buildSweepDeps(
  scheduled: CalcDefinition[],
  samplesByAssetRef: Map<string, CalcInputSample>,
  options: { throwFor?: string } = {},
): { deps: CalcSchedulerDeps; writes: CalcWriteInput[][]; skips: string[]; warnings: string[] } {
  const writes: CalcWriteInput[][] = [];
  const skips: string[] = [];
  const warnings: string[] = [];
  const deps: CalcSchedulerDeps = {
    definitions: { getScheduledDefinitions: async () => scheduled },
    inputs: {
      getLatestSamples: async (assetId, refs) => {
        if (options.throwFor && refs.includes(options.throwFor)) {
          throw new Error(`simulated failure reading ${options.throwFor}`);
        }
        const map = new Map<string, CalcInputSample>();
        for (const ref of refs) {
          const sample = samplesByAssetRef.get(`${assetId}:${ref}`);
          if (sample) map.set(ref, sample);
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
    metrics: { countCalcSkipped: (reason) => skips.push(reason) },
    logger: { warn: (m: unknown) => warnings.push(String(m)) },
  };
  return { deps, writes, skips, warnings };
}

async function runSweepTests(): Promise<void> {
  // ---- a formula whose interval has not elapsed is skipped ---------------------

  {
    const formula = def({ formula: "{A}", intervalSeconds: 60 });
    const samples = new Map([["asset-1:A", { value: 1, timeMs: 0 }]]);
    const { deps, writes } = buildSweepDeps([formula], samples);
    const lastRunMs = new Map([[formula.templatePointId, 5000]]);
    await runScheduledSweep(deps, lastRunMs, 5000 + 59_000);
    assert(writes.length === 0, "a formula 59s into a 60s interval must not fire yet");
  }

  // ---- one formula's failure does not stop the sweep ----------------------------

  {
    const throwing = def({ pointKey: "THROWS", formula: "{BAD}", templatePointId: "tp-throw" });
    const healthy = def({ pointKey: "HEALTHY", formula: "{A} * 2", templatePointId: "tp-healthy" });
    const samples = new Map([
      ["asset-1:A", { value: 4, timeMs: 0 }],
      ["asset-1:BAD", { value: 1, timeMs: 0 }],
    ]);
    const { deps, writes, warnings } = buildSweepDeps([throwing, healthy], samples, { throwFor: "BAD" });
    await runScheduledSweep(deps, new Map(), 0);
    assert(warnings.length === 1, `expected 1 warning, got ${warnings.length}`);
    assert(writes.length === 1 && writes[0]?.[0]?.pointKey === "HEALTHY", "the healthy formula must still write");
  }
}

function buildLoopDeps(
  scheduled: CalcDefinition[],
  samplesByAssetRef: Map<string, CalcInputSample>,
  order: string[],
  tickMs: number,
): { deps: CalcSchedulerLoopDeps; nowRef: { value: number }; writes: CalcWriteInput[][]; sleepCallCount: () => number } {
  const writes: CalcWriteInput[][] = [];
  const nowRef = { value: 0 };
  let sleepCalls = 0;
  const deps: CalcSchedulerLoopDeps = {
    definitions: {
      getScheduledDefinitions: async () => {
        order.push("sweep-start");
        await Promise.resolve();
        await Promise.resolve();
        order.push("sweep-end");
        return scheduled;
      },
    },
    inputs: {
      getLatestSamples: async (assetId, refs) => {
        const map = new Map<string, CalcInputSample>();
        for (const ref of refs) {
          const sample = samplesByAssetRef.get(`${assetId}:${ref}`);
          if (sample) map.set(ref, sample);
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
    metrics: { countCalcSkipped: () => undefined },
    logger: { warn: () => undefined },
    sleep: async (ms) => {
      sleepCalls += 1;
      order.push("sleep");
      nowRef.value += ms;
    },
    now: () => nowRef.value,
    baseTickMs: tickMs,
  };
  return { deps, nowRef, writes, sleepCallCount: () => sleepCalls };
}

async function runLoopTests(): Promise<void> {
  // ---- non-overlap: sleep only ever starts after the prior sweep resolves -------

  {
    const order: string[] = [];
    const formula = def({ formula: "{A}", intervalSeconds: 999_999 });
    const samples = new Map([["asset-1:A", { value: 1, timeMs: 0 }]]);
    const { deps } = buildLoopDeps([formula], samples, order, 10_000);
    const controller = new AbortController();
    let sweepCount = 0;
    const originalGet = deps.definitions.getScheduledDefinitions;
    deps.definitions.getScheduledDefinitions = async () => {
      const result = await originalGet();
      sweepCount += 1;
      if (sweepCount >= 3) {
        controller.abort();
      }
      return result;
    };

    await runSchedulerLoop(deps, new Map(), controller.signal);

    assert(order.length > 0, "the loop must have run at least one sweep");
    for (let i = 0; i < order.length; i += 1) {
      if (order[i] === "sleep") {
        assert(
          order[i - 1] === "sweep-end",
          `sleep at index ${i} must be immediately preceded by sweep-end — got the sequence ${order.join(",")}`,
        );
      }
      if (order[i] === "sweep-start" && i > 0) {
        assert(
          order[i - 1] === "sleep" || i === 0,
          `sweep-start at index ${i} must be preceded by a completed sleep, not another in-flight sweep — ` +
            `got the sequence ${order.join(",")}`,
        );
      }
    }
  }

  // ---- a 30s-interval formula fires at t=0 and again only at t=30000, not --------
  // ---- at t=10000 or t=20000 ------------------------------------------------------

  {
    const order: string[] = [];
    const formula = def({ formula: "{A}", intervalSeconds: 30, templatePointId: "tp-30s" });
    const samples = new Map([["asset-1:A", { value: 7, timeMs: 0 }]]);
    const { deps, writes } = buildLoopDeps([formula], samples, order, 10_000);
    const controller = new AbortController();
    let sweepCount = 0;
    const originalGet = deps.definitions.getScheduledDefinitions;
    deps.definitions.getScheduledDefinitions = async () => {
      const result = await originalGet();
      sweepCount += 1;
      if (sweepCount >= 4) {
        controller.abort();
      }
      return result;
    };

    await runSchedulerLoop(deps, new Map(), controller.signal);

    assert(writes.length === 2, `expected exactly 2 writes across 4 ticks (t=0 and t=30000), got ${writes.length}`);
    assert(writes[0]?.[0]?.time.getTime() === 0, `first write must bucket to t=0, got ${writes[0]?.[0]?.time.getTime()}`);
    assert(
      writes[1]?.[0]?.time.getTime() === 30_000,
      `second write must bucket to t=30000 (3 ticks later), got ${writes[1]?.[0]?.time.getTime()}`,
    );
  }

  // ---- abort ends the loop promptly, without running a sweep already skipped ----

  {
    const order: string[] = [];
    const formula = def({ formula: "{A}", intervalSeconds: 999_999 });
    const samples = new Map([["asset-1:A", { value: 1, timeMs: 0 }]]);
    const { deps } = buildLoopDeps([formula], samples, order, 10_000);
    const controller = new AbortController();
    controller.abort();

    await runSchedulerLoop(deps, new Map(), controller.signal);
    assert(order.length === 0, "an already-aborted signal must stop the loop before any sweep runs");
  }
}

export async function runCalcSchedulerTests(): Promise<void> {
  await runSweepTests();
  await runLoopTests();
}

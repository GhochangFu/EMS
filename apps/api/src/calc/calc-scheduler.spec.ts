import { parseFormula } from "@bms/shared";

import { defKey } from "./calc-batch";
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
    const lastRunMs = new Map([[defKey(formula.assetId, formula.templatePointId), 0]]);
    await runScheduledSweep(deps, lastRunMs, 59_000);
    assert(writes.length === 0, "a formula 59s into a 60s interval must not fire yet");
  }

  // ---- a template instantiated on two assets fires for both, not just one ------
  // (the exact shape of the cross-asset starvation bug: two defs sharing one
  // templatePointId, keyed wrong, would let the first one processed mark the
  // second as "just ran" and starve it forever)

  {
    const onAssetOne = def({ assetId: "asset-1", templatePointId: "tp-shared", formula: "{A}" });
    const onAssetTwo = def({ assetId: "asset-2", templatePointId: "tp-shared", formula: "{A}" });
    const samples = new Map([
      ["asset-1:A", { value: 1, timeMs: 0 }],
      ["asset-2:A", { value: 2, timeMs: 0 }],
    ]);
    const { deps, writes } = buildSweepDeps([onAssetOne, onAssetTwo], samples);
    await runScheduledSweep(deps, new Map(), 0);
    // One writeValues call, batched with both assets' rows — writes.length
    // counts calls, not values.
    assert(writes.length === 1, `expected one batched writeValues call, got ${writes.length}`);
    const writtenAssetIds = (writes[0] ?? []).map((w) => w.assetId).sort();
    assert(
      writtenAssetIds.length === 2 && writtenAssetIds[0] === "asset-1" && writtenAssetIds[1] === "asset-2",
      `both assets sharing templatePointId "tp-shared" must fire on the same sweep, got ${JSON.stringify(writtenAssetIds)}`,
    );
  }

  // ---- a null or non-positive interval is a counted skip, never a NaN trap ------
  // (unreachable via CalcDefinitionsService today — toActiveDefinition guarantees
  // a positive interval for a scheduled definition — but runScheduledSweep's own
  // contract must not assume its caller: bucketTimeMs(nowMs, 0) is a division by
  // zero that would poison lastRunMs with NaN and stop the formula permanently)

  {
    const nullInterval = def({
      pointKey: "NULL_INTERVAL",
      templatePointId: "tp-null",
      formula: "{A}",
      intervalSeconds: null,
    });
    const zeroInterval = def({
      pointKey: "ZERO_INTERVAL",
      templatePointId: "tp-zero",
      formula: "{A}",
      intervalSeconds: 0,
    });
    const negativeInterval = def({
      pointKey: "NEGATIVE_INTERVAL",
      templatePointId: "tp-negative",
      formula: "{A}",
      intervalSeconds: -5,
    });
    const samples = new Map([["asset-1:A", { value: 1, timeMs: 0 }]]);
    const { deps, writes, skips } = buildSweepDeps([nullInterval, zeroInterval, negativeInterval], samples);
    await runScheduledSweep(deps, new Map(), 0);
    assert(writes.length === 0, `a definition with no usable interval must never write, got ${writes.length} writes`);
    assert(
      skips.filter((s) => s === "missing_interval").length === 3,
      `all 3 definitions (null, 0, negative) must be counted as missing_interval skips, got skips: ${JSON.stringify(skips)}`,
    );
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

  // ---- bucketed lastRunMs storage self-corrects sweep-cost drift ----------------
  // Each sweep costs 500ms (simulated inside getScheduledDefinitions) on top of a
  // 1000ms base tick, so real tick spacing is 1500ms, not 1000ms — against a
  // 4000ms interval, 9 ticks (nowMs 0, 1500, ..., 12000) land due at ticks
  // 0, 3, 6, 8 under bucketed storage (times 0, 4000, 8000, 12000): 4 writes.
  // Storing raw nowMs instead would re-arm from 4500 (not 4000) after tick 3
  // and from 9000 (not 8000) after tick 6, missing tick 8's fire — 3 writes,
  // not 4. This is the exact class of bug decision 8's idempotency and
  // decision 9's "no skip is silent" guarantees exist to rule out.

  {
    const SWEEP_COST_MS = 500;
    const BASE_TICK_MS = 1000;
    const formula = def({ formula: "{A}", intervalSeconds: 4, templatePointId: "tp-drift" });
    const samples = new Map([["asset-1:A", { value: 1, timeMs: 0 }]]);
    const writes: CalcWriteInput[][] = [];
    const nowRef = { value: 0 };
    let sweepCount = 0;
    const controller = new AbortController();

    const deps: CalcSchedulerLoopDeps = {
      definitions: {
        getScheduledDefinitions: async () => {
          nowRef.value += SWEEP_COST_MS;
          sweepCount += 1;
          if (sweepCount >= 9) {
            controller.abort();
          }
          return [formula];
        },
      },
      inputs: {
        getLatestSamples: async (assetId, refs) => {
          const map = new Map<string, CalcInputSample>();
          for (const ref of refs) {
            const sample = samples.get(`${assetId}:${ref}`);
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
        nowRef.value += ms;
      },
      now: () => nowRef.value,
      baseTickMs: BASE_TICK_MS,
    };

    await runSchedulerLoop(deps, new Map(), controller.signal);

    assert(
      writes.length === 4,
      "bucketed lastRunMs storage over a 500ms-cost/1s-base-tick schedule against a 4s interval must produce " +
        `4 writes across 9 ticks, got ${writes.length} — 3 would mean lastRunMs is storing raw wall-clock ` +
        "time instead of the bucketed tick time",
    );
    const times = writes.map((w) => w[0]?.time.getTime());
    assert(
      JSON.stringify(times) === JSON.stringify([0, 4000, 8000, 12000]),
      `expected writes at bucket times [0, 4000, 8000, 12000], got ${JSON.stringify(times)}`,
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

import { CALC_DIALECT, CALC_DIALECT_V2, crossRefKey, parseFormula } from "@bms/shared";

import { defKey, inputKey } from "./calc-batch";
import { toActiveDefinition, type CalcDefinition, type TemplatePointCalcRow } from "./calc-definition";
import type { Membership } from "./calc-graph";
import type { CalcInputSample } from "./calc-inputs";
import type { CalcWriteInput } from "./calc-write.service";
import { runSchedulerLoop, runScheduledSweep, type CalcSchedulerDeps, type CalcSchedulerLoopDeps } from "./calc-scheduler.service";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

type Pair = { assetId: string; pointKey: string };

const EMPTY_MEMBERSHIP: Membership = { qualified: new Map(), members: new Map() };

/** A `Membership` from tuples — the same shape `calc-graph.spec.ts` builds. */
function membershipOf(
  qualified: readonly (readonly [string, readonly (readonly [string, string | null])[]])[] = [],
  members: readonly (readonly [string, readonly (readonly [string, readonly Pair[]])[]])[] = [],
): Membership {
  return {
    qualified: new Map(qualified.map(([owner, codes]) => [owner, new Map(codes)])),
    members: new Map(members.map(([owner, keys]) => [owner, new Map(keys)])),
  };
}

/** The one aggregate a fixture formula carries, keyed by `crossRefKey` over
 * the parsed node — never hand-written (plan correction 49). */
function aggregateKeyOf(definition: CalcDefinition): string {
  const node = definition.crossRefs.find((ref) => ref.kind === "aggregate");
  if (!node) {
    throw new Error(`fixture ${definition.pointKey} must carry an aggregate`);
  }
  return crossRefKey(node);
}

function count(skips: readonly string[], reason: string): number {
  return skips.filter((s) => s === reason).length;
}

function def(overrides: Partial<CalcDefinition> & { formula: string }): CalcDefinition {
  const dialect = overrides.dialect ?? CALC_DIALECT;
  const parsed = parseFormula(overrides.formula, { dialect });
  if (!parsed.ok) {
    throw new Error(`test formula "${overrides.formula}" failed to parse under ${dialect}`);
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
    dialect,
    crossRefs: parsed.crossRefs,
    minCoverageRatio: null,
    ...overrides,
  };
}

type SweepOptions = {
  throwFor?: string;
  /** What `resolveMembership` returns; `EMPTY_MEMBERSHIP` when unset. */
  membership?: Membership;
  /** `resolveMembership` throws — the fleet read failed this sweep. */
  membershipThrows?: boolean;
};

type SweepHarness = {
  deps: CalcSchedulerDeps;
  writes: CalcWriteInput[][];
  skips: string[];
  warnings: string[];
  excluded: number[];
  membersMax: number[];
};

/** `samplesByAssetRef` is keyed by `inputKey(assetId, pointKey)`, so the local
 * read and the pairs read serve one map — a stored value is the same row
 * whichever way a formula reaches it. */
function buildSweepDeps(
  scheduled: CalcDefinition[],
  samplesByAssetRef: Map<string, CalcInputSample>,
  options: SweepOptions = {},
): SweepHarness {
  const writes: CalcWriteInput[][] = [];
  const skips: string[] = [];
  const warnings: string[] = [];
  const excluded: number[] = [];
  const membersMax: number[] = [];
  const deps: CalcSchedulerDeps = {
    definitions: { getScheduledDefinitions: async () => scheduled },
    inputs: {
      getLatestSamples: async (assetId, refs) => {
        if (options.throwFor && refs.includes(options.throwFor)) {
          throw new Error(`simulated failure reading ${options.throwFor}`);
        }
        const map = new Map<string, CalcInputSample>();
        for (const ref of refs) {
          const sample = samplesByAssetRef.get(inputKey(assetId, ref));
          if (sample) map.set(ref, sample);
        }
        return map;
      },
      getLatestSamplesForPairs: async (pairs) => {
        const map = new Map<string, CalcInputSample>();
        for (const pair of pairs) {
          const key = inputKey(pair.assetId, pair.pointKey);
          const sample = samplesByAssetRef.get(key);
          if (sample) map.set(key, sample);
        }
        return map;
      },
    },
    scope: {
      resolveMembership: async () => {
        if (options.membershipThrows) {
          throw new Error("simulated fleet read failure resolving membership");
        }
        return options.membership ?? EMPTY_MEMBERSHIP;
      },
    },
    writer: {
      writeValues: async (values) => {
        writes.push([...values]);
        return { written: values.length, assetPointsCreated: 0 };
      },
    },
    metrics: {
      countCalcSkipped: (reason) => skips.push(reason),
      countCalcAggregateExcluded: (n) => excluded.push(n),
      setCalcAggregateMembersMax: (n) => membersMax.push(n),
    },
    logger: { warn: (m: unknown) => warnings.push(String(m)) },
  };
  return { deps, writes, skips, warnings, excluded, membersMax };
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

  // ---- a v2 formula on a cycle is refused, counted, and does not stop the sweep --
  //
  // `F2.9` Task 13 turned `bms-calc-v2` on: the sweep resolves membership,
  // builds the dependency graph and refuses every formula that lies on a cycle
  // as `dependency_cycle` (ADR 0055 decision 8). The formula below is the
  // smallest cycle there is — a self-loop through a local ref — and the exact
  // shape the old dialect refusal existed to hold back: evaluated as a local
  // formula it would double its own stored value every tick, a wrong number,
  // silently. Handed to the sweep directly (the loader would already refuse it
  // as `self_reference`), so what this gates is the graph's own refusal.

  {
    const selfCompounding = def({
      pointKey: "SELF_COMPOUNDING",
      templatePointId: "tp-v2",
      formula: "{SELF_COMPOUNDING} * 2",
      dialect: CALC_DIALECT_V2,
      intervalSeconds: 60,
    });
    const v1Formula = def({
      pointKey: "V1_HEALTHY",
      templatePointId: "tp-v1",
      formula: "{A} * 2",
      intervalSeconds: 60,
    });
    const samples = new Map([
      ["asset-1:SELF_COMPOUNDING", { value: 5, timeMs: 0 }],
      ["asset-1:A", { value: 4, timeMs: 0 }],
    ]);
    const { deps, writes, skips } = buildSweepDeps([selfCompounding, v1Formula], samples);
    const lastRunMs = new Map<string, number>();

    await runScheduledSweep(deps, lastRunMs, 0);

    const written = (writes[0] ?? []).map((w) => w.pointKey);
    assert(
      !written.includes("SELF_COMPOUNDING"),
      `a formula on a cycle must not be evaluated — it would double its own stored value every ` +
        `tick, got writes ${JSON.stringify(written)}`,
    );
    assert(
      written.length === 1 && written[0] === "V1_HEALTHY",
      `the v1 formula in the same sweep must still write — the refusal is targeted, not a broken ` +
        `sweep. Got ${JSON.stringify(written)}`,
    );
    assert(
      count(skips, "dependency_cycle") === 1,
      `the refusal must increment bms_api_calc_skipped_total exactly once, got skips ` +
        `${JSON.stringify(skips)}`,
    );

    // The refusal sits after the due check, so it counts once per due window —
    // not once per 10s base tick, which would drown the counter for an hourly
    // formula and make the reason useless as a signal (plan correction 61).
    await runScheduledSweep(deps, lastRunMs, 10_000);
    assert(
      count(skips, "dependency_cycle") === 1,
      `a formula 10s into a 60s interval is not due and must not be counted again, got ` +
        `${JSON.stringify(skips)}`,
    );

    await runScheduledSweep(deps, lastRunMs, 60_000);
    assert(
      count(skips, "dependency_cycle") === 2,
      `the next due window must count a second refusal, got ${JSON.stringify(skips)}`,
    );
  }

  // ---- a self-referencing row never reaches a write (`F2.9` finding 34) --------
  // The row is built and resolved the way the engine builds one — through
  // `toActiveDefinition`, which is `CalcDefinitionsService.reload`'s only
  // producer of scheduled definitions — rather than handed to the sweep as a
  // ready-made `CalcDefinition`, because the refusal lives in the loader and a
  // hand-built definition would prove nothing about it.
  //
  // The row is labelled **`bms-calc-v1`** on purpose. That is the pair a
  // template migration can produce (a surviving dialect-only override plus a
  // new version's `v2` formula, neither re-validated). The sweep's graph would
  // refuse it too, as the one-edge cycle above — but a row the loader refuses
  // never reaches the sweep at all, and it is the loader's refusal this gates.

  {
    const mislabelled: TemplatePointCalcRow = {
      templatePointId: "tp-self",
      assetId: "asset-1",
      pointKey: "SELF",
      kind: "derived",
      formula: "{SELF} * 2",
      formulaDialect: CALC_DIALECT,
      calcTrigger: "scheduled",
      calcIntervalSeconds: 60,
      maxInputAgeSeconds: null,
      minCoverageRatio: null,
    };
    const resolved = toActiveDefinition(mislabelled);
    const samples = new Map([["asset-1:SELF", { value: 5, timeMs: 0 }]]);
    const { deps, writes } = buildSweepDeps(resolved.ok ? [resolved.def] : [], samples);
    await runScheduledSweep(deps, new Map(), 0);
    // Asserted before the reason, so that removing the refusal fails on the
    // damage rather than on the label: with the guard gone this definition is
    // active, its one input is fresh, and the sweep writes 10 — the first
    // doubling of the runaway.
    assert(
      writes.length === 0,
      `a self-referencing formula must produce no write — every tick would double its own ` +
        `stored value. Got ${JSON.stringify(writes)}`,
    );
    assert(
      resolved.ok === false && resolved.reason === "self_reference",
      `and the reason must be the counted self_reference skip, got ${
        resolved.ok ? "ok" : resolved.reason
      }`,
    );
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
      getLatestSamplesForPairs: async () => new Map(),
    },
    scope: { resolveMembership: async () => EMPTY_MEMBERSHIP },
    writer: {
      writeValues: async (values) => {
        writes.push([...values]);
        return { written: values.length, assetPointsCreated: 0 };
      },
    },
    metrics: {
      countCalcSkipped: () => undefined,
      countCalcAggregateExcluded: () => undefined,
      setCalcAggregateMembersMax: () => undefined,
    },
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
        getLatestSamplesForPairs: async () => new Map(),
      },
      scope: { resolveMembership: async () => EMPTY_MEMBERSHIP },
      writer: {
        writeValues: async (values) => {
          writes.push([...values]);
          return { written: values.length, assetPointsCreated: 0 };
        },
      },
      metrics: {
        countCalcSkipped: () => undefined,
        countCalcAggregateExcluded: () => undefined,
        setCalcAggregateMembersMax: () => undefined,
      },
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

/**
 * `bms-calc-v2` through the sweep (`F2.9` Task 13): the ordered evaluation,
 * the same-tick overlay, the four refusals the sweep decides at evaluation
 * time, and decision 11's coverage rule as the host applies it. Every
 * refusal is also checked to count **once per due window** — plan correction
 * 61: a refusal placed above `lastRunMs.set` re-counts on every 10s base tick
 * and the counter stops meaning what its name says.
 */
async function runV2SweepTests(): Promise<void> {
  // ---- (i) a qref chain: upstream first, and the downstream reads the overlay --
  // `B` is listed first, so an unordered sweep evaluates it before `d` has been
  // computed this tick. The stored `d` (100) differs from the computed one
  // (10), so a read from the wrong place is a wrong number, not a coincidence.

  {
    const downstream = def({
      assetId: "asset-b",
      templatePointId: "tp-b",
      pointKey: "B",
      formula: "{A_CODE.d} + 1",
      dialect: CALC_DIALECT_V2,
    });
    const upstream = def({ assetId: "asset-a", templatePointId: "tp-d", pointKey: "d", formula: "{m} * 2" });
    const samples = new Map([
      ["asset-a:m", { value: 5, timeMs: 0 }],
      ["asset-a:d", { value: 100, timeMs: 0 }],
    ]);
    const { deps, writes, skips } = buildSweepDeps([downstream, upstream], samples, {
      membership: membershipOf([["asset-b", [["A_CODE", "asset-a"]]]]),
    });
    await runScheduledSweep(deps, new Map(), 0);

    assert(writes.length === 1, `the sweep writes one batch, got ${writes.length}`);
    const batch = writes[0] ?? [];
    const upstreamWrites = batch.filter((w) => w.assetId === "asset-a" && w.pointKey === "d");
    assert(
      upstreamWrites.length === 1 && upstreamWrites[0]?.value === 10,
      `the upstream value must be written exactly once (5 * 2 = 10) — the overlay is a read-through ` +
        `of that write, never a replacement for it. Got ${JSON.stringify(batch)}`,
    );
    const downstreamWrite = batch.find((w) => w.assetId === "asset-b" && w.pointKey === "B");
    assert(
      downstreamWrite?.value === 11,
      `B must read the d computed this tick (10 + 1 = 11), not the stored 100 + 1 — either the ` +
        `order was not applied or the overlay was not consulted. Got ${String(downstreamWrite?.value)}`,
    );
    assert(skips.length === 0, `a resolved chain skips nothing, got ${JSON.stringify(skips)}`);
  }

  // ---- (ii) the overlay carries the bucketed write time, never nowMs ----------
  // (plan correction 60) `d` runs every 300s; `B` allows a 60s-old input. At
  // t=400s, `d`'s bucket is t=300s: a same-tick read of `d` is 100s old, exactly
  // as a next-tick read of the same stored row will be. `B` is `stale_input` —
  // decision 5 reporting a budget tighter than the input's own interval, not
  // the overlay hiding it for the one tick the member happened to recompute.

  {
    const upstream = def({
      assetId: "asset-a",
      templatePointId: "tp-d",
      pointKey: "d",
      formula: "{m} * 2",
      intervalSeconds: 300,
    });
    const downstream = def({
      assetId: "asset-b",
      templatePointId: "tp-b",
      pointKey: "B",
      formula: "{A_CODE.d} + 1",
      dialect: CALC_DIALECT_V2,
      intervalSeconds: 60,
      maxInputAgeSeconds: 60,
    });
    const nowMs = 400_000;
    const samples = new Map([["asset-a:m", { value: 5, timeMs: nowMs }]]);
    const { deps, writes, skips } = buildSweepDeps([upstream, downstream], samples, {
      membership: membershipOf([["asset-b", [["A_CODE", "asset-a"]]]]),
    });
    await runScheduledSweep(deps, new Map(), nowMs);

    const batch = writes.flat();
    assert(
      batch.some((w) => w.pointKey === "d" && w.value === 10 && w.time.getTime() === 300_000),
      `d is written at its own bucket (t=300000), got ${JSON.stringify(batch)}`,
    );
    assert(
      !batch.some((w) => w.pointKey === "B"),
      `B must not write: the overlay entry carries d's bucketed write time (300000), 100s old ` +
        `against B's 60s budget. A write here means the overlay claimed nowMs as its freshness, ` +
        `and a same-tick read and a next-tick read of the same value would disagree. Got ${JSON.stringify(batch)}`,
    );
    assert(
      count(skips, "stale_input") === 1,
      `B is refused as stale_input, once, got ${JSON.stringify(skips)}`,
    );
  }

  // ---- (iii) an aggregate member computed this tick is read from the overlay ---
  // Decision 11 rule 4 at the sweep: `asset-2`'s `d` is derived, listed after the
  // site sum that reads it, and its stored value (100) differs from this tick's.

  {
    const siteSum = def({
      templatePointId: "tp-sum",
      pointKey: "S",
      formula: "sum({d} @site)",
      dialect: CALC_DIALECT_V2,
    });
    const memberDerived = def({ assetId: "asset-2", templatePointId: "tp-d", pointKey: "d", formula: "{m} * 2" });
    const samples = new Map([
      ["asset-1:d", { value: 1, timeMs: 0 }],
      ["asset-2:d", { value: 100, timeMs: 0 }],
      ["asset-2:m", { value: 5, timeMs: 0 }],
    ]);
    const members: Pair[] = [
      { assetId: "asset-1", pointKey: "d" },
      { assetId: "asset-2", pointKey: "d" },
    ];
    const { deps, writes, excluded } = buildSweepDeps([siteSum, memberDerived], samples, {
      membership: membershipOf([], [["asset-1", [[aggregateKeyOf(siteSum), members]]]]),
    });
    await runScheduledSweep(deps, new Map(), 0);

    const batch = writes.flat();
    assert(
      batch.find((w) => w.pointKey === "S")?.value === 11,
      `the site sum reads the member computed this tick: 1 + (5 * 2) = 11, not 1 + 100. ` +
        `Got ${String(batch.find((w) => w.pointKey === "S")?.value)}`,
    );
    assert(
      batch.filter((w) => w.assetId === "asset-2" && w.pointKey === "d").length === 1,
      `the member's own write still lands exactly once, got ${JSON.stringify(batch)}`,
    );
    assert(excluded.length === 0, `both members were fresh, nothing excluded, got ${JSON.stringify(excluded)}`);
  }

  // ---- (iv) a cycle: members refused, downstream computes, v1 still writes -----

  {
    const a = def({ assetId: "asset-a", templatePointId: "tp-a", pointKey: "a", formula: "{B_CODE.b} + 1", dialect: CALC_DIALECT_V2 });
    const b = def({ assetId: "asset-b", templatePointId: "tp-b", pointKey: "b", formula: "{A_CODE.a} * 2", dialect: CALC_DIALECT_V2 });
    const downstream = def({ assetId: "asset-c", templatePointId: "tp-c", pointKey: "c", formula: "{A_CODE.a} - 1", dialect: CALC_DIALECT_V2 });
    const healthy = def({ assetId: "asset-a", templatePointId: "tp-h", pointKey: "H", formula: "{m} * 2" });
    const samples = new Map([
      ["asset-a:a", { value: 100, timeMs: 0 }],
      ["asset-b:b", { value: 200, timeMs: 0 }],
      ["asset-a:m", { value: 4, timeMs: 0 }],
    ]);
    const membership = membershipOf([
      ["asset-a", [["B_CODE", "asset-b"]]],
      ["asset-b", [["A_CODE", "asset-a"]]],
      ["asset-c", [["A_CODE", "asset-a"]]],
    ]);
    const { deps, writes, skips } = buildSweepDeps([a, b, downstream, healthy], samples, { membership });
    const lastRunMs = new Map<string, number>();
    await runScheduledSweep(deps, lastRunMs, 0);

    const batch = writes.flat();
    const writtenIds = batch.map((w) => inputKey(w.assetId, w.pointKey)).sort();
    assert(
      JSON.stringify(writtenIds) === JSON.stringify(["asset-a:H", "asset-c:c"]),
      `neither cycle member may write; the v1 formula and the downstream formula must. Got ${JSON.stringify(writtenIds)}`,
    );
    assert(
      batch.find((w) => w.pointKey === "H")?.value === 8,
      `the v1 formula in the same sweep still writes 4 * 2 = 8 — isolation survives, got ${JSON.stringify(batch)}`,
    );
    assert(
      batch.find((w) => w.pointKey === "c")?.value === 99,
      `a formula downstream of a cycle is not on it: it computes from the stored value ` +
        `(100 - 1 = 99; plan design decision 7, ruling Q6), got ${JSON.stringify(batch)}`,
    );
    assert(count(skips, "dependency_cycle") === 2, `both members counted, got ${JSON.stringify(skips)}`);

    await runScheduledSweep(deps, lastRunMs, 10_000);
    assert(
      count(skips, "dependency_cycle") === 2,
      `10s into a 60s interval the members are not due and must not be re-counted — a refusal ` +
        `above lastRunMs.set re-counts every base tick, got ${JSON.stringify(skips)}`,
    );
    await runScheduledSweep(deps, lastRunMs, 60_000);
    assert(count(skips, "dependency_cycle") === 4, `the next due window counts both again, got ${JSON.stringify(skips)}`);
  }

  // ---- (v) membership fails: every v2 refused, v1 still writes -------------------
  // The try/catch wraps the `resolveMembership` call alone, never the sweep.

  {
    const aggregate = def({ templatePointId: "tp-agg", pointKey: "SITE", formula: "sum({kw} @site)", dialect: CALC_DIALECT_V2 });
    const localV2 = def({ templatePointId: "tp-local", pointKey: "LOCAL", formula: "{m} + 1", dialect: CALC_DIALECT_V2 });
    const v1 = def({ templatePointId: "tp-v1", pointKey: "H", formula: "{m} * 2" });
    const samples = new Map([
      ["asset-1:m", { value: 4, timeMs: 0 }],
      ["asset-1:kw", { value: 1, timeMs: 0 }],
    ]);
    const { deps, writes, skips, warnings } = buildSweepDeps([aggregate, localV2, v1], samples, { membershipThrows: true });
    const lastRunMs = new Map<string, number>();
    await runScheduledSweep(deps, lastRunMs, 0);

    const batch = writes.flat();
    assert(
      batch.length === 1 && batch[0]?.pointKey === "H" && batch[0].value === 8,
      `the v1 formula must still write 4 * 2 = 8 when the fleet read fails — the guard wraps the ` +
        `membership call, not the sweep. Got ${JSON.stringify(batch)}`,
    );
    assert(
      count(skips, "membership_unresolved") === 2,
      `every v2 definition — the aggregate and the local-only one alike — is refused as ` +
        `membership_unresolved, got ${JSON.stringify(skips)}`,
    );
    assert(
      warnings.length === 1 && warnings[0]?.includes("membership"),
      `the failure is logged once per sweep, got ${JSON.stringify(warnings)}`,
    );

    await runScheduledSweep(deps, lastRunMs, 10_000);
    assert(count(skips, "membership_unresolved") === 2, `not due, not re-counted, got ${JSON.stringify(skips)}`);
    await runScheduledSweep(deps, lastRunMs, 60_000);
    assert(count(skips, "membership_unresolved") === 4, `the next due window counts again, got ${JSON.stringify(skips)}`);
  }

  // ---- (vi) the transition log: once into the cyclic set, once out ---------------
  // Design decision 9, layer 2. Asset ids and point keys; never formula text.

  {
    const a = def({ assetId: "asset-a", templatePointId: "tp-a", pointKey: "a", formula: "{B_CODE.b} + 1", dialect: CALC_DIALECT_V2 });
    const b = def({ assetId: "asset-b", templatePointId: "tp-b", pointKey: "b", formula: "{A_CODE.a} * 2", dialect: CALC_DIALECT_V2 });
    const samples = new Map([
      ["asset-a:a", { value: 1, timeMs: 0 }],
      ["asset-b:b", { value: 2, timeMs: 0 }],
    ]);
    const previousCyclic = new Set<string>();
    const lastRunMs = new Map<string, number>();

    const withCycle = buildSweepDeps([a, b], samples, {
      membership: membershipOf([
        ["asset-a", [["B_CODE", "asset-b"]]],
        ["asset-b", [["A_CODE", "asset-a"]]],
      ]),
    });
    await runScheduledSweep(withCycle.deps, lastRunMs, 0, previousCyclic);
    await runScheduledSweep(withCycle.deps, lastRunMs, 60_000, previousCyclic);
    await runScheduledSweep(withCycle.deps, lastRunMs, 120_000, previousCyclic);
    const entered = withCycle.warnings.filter((w) => w.includes("dependency cycle"));
    assert(
      entered.length === 1,
      `three ticks with the same cycle log the transition once, got ${JSON.stringify(withCycle.warnings)}`,
    );
    const line = entered[0] ?? "";
    assert(line.includes("asset-a:a") && line.includes("asset-b:b"), `the line names asset ids and point keys, got: ${line}`);
    assert(
      !line.includes("B_CODE.b") && !line.includes("A_CODE.a") && !line.includes("+ 1") && !line.includes("* 2"),
      `the line must never carry formula text, got: ${line}`,
    );

    // Membership breaks the cycle (B_CODE no longer resolves at a's location).
    const broken = buildSweepDeps([a, b], samples, {
      membership: membershipOf([
        ["asset-a", [["B_CODE", null]]],
        ["asset-b", [["A_CODE", "asset-a"]]],
      ]),
    });
    await runScheduledSweep(broken.deps, lastRunMs, 180_000, previousCyclic);
    await runScheduledSweep(broken.deps, lastRunMs, 240_000, previousCyclic);
    const left = broken.warnings.filter((w) => w.includes("dependency cycle"));
    assert(
      left.length === 1 && left[0]?.includes("asset-a:a") && left[0].includes("asset-b:b"),
      `the transition out is logged once, naming both former members, got ${JSON.stringify(broken.warnings)}`,
    );
  }

  // ---- (vii) a qualified code that resolves nowhere ---------------------------------

  {
    const ratio = def({ templatePointId: "tp-r", pointKey: "R", formula: "{NOPE.kw} * 2", dialect: CALC_DIALECT_V2 });
    const resolvedToNull = buildSweepDeps([ratio], new Map(), { membership: membershipOf([["asset-1", [["NOPE", null]]]]) });
    const lastRunMs = new Map<string, number>();
    await runScheduledSweep(resolvedToNull.deps, lastRunMs, 0);
    assert(
      resolvedToNull.writes.length === 0 && JSON.stringify(resolvedToNull.skips) === JSON.stringify(["unknown_asset_reference"]),
      `a code resolved to null is unknown_asset_reference and nothing else, got ${JSON.stringify(resolvedToNull.skips)}`,
    );
    await runScheduledSweep(resolvedToNull.deps, lastRunMs, 10_000);
    assert(count(resolvedToNull.skips, "unknown_asset_reference") === 1, `not due, not re-counted, got ${JSON.stringify(resolvedToNull.skips)}`);
    await runScheduledSweep(resolvedToNull.deps, lastRunMs, 60_000);
    assert(count(resolvedToNull.skips, "unknown_asset_reference") === 2, `counted again when due, got ${JSON.stringify(resolvedToNull.skips)}`);

    // An owner with no membership entry at all — the same reason, not a throw.
    const absent = buildSweepDeps([ratio], new Map(), { membership: EMPTY_MEMBERSHIP });
    await runScheduledSweep(absent.deps, new Map(), 0);
    assert(
      JSON.stringify(absent.skips) === JSON.stringify(["unknown_asset_reference"]),
      `an owner absent from the membership resolves nothing, got ${JSON.stringify(absent.skips)}`,
    );
  }

  // ---- (viii) an aggregate through the sweep: coverage, exclusion, the gauge -------

  {
    const nowMs = 1_020_000; // on a 60s bucket boundary, so the due arithmetic below is exact
    const total = def({
      templatePointId: "tp-t",
      pointKey: "TOTAL",
      formula: "sum({kw} @site)",
      dialect: CALC_DIALECT_V2,
      minCoverageRatio: 0.6,
      maxInputAgeSeconds: 60,
    });
    const members: Pair[] = [
      { assetId: "asset-1", pointKey: "kw" },
      { assetId: "asset-2", pointKey: "kw" },
      { assetId: "asset-3", pointKey: "kw" },
    ];
    const samples = new Map([
      ["asset-1:kw", { value: 10, timeMs: nowMs }],
      ["asset-2:kw", { value: 20, timeMs: nowMs }],
      ["asset-3:kw", { value: 30, timeMs: nowMs - 61_000 }],
    ]);
    const membership = membershipOf([], [["asset-1", [[aggregateKeyOf(total), members]]]]);

    const admitted = buildSweepDeps([total], samples, { membership });
    await runScheduledSweep(admitted.deps, new Map(), nowMs);
    assert(
      admitted.writes.flat()[0]?.value === 30,
      `3 declared, 2 fresh, ratio 0.6 → the sum over the fresh members (10 + 20 = 30), got ${JSON.stringify(admitted.writes)}`,
    );
    assert(JSON.stringify(admitted.excluded) === "[1]", `one excluded member is counted, got ${JSON.stringify(admitted.excluded)}`);
    assert(
      admitted.membersMax[admitted.membersMax.length - 1] === 3,
      `the gauge carries the largest declared member set, got ${JSON.stringify(admitted.membersMax)}`,
    );
    assert(admitted.skips.length === 0, `an admitted aggregate skips nothing, got ${JSON.stringify(admitted.skips)}`);

    const strict = buildSweepDeps([def({ ...total, formula: "sum({kw} @site)", minCoverageRatio: 0.7 })], samples, { membership });
    const lastRunMs = new Map<string, number>();
    await runScheduledSweep(strict.deps, lastRunMs, nowMs);
    assert(
      strict.writes.length === 0 && JSON.stringify(strict.skips) === JSON.stringify(["coverage_below_floor"]),
      `ratio 0.7 over 2/3 fresh is coverage_below_floor and no write, got ${JSON.stringify(strict.skips)}`,
    );
    assert(strict.excluded.length === 0, `a refused aggregate excludes nothing — it wrote nothing, got ${JSON.stringify(strict.excluded)}`);
    await runScheduledSweep(strict.deps, lastRunMs, nowMs + 10_000);
    assert(count(strict.skips, "coverage_below_floor") === 1, `not due, not re-counted, got ${JSON.stringify(strict.skips)}`);
    await runScheduledSweep(strict.deps, lastRunMs, nowMs + 60_000);
    assert(count(strict.skips, "coverage_below_floor") === 2, `counted again when due, got ${JSON.stringify(strict.skips)}`);

    const lonely = buildSweepDeps([total], samples, { membership: membershipOf([], [["asset-1", [[aggregateKeyOf(total), []]]]]) });
    await runScheduledSweep(lonely.deps, new Map(), nowMs);
    assert(
      lonely.writes.length === 0 && JSON.stringify(lonely.skips) === JSON.stringify(["no_members"]),
      `an aggregate with no declared member is no_members, got ${JSON.stringify(lonely.skips)}`,
    );
    assert(lonely.membersMax[lonely.membersMax.length - 1] === 0, `the gauge reads 0 with no members anywhere, got ${JSON.stringify(lonely.membersMax)}`);
  }
}

export async function runCalcSchedulerTests(): Promise<void> {
  await runSweepTests();
  await runV2SweepTests();
  await runLoopTests();
}

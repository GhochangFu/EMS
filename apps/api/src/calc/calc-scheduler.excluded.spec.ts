import { CALC_DIALECT_V2 } from "@bms/shared";

import type { CalcInputSample } from "./calc-inputs";
import { runScheduledSweep } from "./calc-scheduler.service";
import { aggregateKeyOf, buildSweepDeps, def, membershipOf, type Pair } from "./calc-scheduler.spec";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * `F2.9` PR 2 review fix 5 — **`bms_api_calc_aggregate_members_excluded_total`
 * moves only for a value that was written.**
 *
 * The counter's own help text says "members excluded from a value that was
 * still written". Counted inside `resolveCrossInputs`' per-reference loop it
 * moved the instant one aggregate resolved, and every later exit from the same
 * formula — a stale `{CODE.key}` after the aggregate, a second aggregate below
 * the floor, a `non_finite` result — happened after the counter had already
 * moved. An operator reading it then saw exclusions from values that never
 * existed, on a formula that in fact wrote nothing at all.
 *
 * **A sibling file, not more cases in `calc-scheduler.spec.ts`.** That file is
 * at 948 lines against AGENTS.md §4.5's 1000-line cap, and finding 19's ruling
 * is that the answer to a full file is a sibling, never a squeeze — the same
 * reason `calc-scheduler.status.spec.ts` exists. The harness is imported from
 * it, so both files drive the same fakes.
 *
 * The direction held here is the one nothing else covers. Case (viii) in
 * `calc-scheduler.spec.ts` asserts that a *refused aggregate* excludes nothing,
 * which is `resolveAggregate` returning `!ok` and never reaching the counter at
 * all. This is the other shape: the aggregate **succeeds**, and the formula is
 * refused afterwards.
 */
export async function runCalcSchedulerExcludedTests(): Promise<void> {
  // A 60s bucket boundary, so the due arithmetic is exact — the same convention
  // as case (viii) next door.
  const nowMs = 1_020_000;

  /**
   * `sum({kw} @site) + {TX_01.kwh}` — the aggregate resolves first and the
   * qualified reference is read after it, which is the whole point: the
   * exclusion is known before the refusal that discards it.
   *
   * Four members, two of them stale, against `minCoverageRatio` 0.5: coverage
   * is exactly 0.5, the floor is inclusive, so the aggregate produces a value
   * and reports `excluded: 2`.
   */
  function fixture(): {
    definition: ReturnType<typeof def>;
    members: Pair[];
    samples: Map<string, CalcInputSample>;
  } {
    const definition = def({
      assetId: "asset-1",
      templatePointId: "tp-mixed",
      pointKey: "MIXED",
      formula: "sum({kw} @site) + {TX_01.kwh}",
      dialect: CALC_DIALECT_V2,
      minCoverageRatio: 0.5,
      maxInputAgeSeconds: 60,
    });
    const members: Pair[] = [
      { assetId: "asset-1", pointKey: "kw" },
      { assetId: "asset-2", pointKey: "kw" },
      { assetId: "asset-3", pointKey: "kw" },
      { assetId: "asset-4", pointKey: "kw" },
    ];
    const samples = new Map<string, CalcInputSample>([
      ["asset-1:kw", { value: 10, timeMs: nowMs }],
      ["asset-2:kw", { value: 20, timeMs: nowMs }],
      // Stale — inside the read bound, past this formula's 60s staleness limit.
      ["asset-3:kw", { value: 30, timeMs: nowMs - 61_000 }],
      ["asset-4:kw", { value: 40, timeMs: nowMs - 61_000 }],
    ]);
    return { definition, members, samples };
  }

  // ---- the aggregate resolves, the qref after it is stale, nothing is written ----

  {
    const { definition, members, samples } = fixture();
    samples.set("asset-tx:kwh", { value: 5, timeMs: nowMs - 61_000 });
    const membership = membershipOf(
      [["asset-1", [["TX_01", "asset-tx"]]]],
      [["asset-1", [[aggregateKeyOf(definition), members]]]],
    );
    const harness = buildSweepDeps([definition], samples, { membership });

    await runScheduledSweep(harness.deps, new Map(), nowMs);

    assert(
      JSON.stringify(harness.skips) === JSON.stringify(["stale_input"]),
      `the qualified reference after the aggregate is stale, so the formula is refused, got ${JSON.stringify(harness.skips)}`,
    );
    assert(
      harness.writes.length === 0,
      `a refused formula writes nothing — the half the counter's help text depends on, got ${JSON.stringify(harness.writes)}`,
    );
    assert(
      JSON.stringify(harness.excluded) === "[]",
      "the aggregate resolved and excluded 2 members, but the formula then refused and wrote " +
        "nothing, so the excluded counter must not move: it reports members excluded from a " +
        `value that was still written. Got ${JSON.stringify(harness.excluded)}`,
    );
  }

  // ---- anti-vacuity: the same formula, the qref fresh, and the 2 are counted -----
  //
  // Without this the case above passes against a counter that was deleted, or
  // against a fixture whose aggregate never excluded anything in the first
  // place.

  {
    const { definition, members, samples } = fixture();
    samples.set("asset-tx:kwh", { value: 5, timeMs: nowMs });
    const membership = membershipOf(
      [["asset-1", [["TX_01", "asset-tx"]]]],
      [["asset-1", [[aggregateKeyOf(definition), members]]]],
    );
    const harness = buildSweepDeps([definition], samples, { membership });

    await runScheduledSweep(harness.deps, new Map(), nowMs);

    assert(
      harness.skips.length === 0,
      `with the qualified reference fresh the formula computes, got ${JSON.stringify(harness.skips)}`,
    );
    assert(
      harness.writes.flat()[0]?.value === 35,
      `sum over the two fresh members (10 + 20) plus the qref's 5 = 35, got ${JSON.stringify(harness.writes)}`,
    );
    assert(
      JSON.stringify(harness.excluded) === "[2]",
      "the same fixture writes a value, so the same two excluded members are counted exactly " +
        `once. Got ${JSON.stringify(harness.excluded)}`,
    );
  }
}

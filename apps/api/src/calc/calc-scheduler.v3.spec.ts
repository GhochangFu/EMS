import { CALC_DIALECT_V2, CALC_DIALECT_V3 } from "@bms/shared";

import { inputKey } from "./calc-batch";
import { runScheduledSweep } from "./calc-scheduler.service";
import { buildSweepDeps, def } from "./calc-scheduler.spec";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function count(skips: readonly string[], reason: string): number {
  return skips.filter((s) => s === reason).length;
}

/**
 * `bms-calc-v3` in the sweep (ADR 0070 decisions 2 and 4; `E4.1a` U6). The
 * owed guard is case (ii): a `$key` with no row in scope is one counted
 * `parameter_unset`, **no row is written**, the registry says so, and a `v1`
 * formula in the same sweep is untouched. A host that substituted `0` for
 * the absent key would write `0` and count nothing — the mutation this case
 * was run against.
 */
export async function runV3SweepTests(): Promise<void> {
  const V3 = { dialect: CALC_DIALECT_V3 } as const;

  // ---- (i) the parameter present → one write with kw * f -----------------------

  {
    const cost = def({ ...V3, pointKey: "COST", formula: "{kw} * $f" });
    const samples = new Map([["asset-1:kw", { value: 10, timeMs: 0 }]]);
    const parameters = new Map([[inputKey("asset-1", "f"), 2.15]]);
    const { deps, writes, skips, status } = buildSweepDeps([cost], samples, { parameters });
    await runScheduledSweep(deps, new Map(), 0);
    const batch = writes.flat();
    assert(
      batch.length === 1 && batch[0]?.pointKey === "COST" && batch[0].value === 21.5,
      `kw 10 × f 2.15 must write 21.5, got ${JSON.stringify(batch)}`,
    );
    assert(skips.length === 0, `no skip when the parameter is present, got ${JSON.stringify(skips)}`);
    assert(status.get("asset-1", "tp-1")?.outcome === "written", "the registry records the write");
  }

  // ---- (ii) the owed guard: the parameter absent → parameter_unset, no row --------

  {
    const cost = def({ ...V3, pointKey: "COST", templatePointId: "tp-cost", formula: "{kw} * $f" });
    const plain = def({ pointKey: "DOUBLE", templatePointId: "tp-plain", formula: "{kw} * 2" });
    const samples = new Map([["asset-1:kw", { value: 10, timeMs: 0 }]]);
    const { deps, writes, skips, status, warnings } = buildSweepDeps([cost, plain], samples);
    await runScheduledSweep(deps, new Map(), 0);
    const batch = writes.flat();
    assert(
      batch.length === 1 && batch[0]?.pointKey === "DOUBLE" && batch[0].value === 20,
      `only the v1 formula writes; the v3 one has no parameter. Got ${JSON.stringify(batch)}`,
    );
    assert(batch.every((w) => w.pointKey !== "COST"), "no row for COST — an absent parameter is never 0");
    assert(count(skips, "parameter_unset") === 1 && skips.length === 1, `exactly one parameter_unset, got ${JSON.stringify(skips)}`);
    const recorded = status.get("asset-1", "tp-cost");
    assert(
      recorded?.outcome === "skipped" && recorded.reason === "parameter_unset",
      `the registry says parameter_unset for COST, got ${JSON.stringify(recorded)}`,
    );
    assert(status.get("asset-1", "tp-plain")?.outcome === "written", "the v1 formula's registry entry is written");
    assert(warnings.length === 0, `an unset parameter is a counted refusal, not a warning, got ${JSON.stringify(warnings)}`);
  }

  // ---- (iii) the parameter read throws → parameters_unresolved, v2 and v1 unaffected ----

  {
    const cost = def({ ...V3, pointKey: "COST", templatePointId: "tp-cost", formula: "{kw} * $f" });
    const v2 = def({ dialect: CALC_DIALECT_V2, pointKey: "HALF", templatePointId: "tp-half", formula: "{kw} / 2" });
    const plain = def({ pointKey: "DOUBLE", templatePointId: "tp-plain", formula: "{kw} * 2" });
    const samples = new Map([["asset-1:kw", { value: 10, timeMs: 0 }]]);
    const { deps, writes, skips, warnings } = buildSweepDeps([cost, v2, plain], samples, { parametersThrows: true });
    await runScheduledSweep(deps, new Map(), 0);
    const written = writes.flat().map((w) => `${w.pointKey}=${w.value}`).sort().join(",");
    assert(written === "DOUBLE=20,HALF=5", `the v2 and v1 formulas still write when the parameter read fails, got ${written}`);
    assert(
      count(skips, "parameters_unresolved") === 1 && skips.length === 1,
      `every definition with paramRefs — one here — is parameters_unresolved, got ${JSON.stringify(skips)}`,
    );
    assert(
      warnings.length === 1 && warnings[0]?.includes("parameter"),
      `one warn for the failed read, got ${JSON.stringify(warnings)}`,
    );
  }

  // ---- (iv) batching: the pairs are the distinct (assetId, key) set, once per sweep ------

  {
    const a1 = def({ ...V3, assetId: "asset-1", pointKey: "COST", templatePointId: "tp-cost", formula: "{kw} * $f + $g" });
    const a2 = def({ ...V3, assetId: "asset-2", pointKey: "COST", templatePointId: "tp-cost", formula: "{kw} * $f" });
    const again = def({ ...V3, assetId: "asset-1", pointKey: "CO2", templatePointId: "tp-co2", formula: "{kw} * $f" });
    const v2 = def({ dialect: CALC_DIALECT_V2, pointKey: "HALF", templatePointId: "tp-half", formula: "{kw} / 2" });
    const samples = new Map([
      ["asset-1:kw", { value: 1, timeMs: 0 }],
      ["asset-2:kw", { value: 2, timeMs: 0 }],
    ]);
    const parameters = new Map([
      [inputKey("asset-1", "f"), 3],
      [inputKey("asset-1", "g"), 4],
      [inputKey("asset-2", "f"), 5],
    ]);
    const { deps, writes, parameterRequests } = buildSweepDeps([a1, a2, again, v2], samples, { parameters });
    await runScheduledSweep(deps, new Map(), 0);
    assert(parameterRequests.length === 1, `one parameter read per sweep, got ${parameterRequests.length}`);
    const pairs = parameterRequests[0].map((p) => `${p.assetId}:${p.key}`).sort().join(",");
    assert(
      pairs === "asset-1:f,asset-1:g,asset-2:f",
      `the pairs are the distinct (assetId, key) set of the v3 definitions — asset-1:f once, nothing for the v2 def — got ${pairs}`,
    );
    const written = writes.flat().map((w) => `${w.assetId}:${w.pointKey}=${w.value}`).sort().join(",");
    assert(
      written === "asset-1:CO2=3,asset-1:COST=7,asset-1:HALF=0.5,asset-2:COST=10",
      `each definition reads its own asset's parameters, got ${written}`,
    );
  }

  // ---- (v) a v3 definition with no $ at all never asks for parameters --------------------

  {
    const noParams = def({ ...V3, pointKey: "DOUBLE", formula: "{kw} * 2" });
    const samples = new Map([["asset-1:kw", { value: 10, timeMs: 0 }]]);
    const { deps, writes, parameterRequests } = buildSweepDeps([noParams], samples, { parametersThrows: true });
    await runScheduledSweep(deps, new Map(), 0);
    assert(parameterRequests.length === 0, "no v3 definition holds a $key, so no read is made");
    assert(writes.flat().length === 1, "and the formula writes even though the read would have thrown");
  }
}


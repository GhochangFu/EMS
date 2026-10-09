import { CALC_DIALECT_V2, CALC_DIALECT_V3, crossRefKey, windowKey } from "@bms/shared";

import { inputKey } from "./calc-batch";
import type { CalcDefinition } from "./calc-definition";
import type { Membership } from "./calc-graph";
import type { CalcInputSample } from "./calc-inputs";
import { assembleInputs, NO_OVERLAY, planWindowRequests, type CalcInputAssemblyDeps } from "./calc-input-assembly";
import { def, membershipOf, type Pair } from "./calc-scheduler.spec";
import { windowRequestKey, type WindowReadResult } from "./calc-windows.service";

/**
 * ADR 0097 decision 5 — the input assembly both hosts call. The scheduler's
 * five spec files reach this module only through `runScheduledSweep`; these
 * cases pin what the KPI host relies on and the scheduler ignores: the
 * read-only facts (`memberCount`, `membersNotFresh`, `oldestInputMs`), the
 * window end as a parameter, and the declared refusal order.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const NOW = 1_000_000;
/** Deliberately not `NOW` — a lookup keyed on `nowMs` misses every answer. */
const END = 960_000;
const NO_PARAMETERS: ReadonlyMap<string, number> = new Map();
const NO_WINDOWS: ReadonlyMap<string, WindowReadResult> = new Map();
const EMPTY: Membership = membershipOf();

type Fakes = {
  deps: CalcInputAssemblyDeps;
  localCalls: { assetId: string; refs: string[] }[];
  pairCalls: Pair[][];
};

/** One map keyed by `inputKey`, served by both reads, each call recorded. */
function fakes(samples: Map<string, CalcInputSample>): Fakes {
  const localCalls: Fakes["localCalls"] = [];
  const pairCalls: Fakes["pairCalls"] = [];
  const deps: CalcInputAssemblyDeps = {
    inputs: {
      getLatestSamples: async (assetId, refs) => {
        localCalls.push({ assetId, refs: [...refs] });
        const out = new Map<string, CalcInputSample>();
        for (const ref of refs) {
          const sample = samples.get(inputKey(assetId, ref));
          if (sample) out.set(ref, sample);
        }
        return out;
      },
      getLatestSamplesForPairs: async (pairs) => {
        pairCalls.push(pairs.map((p) => ({ assetId: p.assetId, pointKey: p.pointKey })));
        const out = new Map<string, CalcInputSample>();
        for (const pair of pairs) {
          const key = inputKey(pair.assetId, pair.pointKey);
          const sample = samples.get(key);
          if (sample) out.set(key, sample);
        }
        return out;
      },
    },
  };
  return { deps, localCalls, pairCalls };
}

function aggregateKeys(definition: CalcDefinition): string[] {
  return definition.crossRefs.filter((ref) => ref.kind === "aggregate").map((ref) => crossRefKey(ref));
}

const V2 = { dialect: CALC_DIALECT_V2, maxInputAgeSeconds: 60 } as const;
const V3 = { dialect: CALC_DIALECT_V3, maxInputAgeSeconds: 60 } as const;
const fresh = (value: number, timeMs: number = NOW): CalcInputSample => ({ value, timeMs });
const STALE_MS = NOW - 61_000;

export async function v1OldestInputIsTheMinimum(): Promise<void> {
  const formula = def({ formula: "{A} + {B}" });
  const { deps } = fakes(new Map([[inputKey("asset-1", "A"), fresh(1, 100)], [inputKey("asset-1", "B"), fresh(2, 400)]]));
  const result = await assembleInputs(deps, formula, NOW, EMPTY, NO_OVERLAY, NO_PARAMETERS, NO_WINDOWS, END);
  assert(result.ok, `two fresh locals must assemble; got ${JSON.stringify(result)}`);
  assert(result.ok && result.inputs.get("A") === 1 && result.inputs.get("B") === 2, "both locals must be in inputs");
  assert(result.oldestInputMs === 100, `oldestInputMs must be the OLDEST sample (100), got ${String(result.oldestInputMs)}`);
}

export async function staleLocalKeepsItsTime(): Promise<void> {
  const formula = def({ formula: "{A}", maxInputAgeSeconds: 60 });
  const { deps } = fakes(new Map([[inputKey("asset-1", "A"), fresh(1, STALE_MS)]]));
  const result = await assembleInputs(deps, formula, NOW, EMPTY, NO_OVERLAY, NO_PARAMETERS, NO_WINDOWS, END);
  assert(!result.ok && result.reason === "stale_input", `a stale local is stale_input; got ${JSON.stringify(result)}`);
  assert(result.oldestInputMs === STALE_MS, `a refusal still carries the read's time; got ${String(result.oldestInputMs)}`);
}

export async function absentLocalIsMissing(): Promise<void> {
  const formula = def({ formula: "{A}" });
  const { deps } = fakes(new Map());
  const result = await assembleInputs(deps, formula, NOW, EMPTY, NO_OVERLAY, NO_PARAMETERS, NO_WINDOWS, END);
  assert(!result.ok && result.reason === "missing_input", `an absent local is missing_input; got ${JSON.stringify(result)}`);
  assert(result.oldestInputMs === null, `nothing was read, so oldestInputMs is null; got ${String(result.oldestInputMs)}`);
}

export async function parameterUnsetBeforeAnyRead(): Promise<void> {
  const formula = def({ ...V3, formula: "{A} * $tariff" });
  const f = fakes(new Map([[inputKey("asset-1", "A"), fresh(1)]]));
  const result = await assembleInputs(f.deps, formula, NOW, EMPTY, NO_OVERLAY, NO_PARAMETERS, NO_WINDOWS, END);
  assert(!result.ok && result.reason === "parameter_unset", `an absent $key is parameter_unset; got ${JSON.stringify(result)}`);
  assert(f.localCalls.length === 0, `parameter_unset must refuse before any read; got ${f.localCalls.length} local reads`);
}

export async function overlayIsReadFirst(): Promise<void> {
  const formula = def({ formula: "{A} + {B}" });
  const f = fakes(new Map([[inputKey("asset-1", "A"), fresh(1)], [inputKey("asset-1", "B"), fresh(2)]]));
  const overlay = new Map([[inputKey("asset-1", "A"), fresh(50)]]);
  const result = await assembleInputs(f.deps, formula, NOW, EMPTY, overlay, NO_PARAMETERS, NO_WINDOWS, END);
  assert(result.ok && result.inputs.get("A") === 50, `the overlay value must win; got ${JSON.stringify(result)}`);
  assert(
    f.localCalls.length === 1 && !f.localCalls[0].refs.includes("A"),
    `the read must not ask for an overlay ref; got ${JSON.stringify(f.localCalls)}`,
  );
}

export async function everyMemberIsClassified(): Promise<void> {
  const formula = def({ ...V2, formula: "sum({kw} @site) + sum({kva} @site)" });
  const [kw, kva] = aggregateKeys(formula);
  const kwMembers = ["A", "B", "C"].map((assetId) => ({ assetId, pointKey: "kw" }));
  const kvaMembers = ["D", "E"].map((assetId) => ({ assetId, pointKey: "kva" }));
  const membership = membershipOf([], [["asset-1", [[kw, kwMembers], [kva, kvaMembers]]]]);
  const { deps } = fakes(
    new Map([
      [inputKey("A", "kw"), fresh(1)],
      [inputKey("B", "kw"), fresh(1)],
      [inputKey("C", "kw"), fresh(1, STALE_MS)],
      [inputKey("D", "kva"), fresh(1)],
      [inputKey("E", "kva"), fresh(1, STALE_MS)],
    ]),
  );
  const result = await assembleInputs(deps, formula, NOW, membership, NO_OVERLAY, NO_PARAMETERS, NO_WINDOWS, END);
  assert(!result.ok && result.reason === "stale_input", `the first aggregate refuses stale_input; got ${JSON.stringify(result)}`);
  assert(result.memberCount === 5, `memberCount is every declared member (5); got ${result.memberCount}`);
  assert(
    result.membersNotFresh === 2,
    `membersNotFresh classifies EVERY member of EVERY aggregate (2), not up to the refusal; got ${result.membersNotFresh}`,
  );
}

/** A pure `v2` aggregate: no local ref, so only the members can set `oldestInputMs`. */
function pureAggregate(oldestMs: number) {
  const formula = def({ ...V2, formula: "sum({kw} @site)" });
  const [kw] = aggregateKeys(formula);
  const members = ["A", "B", "C"].map((assetId) => ({ assetId, pointKey: "kw" }));
  const membership = membershipOf([], [["asset-1", [[kw, members]]]]);
  const { deps } = fakes(
    new Map([
      [inputKey("A", "kw"), fresh(1, NOW)],
      [inputKey("B", "kw"), fresh(2, oldestMs)],
      [inputKey("C", "kw"), fresh(3, NOW - 5_000)],
    ]),
  );
  return { formula, membership, deps };
}

export async function v2OldestInputIsTheOldestMember(): Promise<void> {
  const oldest = NOW - 30_000;
  const { formula, membership, deps } = pureAggregate(oldest);
  const result = await assembleInputs(deps, formula, NOW, membership, NO_OVERLAY, NO_PARAMETERS, NO_WINDOWS, END);
  assert(result.ok, `three fresh members must assemble; got ${JSON.stringify(result)}`);
  assert(
    result.oldestInputMs === oldest,
    `a pure aggregate's oldestInputMs is the OLDEST member (${oldest}); got ${String(result.oldestInputMs)}`,
  );
}

export async function v2StaleMemberRefusalKeepsItsTime(): Promise<void> {
  const { formula, membership, deps } = pureAggregate(STALE_MS);
  const result = await assembleInputs(deps, formula, NOW, membership, NO_OVERLAY, NO_PARAMETERS, NO_WINDOWS, END);
  assert(!result.ok && result.reason === "stale_input", `a stale member refuses stale_input; got ${JSON.stringify(result)}`);
  assert(
    result.oldestInputMs === STALE_MS,
    `a member refusal still carries the stale member's time (${STALE_MS}); got ${String(result.oldestInputMs)}`,
  );
}

export async function excludedOnSuccessUnderARatio(): Promise<void> {
  const formula = def({ ...V2, formula: "sum({kw} @site)", minCoverageRatio: 0.5 });
  const [kw] = aggregateKeys(formula);
  const members = ["A", "B"].map((assetId) => ({ assetId, pointKey: "kw" }));
  const membership = membershipOf([], [["asset-1", [[kw, members]]]]);
  const { deps } = fakes(new Map([[inputKey("A", "kw"), fresh(7)], [inputKey("B", "kw"), fresh(9, STALE_MS)]]));
  const result = await assembleInputs(deps, formula, NOW, membership, NO_OVERLAY, NO_PARAMETERS, NO_WINDOWS, END);
  assert(result.ok, `half fresh meets a 0.5 floor; got ${JSON.stringify(result)}`);
  assert(result.ok && result.excluded === 1, `excluded is resolveAggregate's count (1)`);
  assert(result.membersNotFresh === 1, `membersNotFresh is carried on success too (1); got ${result.membersNotFresh}`);
  assert(result.ok && result.crossInputs?.get(kw) === 7, `the value is over the fresh member only (7)`);
}

export async function unresolvedCodeIsUnknown(): Promise<void> {
  const formula = def({ ...V2, formula: "{TX_01.kw} + 1" });
  const membership = membershipOf([["asset-1", [["TX_01", null]]]]);
  const f = fakes(new Map());
  const result = await assembleInputs(f.deps, formula, NOW, membership, NO_OVERLAY, NO_PARAMETERS, NO_WINDOWS, END);
  assert(!result.ok && result.reason === "unknown_asset_reference", `got ${JSON.stringify(result)}`);
  assert(f.pairCalls.length === 0, "an unresolved code refuses before the pairs read");
}

export async function emptyAggregateIsNoMembers(): Promise<void> {
  const formula = def({ ...V2, formula: "sum({kw} @site)" });
  const [kw] = aggregateKeys(formula);
  const membership = membershipOf([], [["asset-1", [[kw, []]]]]);
  const { deps } = fakes(new Map());
  const result = await assembleInputs(deps, formula, NOW, membership, NO_OVERLAY, NO_PARAMETERS, NO_WINDOWS, END);
  assert(!result.ok && result.reason === "no_members", `got ${JSON.stringify(result)}`);
  assert(result.memberCount === 0, `memberCount is 0; got ${result.memberCount}`);
}

export async function absentWindowAnswerIsUnresolved(): Promise<void> {
  const formula = def({ ...V3, formula: "avg({kw}, 24h)" });
  const { deps } = fakes(new Map([[inputKey("asset-1", "kw"), fresh(1)]]));
  const result = await assembleInputs(deps, formula, NOW, EMPTY, NO_OVERLAY, NO_PARAMETERS, NO_WINDOWS, END);
  assert(!result.ok && result.reason === "windows_unresolved", `got ${JSON.stringify(result)}`);
}

export async function windowAnswerReasonPassesThrough(): Promise<void> {
  const formula = def({ ...V3, formula: "avg({kw}, 24h)" });
  const { deps } = fakes(new Map([[inputKey("asset-1", "kw"), fresh(1)]]));
  const windows = new Map<string, WindowReadResult>([
    [windowRequestKey("asset-1", formula.windowReads[0], END), { ok: false, reason: "window_sparse" }],
  ]);
  const result = await assembleInputs(deps, formula, NOW, EMPTY, NO_OVERLAY, NO_PARAMETERS, windows, END);
  assert(!result.ok && result.reason === "window_sparse", `the answer's own reason passes through; got ${JSON.stringify(result)}`);
}

export async function windowLookupUsesTheGivenEnd(): Promise<void> {
  const formula = def({ ...V3, formula: "avg({kw}, 24h)" });
  const node = formula.windowReads[0];
  const { deps } = fakes(new Map([[inputKey("asset-1", "kw"), fresh(1)]]));
  const windows = new Map<string, WindowReadResult>([[windowRequestKey("asset-1", node, END), { ok: true, value: 42 }]]);
  const result = await assembleInputs(deps, formula, NOW, EMPTY, NO_OVERLAY, NO_PARAMETERS, windows, END);
  assert(result.ok, `the answer is keyed on the eighth argument, not nowMs; got ${JSON.stringify(result)}`);
  assert(result.ok && result.windowValues.get(windowKey(node)) === 42, "the window value is in the fifth map");
}

export async function planWindowRequestsResolvesQualifiedReads(): Promise<void> {
  const formula = def({ ...V3, formula: "avg({kw}, 24h) + max({TX_01.kw}, 7d) + min({TX_02.kw}, 7d)" });
  const membership = membershipOf([["asset-1", [["TX_01", "asset-tx1"], ["TX_02", null]]]]);
  const requests = planWindowRequests(formula, membership, END);
  assert(formula.windowReads.length === 3, `the fixture must carry three window reads; got ${formula.windowReads.length}`);
  assert(requests.length === 2, `an unresolved code is skipped (2 requests); got ${JSON.stringify(requests)}`);
  assert(
    requests[0].readAssetId === "asset-1" && requests[1].readAssetId === "asset-tx1",
    `a bare read is the owner's, a qualified one the resolved id; got ${JSON.stringify(requests.map((r) => r.readAssetId))}`,
  );
  assert(requests.every((r) => r.ownerAssetId === "asset-1" && r.endMs === END), "owner and end ride on every request");
}

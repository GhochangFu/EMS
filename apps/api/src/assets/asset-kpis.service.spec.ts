import type { CalcCrossRef } from "@bms/shared";
import { crossRefKey, parseFormula, CALC_DIALECT_V2 } from "@bms/shared";

import { inputKey } from "../calc/calc-batch";
import type { Membership } from "../calc/calc-graph";
import type { CalcInputSample } from "../calc/calc-inputs";
import { windowRequestKey, type WindowReadRequest, type WindowReadResult } from "../calc/calc-windows.service";
import { evaluateAssetKpis, type AssetKpisDeps, type KpiTemplateRow } from "./asset-kpis.service";

/**
 * `F2.33` (ADR 0097) — the KPI read host over a deps object, so no Nest DI is
 * needed (`F4.20`). Each case is one claim; `asset-kpis.service.test.ts` runs
 * them. The integration spec runs the same host against the real resolvers.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const ASSET = "22222222-2222-4222-8222-222222222222";
const TEMPLATE = "33333333-3333-4333-8333-333333333333";
/** 30 s past the minute, so the minute floor differs from `now`. */
const NOW = new Date(Date.UTC(2026, 9, 9, 5, 0, 30));
const NOW_MS = NOW.getTime();
const WINDOW_MINUTES = 15;

type Kpi = {
  code: string;
  name: string;
  unit?: string;
  pointKeys: string[];
  expression: string;
  dialect: string;
  higherIsBetter?: boolean;
};

const V1 = "bms-calc-v1";
const V2 = "bms-calc-v2";
const V3 = "bms-calc-v3";

type Options = {
  row?: KpiTemplateRow | null;
  kpis?: Kpi[];
  samples?: Map<string, CalcInputSample>;
  membership?: Membership;
  parameters?: Map<string, number>;
  windows?: (request: WindowReadRequest) => WindowReadResult | undefined;
};

type Harness = {
  deps: AssetKpisDeps;
  localCalls: { assetId: string; refs: string[] }[];
  pairCalls: { assetId: string; pointKey: string }[][];
  membershipCalls: { assetId: string; crossRefs: readonly CalcCrossRef[] }[][];
  parameterCalls: { pairs: { assetId: string; key: string }[]; at: Date }[];
  windowCalls: WindowReadRequest[][];
  warnings: string[];
};

function harness(options: Options): Harness {
  const samples = options.samples ?? new Map();
  const h: Harness = {
    localCalls: [],
    pairCalls: [],
    membershipCalls: [],
    parameterCalls: [],
    windowCalls: [],
    warnings: [],
    deps: undefined as unknown as AssetKpisDeps,
  };
  h.deps = {
    loadTemplate: async () =>
      options.row !== undefined ? options.row : { templateId: TEMPLATE, content: { kpis: options.kpis ?? [] } },
    inputs: {
      getLatestSamples: async (assetId, refs) => {
        h.localCalls.push({ assetId, refs: [...refs] });
        const out = new Map<string, CalcInputSample>();
        for (const ref of refs) {
          const sample = samples.get(inputKey(assetId, ref));
          if (sample) out.set(ref, sample);
        }
        return out;
      },
      getLatestSamplesForPairs: async (pairs) => {
        h.pairCalls.push(pairs.map((p) => ({ assetId: p.assetId, pointKey: p.pointKey })));
        const out = new Map<string, CalcInputSample>();
        for (const pair of pairs) {
          const key = inputKey(pair.assetId, pair.pointKey);
          const sample = samples.get(key);
          if (sample) out.set(key, sample);
        }
        return out;
      },
    },
    scope: {
      resolveMembership: async (defs) => {
        h.membershipCalls.push(defs.map((d) => ({ assetId: d.assetId, crossRefs: d.crossRefs })));
        return options.membership ?? { qualified: new Map(), members: new Map() };
      },
    },
    parameters: {
      resolveForAssets: async (pairs, at) => {
        h.parameterCalls.push({ pairs: pairs.map((p) => ({ assetId: p.assetId, key: p.key })), at });
        const out = new Map<string, number>();
        for (const pair of pairs) {
          const value = options.parameters?.get(inputKey(pair.assetId, pair.key));
          if (value !== undefined) out.set(inputKey(pair.assetId, pair.key), value);
        }
        return out;
      },
    },
    windows: {
      resolveReads: async (requests) => {
        h.windowCalls.push([...requests]);
        const out = new Map<string, WindowReadResult>();
        for (const request of requests) {
          const answer = options.windows?.(request);
          if (answer) {
            out.set(windowRequestKey(request.ownerAssetId, request.node, request.endMs), answer);
          }
        }
        return out;
      },
    },
    logger: { warn: (message: unknown) => h.warnings.push(String(message)) },
  };
  return h;
}

function run(h: Harness) {
  return evaluateAssetKpis(h.deps, ASSET, WINDOW_MINUTES, NOW);
}

function aggregateKey(expression: string): string {
  const parsed = parseFormula(expression, { dialect: CALC_DIALECT_V2 });
  if (!parsed.ok) throw new Error(`fixture ${expression} must parse`);
  const ref = parsed.crossRefs.find((r) => r.kind === "aggregate");
  if (!ref) throw new Error(`fixture ${expression} must carry an aggregate`);
  return crossRefKey(ref);
}

const KW_NOW: Kpi = { code: "kw_now", name: "kW now", unit: "kW", pointKeys: ["kw"], expression: "{kw}", dialect: V1 };
const SITE_KW: Kpi = { code: "site_kw", name: "Site kW", pointKeys: [], expression: "sum({kw} @site)", dialect: V2 };

export async function noTemplateIsAnEmptyList(): Promise<void> {
  const h = harness({ row: { templateId: null, content: null } });
  const response = await run(h);
  assert(response.items.length === 0, `no template → no items; got ${JSON.stringify(response)}`);
  assert(
    h.localCalls.length + h.membershipCalls.length + h.parameterCalls.length + h.windowCalls.length === 0,
    "no resolver may be called for an asset with no template",
  );
}

export async function absentAssetIsNotFound(): Promise<void> {
  const h = harness({ row: null });
  let name = "resolved";
  try {
    await run(h);
  } catch (err) {
    name = (err as Error).name;
  }
  assert(name === "NotFoundException", `an absent asset is a 404; got ${name}`);
}

export async function malformedSliceWarnsAndListsNothing(): Promise<void> {
  const h = harness({ row: { templateId: TEMPLATE, content: { kpis: [{ code: "x" }] } } });
  const response = await run(h);
  assert(response.items.length === 0, `a malformed kpis slice lists nothing; got ${JSON.stringify(response)}`);
  assert(
    h.warnings.length === 1 && h.warnings[0].includes(TEMPLATE),
    `one warn naming the template; got ${JSON.stringify(h.warnings)}`,
  );
}

export async function unvalidatedIsListedNotEvaluated(): Promise<void> {
  const h = harness({
    kpis: [{ code: "legacy", name: "Legacy", pointKeys: ["kw"], expression: "kw * 2", dialect: "unvalidated" }],
  });
  const response = await run(h);
  const [item] = response.items;
  assert(
    item?.code === "legacy" &&
      item.value === null &&
      item.state === "unvalidated" &&
      item.inputAsOf === null &&
      item.excluded === null &&
      item.memberCount === 0,
    `an unvalidated KPI is listed with no value; got ${JSON.stringify(item)}`,
  );
  assert(h.localCalls.length === 0, "an unvalidated KPI is never read");
}

export async function v1OkCarriesTheOldestInput(): Promise<void> {
  const h = harness({
    kpis: [{ code: "sum", name: "Sum", pointKeys: ["a", "b"], expression: "{a} + {b}", dialect: V1 }],
    samples: new Map([
      [inputKey(ASSET, "a"), { value: 2, timeMs: NOW_MS - 60_000 }],
      [inputKey(ASSET, "b"), { value: 3, timeMs: NOW_MS - 10_000 }],
    ]),
  });
  const [item] = (await run(h)).items;
  assert(item?.value === 5 && item.state === "ok", `v1 evaluates; got ${JSON.stringify(item)}`);
  assert(
    item.inputAsOf === new Date(NOW_MS - 60_000).toISOString(),
    `inputAsOf is the OLDEST input; got ${String(item.inputAsOf)}`,
  );
}

export async function sampleAtTheWindowEdgeIsFresh(): Promise<void> {
  const h = harness({
    kpis: [KW_NOW],
    samples: new Map([[inputKey(ASSET, "kw"), { value: 4, timeMs: NOW_MS - WINDOW_MINUTES * 60_000 }]]),
  });
  const [item] = (await run(h)).items;
  assert(item?.state === "ok" && item.value === 4, `a sample exactly windowMinutes old is fresh; got ${JSON.stringify(item)}`);
}

export async function sampleOneSecondPastTheWindowIsStale(): Promise<void> {
  const time = NOW_MS - WINDOW_MINUTES * 60_000 - 1_000;
  const h = harness({ kpis: [KW_NOW], samples: new Map([[inputKey(ASSET, "kw"), { value: 4, timeMs: time }]]) });
  const [item] = (await run(h)).items;
  assert(item?.value === null && item.state === "stale_input", `one second past is stale; got ${JSON.stringify(item)}`);
  assert(item.inputAsOf === new Date(time).toISOString(), `a stale KPI still says how stale; got ${String(item.inputAsOf)}`);
}

const MEMBERS = ["aaaaaaaa-0000-4000-8000-000000000001", "aaaaaaaa-0000-4000-8000-000000000002", "aaaaaaaa-0000-4000-8000-000000000003"];

function siteMembership(): Membership {
  return {
    qualified: new Map(),
    members: new Map([[ASSET, new Map([[aggregateKey("sum({kw} @site)"), MEMBERS.map((assetId) => ({ assetId, pointKey: "kw" }))]])]]),
  };
}

export async function v2MissingMemberIsCountedNeverNamed(): Promise<void> {
  const h = harness({
    kpis: [SITE_KW],
    membership: siteMembership(),
    samples: new Map([
      [inputKey(MEMBERS[0], "kw"), { value: 1, timeMs: NOW_MS }],
      [inputKey(MEMBERS[1], "kw"), { value: 2, timeMs: NOW_MS }],
    ]),
  });
  const response = await run(h);
  const [item] = response.items;
  assert(
    item?.value === null && item.state === "missing_input" && item.excluded === 1 && item.memberCount === 3,
    `one silent member: null, missing_input, 1 of 3; got ${JSON.stringify(item)}`,
  );
  const body = JSON.stringify(response);
  assert(MEMBERS.every((id) => !body.includes(id)), "no member id may appear anywhere in the body (decision 6)");
}

/**
 * A stale LOCAL input refuses before the member read, so no member was
 * classified: `excluded` is `null`, never a "0 excluded" nobody measured
 * (code review, 2026-10-09). Every member is fresh, so a host that defaulted
 * the count would report 0 here, not 3 — the null is the only right answer.
 */
export async function aRefusalBeforeTheMemberReadHasNoExcludedCount(): Promise<void> {
  const h = harness({
    kpis: [{ code: "mixed", name: "Mixed", pointKeys: ["kw"], expression: "{kw} + sum({kw} @site)", dialect: V2 }],
    membership: siteMembership(),
    samples: new Map([
      [inputKey(ASSET, "kw"), { value: 9, timeMs: NOW_MS - WINDOW_MINUTES * 60_000 - 1_000 }],
      ...MEMBERS.map((id): [string, CalcInputSample] => [inputKey(id, "kw"), { value: 1, timeMs: NOW_MS }]),
    ]),
  });
  const [item] = (await run(h)).items;
  assert(item?.state === "stale_input" && item.memberCount === 3, `a stale local input refuses; got ${JSON.stringify(item)}`);
  assert(h.pairCalls.length === 0, "the refusal came before the member read");
  assert(item.excluded === null, `no member was classified, so excluded is null; got ${String(item.excluded)}`);
}

export async function v2AllFreshIsTheSum(): Promise<void> {
  const h = harness({
    kpis: [SITE_KW],
    membership: siteMembership(),
    samples: new Map(MEMBERS.map((id, index) => [inputKey(id, "kw"), { value: index + 1, timeMs: NOW_MS }])),
  });
  const [item] = (await run(h)).items;
  assert(item?.value === 6 && item.state === "ok" && item.excluded === 0, `all fresh → the sum; got ${JSON.stringify(item)}`);
}

export async function v2InputAsOfIsTheOldestMember(): Promise<void> {
  const times = [NOW_MS - 10_000, NOW_MS - 90_000, NOW_MS - 30_000];
  const h = harness({
    kpis: [SITE_KW],
    membership: siteMembership(),
    samples: new Map(MEMBERS.map((id, index) => [inputKey(id, "kw"), { value: index + 1, timeMs: times[index] }])),
  });
  const [item] = (await run(h)).items;
  assert(item?.state === "ok", `three fresh members evaluate; got ${JSON.stringify(item)}`);
  assert(
    item.inputAsOf === new Date(NOW_MS - 90_000).toISOString(),
    `a pure aggregate's inputAsOf is the OLDEST member read; got ${String(item.inputAsOf)}`,
  );
}

export async function v3ParameterUnset(): Promise<void> {
  const h = harness({
    kpis: [{ code: "cost", name: "Cost", pointKeys: ["kw"], expression: "{kw} * $tariff", dialect: V3 }],
    samples: new Map([[inputKey(ASSET, "kw"), { value: 4, timeMs: NOW_MS }]]),
  });
  const [item] = (await run(h)).items;
  assert(item?.state === "parameter_unset" && item.value === null, `got ${JSON.stringify(item)}`);
  assert(
    h.parameterCalls.length === 1 &&
      JSON.stringify(h.parameterCalls[0].pairs) === JSON.stringify([{ assetId: ASSET, key: "tariff" }]) &&
      h.parameterCalls[0].at.getTime() === NOW_MS,
    `resolveForAssets once, with the pair and now; got ${JSON.stringify(h.parameterCalls)}`,
  );
}

export async function v3WindowEndIsTheMinuteFloor(): Promise<void> {
  const h = harness({
    kpis: [{ code: "avg", name: "Avg", pointKeys: ["kw"], expression: "avg({kw}, 24h)", dialect: V3 }],
    samples: new Map([[inputKey(ASSET, "kw"), { value: 4, timeMs: NOW_MS }]]),
    windows: () => ({ ok: true, value: 3.5 }),
  });
  const [item] = (await run(h)).items;
  assert(h.windowCalls.length === 1, `resolveReads once; got ${h.windowCalls.length}`);
  const endMs = h.windowCalls[0][0]?.endMs;
  assert(endMs === Math.floor(NOW_MS / 60_000) * 60_000, `the window end is the minute floor; got ${String(endMs)}`);
  assert(item?.state === "ok" && item.value === 3.5, `the window value evaluates; got ${JSON.stringify(item)}`);
}

export async function nonFiniteIsAState(): Promise<void> {
  const h = harness({
    kpis: [{ code: "ratio", name: "Ratio", pointKeys: ["a", "b"], expression: "{a} / {b}", dialect: V1 }],
    samples: new Map([
      [inputKey(ASSET, "a"), { value: 1, timeMs: NOW_MS }],
      [inputKey(ASSET, "b"), { value: 0, timeMs: NOW_MS }],
    ]),
  });
  const [item] = (await run(h)).items;
  assert(item?.state === "non_finite" && item.value === null, `division by zero is non_finite; got ${JSON.stringify(item)}`);
}

export async function declaredOrderIsKept(): Promise<void> {
  const h = harness({
    kpis: [
      { ...KW_NOW, code: "B", name: "B" },
      { ...KW_NOW, code: "A", name: "A" },
    ],
  });
  const response = await run(h);
  assert(response.items.map((i) => i.code).join() === "B,A", `declared order; got ${response.items.map((i) => i.code).join()}`);
}

export async function oneMembershipCallForEveryKpi(): Promise<void> {
  const h = harness({
    kpis: [SITE_KW, { code: "site_kva", name: "Site kVA", pointKeys: [], expression: "sum({kva} @site)", dialect: V2 }],
  });
  await run(h);
  assert(h.membershipCalls.length === 1, `resolveMembership once per request; got ${h.membershipCalls.length}`);
  const refs = h.membershipCalls[0].flatMap((d) => d.crossRefs.map((r) => crossRefKey(r)));
  assert(refs.length === 2 && refs[0] !== refs[1], `both KPIs' cross refs in the one call; got ${JSON.stringify(refs)}`);
}

export async function responseCarriesOnlyTheRuledFields(): Promise<void> {
  const h = harness({
    kpis: [{ ...KW_NOW, higherIsBetter: true }],
    samples: new Map([[inputKey(ASSET, "kw"), { value: 4, timeMs: NOW_MS }]]),
  });
  const response = await run(h);
  assert(response.assetId === ASSET && response.windowMinutes === WINDOW_MINUTES, "the envelope echoes the asset and window");
  const keys = Object.keys(response.items[0] ?? {}).sort().join();
  assert(
    keys === "code,excluded,higherIsBetter,inputAsOf,memberCount,name,state,unit,value",
    `an item carries the ruled fields and nothing else (decision 6); got ${keys}`,
  );
}

/** The window is the caller's, not the default: at 5 minutes a 6-minute-old sample is stale. */
export async function theCallersWindowIsTheStalenessBudget(): Promise<void> {
  const h = harness({ kpis: [KW_NOW], samples: new Map([[inputKey(ASSET, "kw"), { value: 4, timeMs: NOW_MS - 6 * 60_000 }]]) });
  const response = await evaluateAssetKpis(h.deps, ASSET, 5, NOW);
  assert(response.windowMinutes === 5, `the envelope echoes the caller's window; got ${response.windowMinutes}`);
  assert(response.items[0]?.state === "stale_input", `6 min old under a 5-min window is stale; got ${JSON.stringify(response.items[0])}`);
}

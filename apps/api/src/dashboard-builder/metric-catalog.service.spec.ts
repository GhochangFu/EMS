import type { BmsDb } from "@bms/db";
import { METRIC_CATALOG, type JwtPayload } from "@bms/shared";

import { AssetHealthService } from "../asset-health/asset-health.service";
import type { AccessControlService } from "../auth/access-control.service";
import type { BmsTx } from "../database/tenant-context";
import { scopeKeyFor } from "./dashboard-scope-assets";
import { MetricCatalogService, planResolves, RESOLVERS } from "./metric-catalog.service";

/**
 * `E4.2` PR 1 sweep — the catalog's resolvers, pure claims (no database). Assertions live
 * here; `metric-catalog.service.test.ts` is the Vitest entry point (ADR 0014). One exported
 * function per claim.
 */
function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const same = (actual: unknown, expected: unknown, what: string): void => {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
};

/** A transaction that refuses every statement: any SQL the resolver builds is the failure. */
const refusingTx = (): BmsTx => {
  const refuse = () => {
    throw new Error("the resolver built SQL for an empty scope");
  };
  return { execute: refuse, select: refuse } as unknown as BmsTx;
};

/** A database that refuses every statement, behind the REAL `AssetHealthService` — so the
 * `assets.health.score` claim is about `assetsInScope`'s own empty-list guard, not a stub. */
const refusingDb = (): BmsDb =>
  new Proxy({} as BmsDb, {
    get: (_target, property) => () => {
      throw new Error(`the health service built SQL (${String(property)}) for an empty scope`);
    },
  });

const noDeps = { health: new AssetHealthService(refusingDb()), readableLocationIds: null, scopeLocationId: null } as Parameters<
  (typeof RESOLVERS)["sustainability.total"]
>[3];

/** What each entry's parsed params look like — `{}` for the Stage C five, the pair for the two
 * roll-ups, `{ period }` for `water.balance` (`E4.3`). */
const paramsFor = (key: string): unknown =>
  key.startsWith("sustainability.")
    ? { pointKey: "kl_today", aggregate: "sum" }
    : key === "water.balance"
      ? { period: "today" }
      : {};

/**
 * The sentence over `RESOLVERS` generalises over EVERY entry, so the gate enumerates them:
 * each catalog key resolves over `[]` without a statement, and an eighth entry added without
 * its guard fails here rather than in a `Logger.warn`. Keyed on `METRIC_CATALOG` (the shared
 * declaration) so a key the record forgot is a type error, not a silent skip.
 */
export async function everyEntryOnAnEmptyScopeBuildsNoSql(): Promise<void> {
  const keys = Object.keys(METRIC_CATALOG) as (keyof typeof RESOLVERS)[];
  assert(keys.length >= 8, `expected the eight catalog entries, saw ${keys.length}`);
  const failures: string[] = [];
  for (const key of keys) {
    try {
      const resolved = await RESOLVERS[key](refusingTx(), "org", [], noDeps, paramsFor(key));
      if (resolved.key !== key) failures.push(`${key}: answered as ${resolved.key}`);
    } catch (error) {
      failures.push(`${key}: ${(error as Error).message}`);
    }
  }
  same(failures, [], "entries that built SQL for an empty scope");
}

/**
 * `sustainability.total` on an empty scope answers `0/0`, `null`, no unit and no currency
 * BEFORE any SQL — the sentence over `RESOLVERS` ("every entry below routes an empty scope to
 * a zero answer before building SQL") is true of this entry too. PR 1 read the point's unit
 * and the organization's currency first.
 */
export async function totalOnAnEmptyScopeBuildsNoSql(): Promise<void> {
  const resolved = await RESOLVERS["sustainability.total"](refusingTx(), "org", [], noDeps, {
    pointKey: "kl_today",
    aggregate: "sum",
  });
  same(
    resolved,
    {
      shape: "metric",
      key: "sustainability.total",
      value: null,
      unit: null,
      coverage: { fresh: 0, carrying: 0 },
      currency: null,
    },
    "sustainability.total over []",
  );
}

/** The sibling `by_location` entry is the control: it already short-circuited in PR 1. */
export async function byLocationOnAnEmptyScopeBuildsNoSql(): Promise<void> {
  const resolved = await RESOLVERS["sustainability.by_location"](refusingTx(), "org", [], noDeps, {
    pointKey: "kl_today",
    aggregate: "sum",
  });
  same(
    { shape: resolved.shape, rows: resolved.shape === "dataset" ? resolved.rows : undefined },
    { shape: "dataset", rows: [] },
    "sustainability.by_location over []",
  );
}

/**
 * `F3.73` Task 2.4 — the dedupe key carries the widget's SCOPE (ADR 0087, plan D3).
 *
 * Two tiles binding `alarms.active.count` on two tabs that bind two different asset groups are
 * two different numbers, so they must be two resolves; before F3.73 the key was
 * `(catalogKey, params)` alone and the second tile silently showed the first tab's count.
 */
const TAB_SITE = "00000000-0000-4000-8000-00000000c001";
const GROUP_ONE = "00000000-0000-4000-8000-00000000a001";
const GROUP_TWO = "00000000-0000-4000-8000-00000000a002";
const siteScope = { locationId: TAB_SITE, assetGroupId: null, assetId: null };
const groupScope = (assetGroupId: string) => ({ locationId: null, assetGroupId, assetId: null });

const countSource = (id: string, widgetId: string) => ({
  id,
  widgetId,
  catalogKey: "alarms.active.count",
  params: {},
});

const plannedScopeKeys = (
  scopes: Record<string, { locationId: string | null; assetGroupId: string | null; assetId: null }>,
  sources: ReturnType<typeof countSource>[],
): string[] => {
  const plan = planResolves(
    sources,
    (widgetId) => scopes[widgetId] ?? siteScope,
    () => {
      throw new Error("no binding in this fixture fails its write schema");
    },
  );
  const keys = [...plan.resolves.values()].map((resolve) => resolve.scopeKey);
  // Every source maps to a planned resolve — a dropped source would pass a count claim.
  assert(
    sources.every((source) => plan.resolves.has(plan.resolveKeyOf.get(source.id) ?? "")),
    "every source must map to a planned resolve",
  );
  return keys;
};

/** Same key on two tabs bound to two different groups: two resolves, one per group scope. */
export function sameKeyOnTwoGroupTabsIsTwoResolves(): void {
  const keys = plannedScopeKeys(
    { w1: groupScope(GROUP_ONE), w2: groupScope(GROUP_TWO) },
    [countSource("s1", "w1"), countSource("s2", "w2")],
  );
  same(keys, [`group:${GROUP_ONE}`, `group:${GROUP_TWO}`], "planned scope keys, two group tabs");
}

/** Same key twice on ONE tab (one group scope): still one resolve (the `E4.2` dedupe holds). */
export function sameKeyOnOneTabIsOneResolve(): void {
  const keys = plannedScopeKeys(
    { w1: groupScope(GROUP_ONE), w2: groupScope(GROUP_ONE) },
    [countSource("s1", "w1"), countSource("s2", "w2")],
  );
  same(keys, [`group:${GROUP_ONE}`], "planned scope keys, one group tab");
}

/** An Overview tile (the dashboard's site scope) beside a group tile: two resolves. */
export function overviewAndGroupTabAreTwoResolves(): void {
  const keys = plannedScopeKeys(
    { w1: siteScope, w2: groupScope(GROUP_ONE) },
    [countSource("s1", "w1"), countSource("s2", "w2")],
  );
  same(keys, [`location:${TAB_SITE}`, `group:${GROUP_ONE}`], "planned scope keys, overview + group");
}

/** `scopeKeyFor` follows `resolveAssetScope`'s arm order: asset, location, group, organization. */
export function scopeKeyFollowsTheResolverArmOrder(): void {
  same(
    [
      scopeKeyFor({ assetId: "a", locationId: "l", assetGroupId: "g" }),
      scopeKeyFor({ assetId: null, locationId: "l", assetGroupId: "g" }),
      scopeKeyFor({ assetId: null, locationId: null, assetGroupId: "g" }),
      scopeKeyFor({ assetId: null, locationId: null, assetGroupId: null }),
    ],
    ["asset:a", "location:l", "group:g", "organization"],
    "scope keys by arm",
  );
}

/**
 * `F2.10` / ADR 0098 decision 7, B1 — on a location dashboard the two sustainability entries
 * resolve over the node's SUBTREE, so their scope key is `location-subtree:<id>`, never the
 * per-node `location:<id>` they would otherwise share with the per-node entries.
 */
const sustainabilitySource = (id: string, widgetId: string, catalogKey: string) => ({
  id,
  widgetId,
  catalogKey,
  params: { pointKey: "kwh_today", aggregate: "sum" },
});

export function aSustainabilityBindingOnALocationDashboardPlansASubtreeScope(): void {
  const plan = planResolves(
    [
      sustainabilitySource("s1", "w1", "sustainability.total"),
      sustainabilitySource("s2", "w2", "sustainability.by_location"),
    ],
    () => siteScope,
    () => {
      throw new Error("no binding in this fixture fails its write schema");
    },
  );
  same(
    [...plan.resolves.values()].map((resolve) => [resolve.key, resolve.scopeKey, resolve.subtree]),
    [
      ["sustainability.total", `location-subtree:${TAB_SITE}`, true],
      ["sustainability.by_location", `location-subtree:${TAB_SITE}`, true],
    ],
    "sustainability resolves on a location dashboard",
  );
}

/** B1's negative: `assets.list` beside them on the same dashboard keeps the per-node key. */
export function anAssetListBindingOnTheSameDashboardKeepsTheNodeScope(): void {
  const plan = planResolves(
    [
      sustainabilitySource("s1", "w1", "sustainability.total"),
      { id: "s2", widgetId: "w2", catalogKey: "assets.list", params: {} },
    ],
    () => siteScope,
    () => {
      throw new Error("no binding in this fixture fails its write schema");
    },
  );
  const keys = [...plan.resolves.values()].map((resolve) => resolve.scopeKey);
  same(
    keys,
    [`location-subtree:${TAB_SITE}`, `location:${TAB_SITE}`],
    "a subtree entry and a per-node entry on one location dashboard",
  );
  assert(new Set(keys).size === 2, "the two scopes must be two distinct keys");
}

/** `F3.73` Task 3.3 — `assets.offline.count` over `[]` is `0` and `assets.list` an empty
 * dataset of its four declared columns, both before any SQL (the `scopeIsEmpty` claim). The
 * enumerating claim above holds that no SQL runs; this one holds the ANSWER. */
export async function assetsEntriesOnAnEmptyScopeAnswerZeroAndEmpty(): Promise<void> {
  const count = await RESOLVERS["assets.offline.count"](refusingTx(), "org", [], noDeps, {});
  same(
    count.shape === "metric" ? count.value : count,
    0,
    "assets.offline.count over []",
  );
  const list = await RESOLVERS["assets.list"](refusingTx(), "org", [], noDeps, {});
  same(
    list.shape === "dataset"
      ? { columns: list.columns, rows: list.rows, truncated: list.truncated }
      : list,
    { columns: ["code", "name", "status", "activeAlarms"], rows: [], truncated: false },
    "assets.list over []",
  );
}

/** `E4.3` U9 — `water.balance` on an empty scope is an empty dataset of its seven columns
 * before any SQL: the location read and the three roll-up reads are all skipped. */
export async function waterBalanceOnAnEmptyScopeBuildsNoSql(): Promise<void> {
  const resolved = await RESOLVERS["water.balance"](refusingTx(), "org", [], noDeps, {
    period: "today",
  });
  same(
    resolved.shape === "dataset" ? { columns: resolved.columns.length, rows: resolved.rows } : resolved,
    { columns: 7, rows: [] },
    "water.balance over []",
  );
}

/**
 * `F2.10` (A6, Drafter choice 8) — `catalogValues`, the HTTP entry point, hands the caller's
 * asset set and location set to `resolveForDashboard` each in its own position. The integration
 * case drives `resolveForDashboard` directly, so this is the only gate on the call: passing
 * `null` for the location set would label a row with a node the caller cannot read, and a swap
 * would resolve over the wrong ids. The two sentinels differ in VALUE, so a swap reddens here.
 */
export async function catalogValuesPassesEachReadableSetInItsOwnPosition(): Promise<void> {
  const assetSentinel = ["asset-sentinel"];
  const locationSentinel = ["location-sentinel"];
  const accessControl = {
    readableOrganizationIds: async () => null,
    readableAssetIds: async () => assetSentinel,
    readableLocationIds: async () => locationSentinel,
  } as unknown as AccessControlService;
  // `select().from().where().limit()` on the fleet pool answers the dashboard row.
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: async () => [{ id: "dash-1", organizationId: "org-1" }],
  };
  const fleetDb = { select: () => chain } as unknown as BmsDb;
  const service = new MetricCatalogService(refusingDb(), fleetDb, accessControl, new AssetHealthService(refusingDb()));

  const calls: unknown[][] = [];
  (service as unknown as { resolveForDashboard: (...args: unknown[]) => Promise<unknown> }).resolveForDashboard =
    async (...args: unknown[]) => {
      calls.push(args);
      return { values: [], resolvedAt: "" };
    };
  await service.catalogValues({ sub: "reader" } as unknown as JwtPayload, "dash-1");

  assert(calls.length === 1, `resolveForDashboard called ${calls.length} times; expected 1`);
  const [organizationId, dashboardId, readableAssetIds, readableLocationIds] = calls[0] as unknown[];
  same([organizationId, dashboardId], ["org-1", "dash-1"], "the dashboard row's organization and id");
  same(readableAssetIds, assetSentinel, "position 3 is readableAssetIds");
  same(readableLocationIds, locationSentinel, "position 4 is readableLocationIds, never null and never the asset set");
}

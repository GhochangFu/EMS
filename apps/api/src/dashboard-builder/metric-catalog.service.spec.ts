import type { BmsDb } from "@bms/db";
import { METRIC_CATALOG, type JwtPayload } from "@bms/shared";
import type { Pool } from "pg";

import { AssetHealthService } from "../asset-health/asset-health.service";
import type { AccessControlService } from "../auth/access-control.service";
import type { BmsTx } from "../database/tenant-context";
import { scopeKeyFor } from "./dashboard-scope-assets";
import {
  MetricCatalogService,
  planResolves,
  RESOLVE_AFTER_COMMIT,
  RESOLVERS,
} from "./metric-catalog.service";

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

/** A pool that refuses every statement — `pue.ratio` (`F4.317`) reads through `deps.pool`. */
const refusingPool = {
  query: () => {
    throw new Error("the resolver queried the pool for an empty scope");
  },
};

const noDeps = {
  health: new AssetHealthService(refusingDb()),
  readableLocationIds: null,
  scopeLocationId: null,
  pool: refusingPool,
  // `F4.332` — the energy-cost entries' tariff read; refuses like the pool.
  tariffs: {
    resolveSeriesForAssets: () => {
      throw new Error("an empty scope must not read tariffs");
    },
  },
} as Parameters<
  (typeof RESOLVERS)["sustainability.total"]
>[3];

/** `F4.317` — a prior instant, for the claims that ask for one. */
const PRIOR_AT = new Date("2031-01-01T00:00:00.000Z");

/** What each entry's parsed params look like — `{}` for the Stage C five, the pair for the two
 * roll-ups, `{ period }` for `water.balance` (`E4.3`). */
const paramsFor = (key: string): unknown =>
  key.startsWith("sustainability.")
    ? { pointKey: "kl_today", aggregate: "sum" }
    : key === "water.balance"
      ? { period: "today" }
      : key === "energy.cost_by_day"
        ? { days: 30 }
        : key === "energy.cost.total"
          ? { period: "this_month" }
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
      const resolved = await RESOLVERS[key](refusingTx(), "org", [], noDeps, paramsFor(key), null);
      if (resolved.key !== key) failures.push(`${key}: answered as ${resolved.key}`);
      // `F4.317` — asking for the prior builds no SQL either.
      const asked = await RESOLVERS[key](refusingTx(), "org", [], noDeps, paramsFor(key), PRIOR_AT);
      if (asked.key !== key) failures.push(`${key} (prior): answered as ${asked.key}`);
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
  }, null);
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
  }, null);
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
    () => false,
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
    () => false,
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
    () => false,
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
  const count = await RESOLVERS["assets.offline.count"](refusingTx(), "org", [], noDeps, {}, null);
  same(
    count.shape === "metric" ? count.value : count,
    0,
    "assets.offline.count over []",
  );
  const list = await RESOLVERS["assets.list"](refusingTx(), "org", [], noDeps, {}, null);
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
  }, null);
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
  const service = new MetricCatalogService(
    refusingDb(),
    fleetDb,
    accessControl,
    new AssetHealthService(refusingDb()),
    refusingPool,
  );

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

/**
 * `F4.317` task 2.2 (ADR 0112 decision 8, ruling Q5) — the resolve key carries whether the tile
 * asks for a prior. Two tiles on one binding, one with `compareToPrevious`, are two resolves (the
 * one that asks pays for the prior read; the other does not); two that do not ask stay one.
 */
const sourcesOnTwoTiles = (catalogKey: string) => [
  { id: "s1", widgetId: "w1", catalogKey, params: {} },
  { id: "s2", widgetId: "w2", catalogKey, params: {} },
];

const plannedPriors = (catalogKey: string, asks: ReadonlySet<string>): boolean[] => {
  const sources = sourcesOnTwoTiles(catalogKey);
  const plan = planResolves(
    sources,
    () => siteScope,
    (widgetId) => asks.has(widgetId),
    () => {
      throw new Error("no binding in this fixture fails its write schema");
    },
  );
  assert(
    sources.every((source) => plan.resolves.has(plan.resolveKeyOf.get(source.id) ?? "")),
    "every source must map to a planned resolve",
  );
  return [...plan.resolves.values()].map((resolve) => resolve.wantsPrior);
};

export function aTileThatAsksForThePriorIsItsOwnResolve(): void {
  same(plannedPriors("alarms.active.count", new Set(["w1"])), [true, false], "one asks, one does not");
  same(plannedPriors("alarms.active.count", new Set()), [false], "neither asks");
  same(plannedPriors("alarms.critical.count", new Set(["w1", "w2"])), [true], "both ask");
}

/** A key with no prior read (`workorders.open.count`) never plans one, whatever the tile asks. */
export function aKeyWithNoPriorNeverPlansOne(): void {
  same(plannedPriors("workorders.open.count", new Set(["w1"])), [false], "workorders.open.count");
}

/**
 * `F4.317` follow-up (d) — an entry that reads ANOTHER pool resolves after the tenant
 * transaction commits, never inside it. `pue.ratio` reads `deps.pool` and `assets.health.score`
 * reads `AssetHealthService` (the fleet Drizzle). Awaited inside the transaction, either one held
 * the tenant connection's locks while it waited for a second connection: with a DDL statement
 * queued between them (the seed's `ALTER TABLE bms.assets` on `docker compose up`) that is a
 * lock cycle Postgres cannot see, and the API hung until the backend was terminated.
 *
 * The fake tenant database records whether its transaction is open; each foreign read records
 * what it saw. Both must see it closed, and both answers must still reach their sources.
 */
export async function aForeignPoolReadRunsAfterTheTenantTransactionCommits(): Promise<void> {
  let open = false;
  const seen: string[] = [];
  const rows = async () => [{ id: "asset-1" }];
  const tx = {
    execute: async () => ({ rows: [] }),
    select: () => ({ from: () => ({ where: rows }) }),
  } as unknown as BmsTx;
  const tenantDb = {
    transaction: async <T>(fn: (inner: BmsTx) => Promise<T>): Promise<T> => {
      open = true;
      try {
        return await fn(tx);
      } finally {
        open = false;
      }
    },
  } as unknown as BmsDb;
  const pool = {
    query: async () => {
      seen.push(`pool ${open ? "inside" : "after"}`);
      return { rows: [{ incomers: 1, site_kw: "150", it_kw: "100" }] };
    },
  } as unknown as Pick<Pool, "query">;
  const health = {
    summary: async () => {
      seen.push(`health ${open ? "inside" : "after"}`);
      return { score: 87 };
    },
  } as unknown as AssetHealthService;
  const service = new MetricCatalogService(tenantDb, refusingDb(), {} as AccessControlService, health, pool);

  const { byId } = await service.resolveBindings(
    "org-1",
    {
      widgets: [
        { id: "w1", tabGroupId: null, widgetType: "value_tile", config: {} },
        { id: "w2", tabGroupId: null, widgetType: "value_tile", config: {} },
      ],
      sources: [
        { id: "s1", widgetId: "w1", catalogKey: "pue.ratio", params: {} },
        { id: "s2", widgetId: "w2", catalogKey: "assets.health.score", params: {} },
      ],
      scope: { assetId: "asset-1", locationId: null, assetGroupId: null },
      capLocationId: null,
    },
    null,
    null,
    "spec",
  );

  same(seen, ["pool after", "health after"], "where each foreign read ran");
  const pue = byId.get("s1");
  const score = byId.get("s2");
  same(pue?.shape === "metric" ? pue.value : pue, 1.5, "pue.ratio reaches its source");
  same(score?.shape === "metric" ? score.value : score, 87, "assets.health.score reaches its source");
}

/** On an empty scope the prior is the live answer's own: `0` for a count, `null` otherwise. */
export async function thePriorOnAnEmptyScopeBuildsNoSql(): Promise<void> {
  const alarms = await RESOLVERS["alarms.critical.count"](refusingTx(), "org", [], noDeps, {}, PRIOR_AT);
  same(
    alarms.shape === "metric" ? alarms.prior : alarms,
    { asOf: PRIOR_AT.toISOString(), value: 0 },
    "alarms.critical.count prior over []",
  );
  const total = await RESOLVERS["sustainability.total"](refusingTx(), "org", [], noDeps, paramsFor("sustainability.total"), PRIOR_AT);
  same(
    total.shape === "metric" ? total.prior : total,
    { asOf: PRIOR_AT.toISOString(), value: null },
    "sustainability.total prior over []",
  );
  const plain = await RESOLVERS["alarms.active.count"](refusingTx(), "org", [], noDeps, {}, null);
  assert(!("prior" in plain), "no priorAt, no prior key");
}

/**
 * F4.317 follow-up (d), the class rule — an entry that reads `deps.pool` or `deps.health`
 * is in `RESOLVE_AFTER_COMMIT`. Every entry runs on a one-asset scope against a permissive
 * transaction (any chain answers an empty result) and a pool and a health service that record
 * a touch. An entry outside the set that touches either fails; the positive twin: each entry
 * IN the set touches one, so the detector sees a real read. A resolver that throws on the
 * empty transaction before it reaches the pool is a gap this claim cannot see.
 */
export async function onlyTheDeferredEntriesReadAForeignPool(): Promise<void> {
  const empty = (): unknown => Object.assign([], { rows: [] });
  const permissive: unknown = new Proxy(function permissive() {}, {
    get: (_target, prop) =>
      prop === "then"
        ? (resolve: (value: unknown) => void) => resolve(empty())
        : permissive,
    apply: () => permissive,
  });
  const keys = Object.keys(METRIC_CATALOG) as (keyof typeof RESOLVERS)[];
  const outside: string[] = [];
  const silent: string[] = [];
  for (const key of keys) {
    let touched = false;
    const deps = {
      ...noDeps,
      pool: {
        query: async () => {
          touched = true;
          return { rows: [] };
        },
      },
      health: {
        summary: async () => {
          touched = true;
          return { score: null };
        },
      },
    } as unknown as typeof noDeps;
    try {
      await RESOLVERS[key](permissive as BmsTx, "org", ["asset-1"], deps, paramsFor(key), PRIOR_AT);
    } catch {
      // The permissive transaction is not a database; only the touch is the claim.
    }
    if (RESOLVE_AFTER_COMMIT.has(key)) {
      if (!touched) silent.push(key);
    } else if (touched) {
      outside.push(key);
    }
  }
  same(outside, [], "entries outside RESOLVE_AFTER_COMMIT that read the fleet pool or health");
  same(silent, [], "RESOLVE_AFTER_COMMIT entries the detector saw no foreign read from");
}

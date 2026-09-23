import type { BmsDb } from "@bms/db";
import { METRIC_CATALOG } from "@bms/shared";

import { AssetHealthService } from "../asset-health/asset-health.service";
import type { BmsTx } from "../database/tenant-context";
import { RESOLVERS } from "./metric-catalog.service";

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

const noDeps = { health: new AssetHealthService(refusingDb()) } as Parameters<
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

import { describe, it } from "vitest";

import {
  aForeignPoolReadRunsAfterTheTenantTransactionCommits,
  aKeyWithNoPriorNeverPlansOne,
  aSustainabilityBindingOnALocationDashboardPlansASubtreeScope,
  aTileThatAsksForThePriorIsItsOwnResolve,
  anAssetListBindingOnTheSameDashboardKeepsTheNodeScope,
  assetsEntriesOnAnEmptyScopeAnswerZeroAndEmpty,
  byLocationOnAnEmptyScopeBuildsNoSql,
  catalogValuesPassesEachReadableSetInItsOwnPosition,
  everyEntryOnAnEmptyScopeBuildsNoSql,
  onlyTheDeferredEntriesReadAForeignPool,
  overviewAndGroupTabAreTwoResolves,
  sameKeyOnOneTabIsOneResolve,
  sameKeyOnTwoGroupTabsIsTwoResolves,
  scopeKeyFollowsTheResolverArmOrder,
  thePriorOnAnEmptyScopeBuildsNoSql,
  totalOnAnEmptyScopeBuildsNoSql,
  waterBalanceOnAnEmptyScopeBuildsNoSql,
} from "./metric-catalog.service.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E4.2 sweep — the catalog's resolvers on an empty scope (no database)", () => {
  it("sustainability.total answers 0/0, null, no unit, no currency before any SQL", async () => {
    await totalOnAnEmptyScopeBuildsNoSql();
  });

  it("sustainability.by_location answers an empty dataset before any SQL (the control)", async () => {
    await byLocationOnAnEmptyScopeBuildsNoSql();
  });

  it("water.balance answers an empty seven-column dataset before any SQL (E4.3)", async () => {
    await waterBalanceOnAnEmptyScopeBuildsNoSql();
  });

  it("assets.offline.count answers 0 and assets.list an empty four-column dataset before any SQL (F3.73)", async () => {
    await assetsEntriesOnAnEmptyScopeAnswerZeroAndEmpty();
  });

  it("every catalog entry answers an empty scope before any SQL (the sentence over RESOLVERS)", async () => {
    await everyEntryOnAnEmptyScopeBuildsNoSql();
  });
});

describe("F3.73 — the catalog dedupe key carries the widget's scope (no database)", () => {
  it("one key on two tabs bound to two groups is two resolves", () => {
    sameKeyOnTwoGroupTabsIsTwoResolves();
  });

  it("one key twice on one tab is one resolve", () => {
    sameKeyOnOneTabIsOneResolve();
  });

  it("an Overview tile beside a group tile is two resolves", () => {
    overviewAndGroupTabAreTwoResolves();
  });

  it("scopeKeyFor follows resolveAssetScope's arm order", () => {
    scopeKeyFollowsTheResolverArmOrder();
  });
});

describe("F2.10 — the two sustainability entries resolve a location dashboard over its subtree (B1, no database)", () => {
  it("sustainability.total and by_location on a location dashboard plan location-subtree:<id>", () => {
    aSustainabilityBindingOnALocationDashboardPlansASubtreeScope();
  });

  it("assets.list on the same dashboard keeps location:<id> — two distinct scope keys", () => {
    anAssetListBindingOnTheSameDashboardKeepsTheNodeScope();
  });
});

describe("F2.10 — catalogValues passes the reader's two readable sets in their own positions (A6, no database)", () => {
  it("resolveForDashboard gets readableAssetIds third and readableLocationIds fourth", async () => {
    await catalogValuesPassesEachReadableSetInItsOwnPosition();
  });
});

describe("F4.317 — a prior is planned only for a tile that asks (decision 8, Q5, no database)", () => {
  it("a tile with compareToPrevious beside one without is two resolves; neither asking is one", () => {
    aTileThatAsksForThePriorIsItsOwnResolve();
  });

  it("a key with no prior read never plans one", () => {
    aKeyWithNoPriorNeverPlansOne();
  });

  it("the prior on an empty scope builds no SQL and carries the live answer's empty value", async () => {
    await thePriorOnAnEmptyScopeBuildsNoSql();
  });
});

describe("F4.317 follow-up (d) — a foreign-pool read never waits inside the tenant transaction (no database)", () => {
  it("pue.ratio and assets.health.score resolve after the commit and still reach their sources", async () => {
    await aForeignPoolReadRunsAfterTheTenantTransactionCommits();
  });

  it("only the RESOLVE_AFTER_COMMIT entries read the fleet pool or the health service", async () => {
    await onlyTheDeferredEntriesReadAForeignPool();
  });
});

import type pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";
import type { BmsDb } from "@bms/db";

import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import {
  assertBreakerRowsAreCapped,
  assertDashboardReadHasNoBreakers,
  assertGrantedGroupHasItsBreaker,
  assertGroupDashboardWithNoTabHasBreakers,
  assertLocationOverviewStillHasNoBreakers,
  assertUngrantedGroupHasNoBreakers,
  assertOverviewHasNoStateMaps,
  assertOverviewTabHasNoBreakers,
  assertPointLatestAndFreshness,
  assertPointsAreTheTableKeysAndStateKeys,
  assertRatingAndTripCausePassThrough,
  assertRoleLabelIsTheVocabularyLabel,
  assertRowCarriesItsAlarms,
  assertRowsAreByRoleSortOrderThenCode,
  assertStateMapsHoldTheKeysSeen,
  assertUnreadableBreakerIsAbsent,
  assertUnregisteredBreakerHasNoPoints,
  assertUnrestrictedReaderSeesEveryBreaker,
  assertUnsetRatingAndTripCauseAreNull,
} from "./site-widgets.breakers.integration.spec";

/**
 * `F3.74` (plan D8, Task 4.2) — Vitest entry point for the `breakers` rows of the site-widgets
 * read against a real database. Assertions live in the sibling `.spec` (ADR 0014); this file owns
 * the pool. Every case is rolled back (see the spec).
 */
const connectionString = requireIntegrationDb({
  item: "F3.74",
  label: "the site-widgets breaker rows",
  because:
    "the role filter and order, the readable-asset narrowing, the point-key selection and the state " +
    "maps are all SQL, so a green run without a database asserts nothing about any of them.",
});

describe.skipIf(!connectionString)("F3.74 — SiteWidgetsService breakers (real database)", () => {
  let pool: pg.Pool;
  let db: BmsDb;

  beforeAll(async () => {
    pool = await openIntegrationPool(connectionString as string, "F3.74");
    db = createDb(pool);
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
  }, 60_000);

  it("B1a rows are by role sort order, then code", () => assertRowsAreByRoleSortOrderThenCode(db), 60_000);
  it("B1b roleLabel is the asset_roles label", () => assertRoleLabelIsTheVocabularyLabel(db), 60_000);
  it("B2a control: the unrestricted reader sees every breaker", () => assertUnrestrictedReaderSeesEveryBreaker(db), 60_000);
  it("B2b an unreadable breaker is absent", () => assertUnreadableBreakerIsAbsent(db), 60_000);
  it("B3a rating and tripCause pass through", () => assertRatingAndTripCausePassThrough(db), 60_000);
  it("B3b unset rating and tripCause are null", () => assertUnsetRatingAndTripCauseAreNull(db), 60_000);
  it("B4a points are the table keys and the active state keys", () => assertPointsAreTheTableKeysAndStateKeys(db), 60_000);
  it("B4b a sample reaches latest and freshness", () => assertPointLatestAndFreshness(db), 60_000);
  it("B4c a breaker with no registered point has no points", () => assertUnregisteredBreakerHasNoPoints(db), 60_000);
  it("B5a the Overview tab has no breakers", () => assertOverviewTabHasNoBreakers(db), 60_000);
  it("B5b the dashboard's own read has no breakers", () => assertDashboardReadHasNoBreakers(db), 60_000);
  it("B6a stateMaps hold the state keys seen", () => assertStateMapsHoldTheKeysSeen(db), 60_000);
  it("B6b the Overview has no stateMaps", () => assertOverviewHasNoStateMaps(db), 60_000);
  it("B7 a row carries its alarm count and top alarm", () => assertRowCarriesItsAlarms(db), 60_000);
  it("B8a a group dashboard with no tab has its group's breakers", () => assertGroupDashboardWithNoTabHasBreakers(db), 60_000);
  it("B8b a location dashboard's Overview still has no breakers", () => assertLocationOverviewStillHasNoBreakers(db), 60_000);
  it("B2c a reader with no grant on the tab's group gets no breakers", () => assertUngrantedGroupHasNoBreakers(db), 60_000);
  it("B2d control: a grant on the tab's group gets its breaker", () => assertGrantedGroupHasItsBreaker(db), 60_000);
  it("B9 the breaker rows are capped at MAX_SITE_BREAKER_ROWS", () => assertBreakerRowsAreCapped(db), 60_000);
});

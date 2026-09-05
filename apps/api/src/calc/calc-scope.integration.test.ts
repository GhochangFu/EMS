import pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import { loadFixtures, type Fixtures } from "../admin/asset-templates/asset-templates.instantiate.integration.spec";
import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import { registerFixturePointKeys } from "../testing/integration-fixtures";
import {
  assertAnUnknownOwnerResolvesToNullAndEmpty,
  assertDomainNarrowsToTheDeclarersInThatDomain,
  assertGroupResolvesAtTheOwnersLocationOnly,
  assertNoCrossRefsQueriesNothing,
  assertQualifiedCodesAreContainedByTheOwnersLocation,
  assertSiteIncludesAMappedHandCreatedAsset,
  assertSiteIncludesTheOwner,
  assertSiteIsExactlyTheDeclarersAtTheOwnersLocation,
  cleanup,
  FIXTURE_POINT_KEY,
  seedScopeFixture,
  type ScopeFixture,
} from "./calc-scope.integration.spec";

/**
 * `F2.9` Task 11 — Vitest entry point for `CalcScopeService`. Assertions live
 * in the sibling `.spec` (ADR 0014); this file owns the database lifecycle.
 * The fixture is read-only once seeded, so it is built once in `beforeAll`.
 */

const connectionString = requireIntegrationDb({
  item: "F2.9",
  label: "calc scope resolver tests",
  because:
    "the location-contained membership and qualified-code reads — the (location_id, code) " +
    "group uniqueness, the declares-by-template-or-mapping disjunction, the active filter — " +
    "are database behaviours a pure test cannot check.",
});

describe.skipIf(!connectionString)("F2.9 — calc scope resolver", () => {
  let pool: pg.Pool | undefined;
  let fx: Fixtures;
  let fixture: ScopeFixture;
  let removeFixtureKeys: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    const created = await openIntegrationPool(connectionString as string, "F2.9");
    pool = created;
    fx = await loadFixtures(created);
    await cleanup(created);
    // `F3.42`: `template_points.point_key` and `asset_points.point_key` are
    // foreign keys into the catalog; the fixture's key must exist first.
    removeFixtureKeys = await registerFixturePointKeys(created, [FIXTURE_POINT_KEY]);
    fixture = await seedScopeFixture(created, fx);
  });

  afterAll(async () => {
    if (pool) {
      await cleanup(pool);
      // After `cleanup`, which removes the rows that reference the key.
      if (removeFixtureKeys) {
        await removeFixtureKeys();
      }
      await pool.end();
    }
  });

  it("@site on X includes X itself — the self-reading site sum is a visible one-edge cycle", async () => {
    if (!pool) throw new Error("pool required");
    await assertSiteIncludesTheOwner(pool, fixture);
  });

  it("@site on X includes Z, declared only by an active asset_points row", async () => {
    if (!pool) throw new Error("pool required");
    await assertSiteIncludesAMappedHandCreatedAsset(pool, fixture);
  });

  it("@site on X is exactly {X, Y, Z}: W (location 2), F (foreign org), V (no declaration) and I (inactive) excluded", async () => {
    if (!pool) throw new Error("pool required");
    await assertSiteIsExactlyTheDeclarersAtTheOwnersLocation(pool, fixture);
  });

  it("@domain('hvac') on X is exactly {Y}", async () => {
    if (!pool) throw new Error("pool required");
    await assertDomainNarrowsToTheDeclarersInThatDomain(pool, fixture);
  });

  it("@group resolves the code at the owner's location only — two groups, one code, two answers in one call", async () => {
    if (!pool) throw new Error("pool required");
    await assertGroupResolvesAtTheOwnersLocationOnly(pool, fixture);
  });

  it("a qualified code resolves at the owner's location only: W and F are null, present; Y is its id", async () => {
    if (!pool) throw new Error("pool required");
    await assertQualifiedCodesAreContainedByTheOwnersLocation(pool, fixture);
  });

  it("an owner with no asset row resolves to null and [] with every key present", async () => {
    if (!pool) throw new Error("pool required");
    await assertAnUnknownOwnerResolvesToNullAndEmpty(pool, fixture);
  });

  it("no cross references → empty maps and no query", async () => {
    await assertNoCrossRefsQueriesNothing(fixture);
  });
});

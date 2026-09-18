import pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import { loadFixtures, type Fixtures } from "../admin/asset-templates/asset-templates.instantiate.integration.spec";
import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import {
  assertAForeignAssetIsNotServedByAnotherOrganization,
  assertAnotherLocationSeesTheOrganizationRowOnly,
  assertAnUnsetKeyIsAbsentNotZero,
  assertListKeysReturnsTheActiveVocabularyInOrder,
  assertNearestScopeWinsAtEachInstant,
  assertNoPairsQueriesNothing,
  assertOneStatementServesEveryPair,
  assertUnknownKeysNamesTheMissingAndTheInactive,
  assertValidityIsHalfOpen,
  cleanup,
  seedParametersFixture,
  type ParametersFixture,
} from "./calc-parameters.integration.spec";

/**
 * `E4.1a` U5 — Vitest entry point for `CalcParametersService`. Assertions
 * live in the sibling `.spec` (ADR 0014); this file owns the database
 * lifecycle. The fixture is read-only once seeded (one case adds and removes
 * its own row), so it is built once in `beforeAll`.
 */

const connectionString = requireIntegrationDb({
  item: "E4.1a",
  label: "calc parameter resolver tests",
  because:
    "nearest-scope resolution across a half-open validity window, organization containment and " +
    "the absence of any default value are database behaviours a pure test cannot check.",
});

describe.skipIf(!connectionString)("E4.1a — calc parameter resolver", () => {
  let pool: pg.Pool | undefined;
  let fx: Fixtures;
  let fixture: ParametersFixture;

  beforeAll(async () => {
    const created = await openIntegrationPool(connectionString as string, "E4.1a");
    pool = created;
    fx = await loadFixtures(created);
    await cleanup(created);
    fixture = await seedParametersFixture(created, fx);
  });

  afterAll(async () => {
    if (pool) {
      await cleanup(pool);
      await pool.end();
    }
  });

  it("nearest scope wins at three instants across an effective_to: location, then asset, then organization", async () => {
    if (!pool) throw new Error("pool required");
    await assertNearestScopeWinsAtEachInstant(pool, fixture);
  });

  it("validity is half-open [effective_from, effective_to)", async () => {
    if (!pool) throw new Error("pool required");
    await assertValidityIsHalfOpen(pool, fixture);
  });

  it("an asset at another location in the same organization sees the organization row only", async () => {
    if (!pool) throw new Error("pool required");
    await assertAnotherLocationSeesTheOrganizationRowOnly(pool, fixture);
  });

  it("an asset in another organization is absent — containment is in the statement", async () => {
    if (!pool) throw new Error("pool required");
    await assertAForeignAssetIsNotServedByAnotherOrganization(pool, fixture);
  });

  it("a key with no row in scope has no entry — never 0", async () => {
    if (!pool) throw new Error("pool required");
    await assertAnUnsetKeyIsAbsentNotZero(pool, fixture);
  });

  it("two assets × two keys is one statement with four entries", async () => {
    if (!pool) throw new Error("pool required");
    await assertOneStatementServesEveryPair(pool, fixture);
  });

  it("no pairs → no query", async () => {
    await assertNoPairsQueriesNothing();
  });

  it("unknownKeys names the codes not present-and-active", async () => {
    if (!pool) throw new Error("pool required");
    await assertUnknownKeysNamesTheMissingAndTheInactive(pool);
  });

  it("listKeys returns the active vocabulary in sort_order, code order", async () => {
    if (!pool) throw new Error("pool required");
    await assertListKeysReturnsTheActiveVocabularyInOrder(pool);
  });
});

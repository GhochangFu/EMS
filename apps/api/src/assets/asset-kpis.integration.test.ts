import type pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import { loadFixtures } from "../admin/asset-templates/asset-templates.instantiate.integration.spec";
import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import { registerFixturePointKeys } from "../testing/integration-fixtures";
import {
  assertAnAbsentAssetIsNotFound,
  assertASilentMemberIsCountedNeverNamed,
  assertV1IsTheOwnersLatestValue,
  assertV2SumsTheOwnersLocationOnly,
  cleanup,
  FIXTURE_POINT_KEY,
  seedKpiFixture,
  type KpiFixture,
} from "./asset-kpis.integration.spec";

/**
 * `F2.33` — Vitest entry point for the KPI read host against a real database.
 * Assertions live in the sibling `.spec` (ADR 0014); this file owns the
 * database lifecycle.
 */

const connectionString = requireIntegrationDb({
  item: "F2.33",
  label: "asset KPI read host tests",
  because:
    "the template read, the location-contained @site membership and the latest-sample read are " +
    "database behaviours; the unit spec fakes all three.",
});

describe.skipIf(!connectionString)("F2.33 — asset KPI read host (integration)", () => {
  let pool: pg.Pool | undefined;
  let fixture: KpiFixture;
  let removeFixtureKeys: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    const created = await openIntegrationPool(connectionString as string, "F2.33");
    pool = created;
    const fx = await loadFixtures(created);
    await cleanup(created);
    removeFixtureKeys = await registerFixturePointKeys(created, [FIXTURE_POINT_KEY]);
    fixture = await seedKpiFixture(created, fx);
  });

  afterAll(async () => {
    if (pool) {
      await cleanup(pool);
      if (removeFixtureKeys) {
        await removeFixtureKeys();
      }
      await pool.end();
    }
  });

  it("v1 is the owner's latest value", () => assertV1IsTheOwnersLatestValue(pool as pg.Pool, fixture));
  it("v2 @site sums the owner's location only", () => assertV2SumsTheOwnersLocationOnly(pool as pg.Pool, fixture));
  it("a silent member is counted as excluded and never named", () =>
    assertASilentMemberIsCountedNeverNamed(pool as pg.Pool, fixture));
  it("an absent asset is a 404", () => assertAnAbsentAssetIsNotFound(pool as pg.Pool));
});

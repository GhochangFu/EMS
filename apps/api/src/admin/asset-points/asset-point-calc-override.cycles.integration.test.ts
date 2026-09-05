import pg from "pg";

import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

import { createDb } from "@bms/db";

import { AccessControlService } from "../../auth/access-control.service";
import { CalcDefinitionsService } from "../../calc/calc-definitions.service";
import { CalcDependencyService } from "../../calc/calc-dependency.service";
import { CalcScopeService } from "../../calc/calc-scope.service";
import { MetricsService } from "../../observability/metrics.service";
import { openIntegrationPool, requireIntegrationDb } from "../../testing/integration-db-gate";
import { registerFixturePointKeys } from "../../testing/integration-fixtures";
import { loadFixtures, type Fixtures } from "../asset-templates/asset-templates.instantiate.integration.spec";
import { MasterDataAuditService } from "../master-data-audit.service";
import { AssetPointCalcOverrideService } from "./asset-point-calc-override.service";
import {
  KEY_KW,
  KEY_MEASURED,
  KEY_TOTAL,
  assertQualifiedReferenceIsConfinedToLocation,
  assertV2OverrideRefusesAMembershipCycle,
  cleanup,
} from "./asset-point-calc-override.cycles.integration.spec";

/**
 * `F2.9` Task 12 — Vitest entry point for the save-time cycle detector on the
 * override path. Assertions live in the sibling `.spec` (ADR 0014); this file
 * owns the database lifecycle.
 */
const connectionString = requireIntegrationDb({
  item: "F2.9",
  label: "bms-calc-v2 override cycle tests",
  because:
    "the cycles here exist in no single formula. `sum({KW} @site)` becomes an edge only " +
    "because another asset sits at the owner's location and declares the key, and a " +
    "{CODE.key} resolves only at that location — both are facts about rows in bms.assets " +
    "and bms.template_points that CalcScopeService reads. A stub cannot produce them, and a " +
    "detector that silently resolved nothing would accept every cycle while looking green.",
});

describe.skipIf(!connectionString)("F2.9 — bms-calc-v2 override cycle refusal", () => {
  let pool: pg.Pool | undefined;
  let svc: AssetPointCalcOverrideService;
  let fx: Fixtures;
  let releasePointKeys: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    const created = await openIntegrationPool(connectionString as string, "F2.9");
    pool = created;
    // `F3.39`: `asset_points.point_key` references `point_keys(code)` from
    // migration `0057`.
    releasePointKeys = await registerFixturePointKeys(created, [KEY_MEASURED, KEY_KW, KEY_TOTAL]);
    const db = createDb(created);
    svc = new AssetPointCalcOverrideService(
      db,
      db,
      new AccessControlService(db, db),
      new MasterDataAuditService(db, db),
      new CalcDependencyService(db, new CalcDefinitionsService(db, new MetricsService()), new CalcScopeService(db)),
    );
    fx = await loadFixtures(created);
    await cleanup(created);
  });

  afterAll(async () => {
    if (pool) {
      await cleanup(pool);
      await releasePointKeys?.();
      await pool.end();
    }
  });

  beforeEach(async () => {
    if (pool) {
      await cleanup(pool);
    }
  });

  it("refuses a v2 override that closes a cycle through @site membership, writing nothing", async () => {
    if (!pool) throw new Error("pool required");
    await assertV2OverrideRefusesAMembershipCycle(pool, fx, svc);
  });

  it("resolves {CODE.key} only at the owner's location (ADR 0055 decision 12)", async () => {
    if (!pool) throw new Error("pool required");
    await assertQualifiedReferenceIsConfinedToLocation(pool, fx, svc);
  });
});

import pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import { openIntegrationPool, requireIntegrationDb } from "../../testing/integration-db-gate";
import {
  assertAssetPointsChecksRefuseBadRows,
  assertColumnsMirrorAcrossTables,
  assertExistingRowsReadNullAndAreNonVacuous,
  assertPointMetadataColumnsExistAndAreNullable,
  assertSixCheckConstraintsExist,
  assertTemplatePointsChecksRefuseBadRows,
} from "./point-metadata-columns.integration.spec";

/**
 * `F2.7` Unit B — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns the database lifecycle.
 */
const connectionString = requireIntegrationDb({
  item: "F2.7",
  label: "point-metadata column and CHECK tests",
  because:
    "migration 0063 is the only thing that puts scale_multiplier, scale_offset, " +
    "eng_min, eng_max and quality_policy on bms.template_points and " +
    "bms.asset_points, and drizzle silently skips a .sql file its journal " +
    "omits. Without a database this suite cannot tell a landed migration from " +
    "a Drizzle schema object that merely claims the columns — and the ingest " +
    "host's BINDING_QUERY (Unit D) reads the real ones.",
});

describe.skipIf(!connectionString)("bms.template_points / bms.asset_points point-metadata columns", () => {
  let pool: pg.Pool | undefined;

  beforeAll(async () => {
    pool = await openIntegrationPool(connectionString as string, "F2.7");
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("adds the five columns to both tables, nullable, without a default, mirrored across the two tables", async () => {
    await assertPointMetadataColumnsExistAndAreNullable(pool as pg.Pool);
    await assertColumnsMirrorAcrossTables(pool as pg.Pool);
  });

  it("adds all six within-row CHECK constraints, each on the table it names", async () => {
    await assertSixCheckConstraintsExist(pool as pg.Pool);
  });

  it("refuses an inverted range, a zero multiplier and an unknown policy on template_points", async () => {
    await assertTemplatePointsChecksRefuseBadRows(pool as pg.Pool);
  });

  it("refuses an inverted range, a zero multiplier and an unknown policy on asset_points", async () => {
    await assertAssetPointsChecksRefuseBadRows(pool as pg.Pool);
  });

  it("leaves every pre-existing row reading NULL across all five, non-vacuously", async () => {
    await assertExistingRowsReadNullAndAreNonVacuous(pool as pg.Pool);
  });
});

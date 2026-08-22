import pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import { openIntegrationPool, requireIntegrationDb } from "../../testing/integration-db-gate";
import {
  assertCalcOverrideColumnsExistAndAreNullable,
  assertColumnsMirrorTemplatePoints,
  assertNoExistingRowGainedAnOverride,
} from "./asset-point-calc-columns.integration.spec";

/**
 * `F2.6` U1 — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns the database lifecycle.
 */
const connectionString = requireIntegrationDb({
  item: "F2.6",
  label: "asset_points calc override column tests",
  because:
    "migration 0037 is the only thing that puts formula, formula_dialect, " +
    "calc_trigger, calc_interval_seconds and max_input_age_seconds on " +
    "bms.asset_points, and drizzle silently skips a .sql file its journal " +
    "omits. Without a database this suite cannot tell a landed migration from " +
    "a Drizzle schema object that merely claims the columns — and the " +
    "resolution merge reads the real ones.",
});

describe.skipIf(!connectionString)("bms.asset_points calc override columns", () => {
  let pool: pg.Pool | undefined;

  beforeAll(async () => {
    pool = await openIntegrationPool(connectionString as string, "F2.6");
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("adds all five columns, nullable and without a default", async () => {
    await assertCalcOverrideColumnsExistAndAreNullable(pool as pg.Pool);
  });

  it("mirrors the type and width of the template_points columns it coalesces with", async () => {
    await assertColumnsMirrorTemplatePoints(pool as pg.Pool);
  });

  it("leaves every pre-existing non-computed row reading NULL across all five", async () => {
    await assertNoExistingRowGainedAnOverride(pool as pg.Pool);
  });
});

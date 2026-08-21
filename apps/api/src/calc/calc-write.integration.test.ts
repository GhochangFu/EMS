import pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import { loadFixtures, type Fixtures } from "../admin/asset-templates/asset-templates.instantiate.integration.spec";
import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import {
  assertFirstValueCreatesMappingWithComputedProvenance,
  assertNoAuditLogRowIsProduced,
  assertOverlongPointKeySkipsOnlyThatPairNotTheBatch,
  assertRewritingTheSameInstantIsANoOp,
  assertSecondValueDoesNotCreateASecondMapping,
  cleanup,
} from "./calc-write.integration.spec";

/**
 * `F2.4` — Vitest entry point for `CalcWriteService`. Assertions live in the
 * sibling `.spec` (ADR 0014); this file owns the database lifecycle.
 */

const connectionString = requireIntegrationDb({
  item: "F2.4",
  label: "calc write service tests",
  because:
    "on-demand computed-provenance mapping creation, the onConflictDoNothing idempotency " +
    "guarantee, and the absence of an audit_log row are database behaviours a pure test cannot check.",
});

describe.skipIf(!connectionString)("F2.4 — calc write service", () => {
  let pool: pg.Pool | undefined;
  let fx: Fixtures;

  beforeAll(async () => {
    const created = await openIntegrationPool(connectionString as string, "F2.4");
    pool = created;
    fx = await loadFixtures(created);
    await cleanup(created);
  });

  afterAll(async () => {
    if (pool) {
      await cleanup(pool);
      await pool.end();
    }
  });

  it("creates the asset_points mapping with computed provenance on the first value", async () => {
    if (!pool) throw new Error("pool required");
    await assertFirstValueCreatesMappingWithComputedProvenance(pool, fx);
  });

  it("does not create a second mapping for a second value on an already-mapped point", async () => {
    if (!pool) throw new Error("pool required");
    await assertSecondValueDoesNotCreateASecondMapping(pool, fx);
  });

  it("treats a rewrite of the same (time, assetId, pointKey) as a no-op, never overwriting", async () => {
    if (!pool) throw new Error("pool required");
    await assertRewritingTheSameInstantIsANoOp(pool, fx);
  });

  it("never produces an audit_log row", async () => {
    if (!pool) throw new Error("pool required");
    await assertNoAuditLogRowIsProduced(pool, fx);
  });

  it("skips only the pair whose synthesised source_data_key overflows the column, not the whole batch", async () => {
    if (!pool) throw new Error("pool required");
    await assertOverlongPointKeySkipsOnlyThatPairNotTheBatch(pool, fx);
  });
});

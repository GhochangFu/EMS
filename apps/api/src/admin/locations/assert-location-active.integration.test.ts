import { randomUUID } from "node:crypto";

import type pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";

import {
  openIntegrationPool,
  requireIntegrationDb,
  resolveIntegrationRoleUrl,
} from "../../testing/integration-db-gate";
import { asRole } from "../../testing/role-urls";
import {
  assertTheHelperAnswersEachState,
  assertTheHelperHoldsTheRowForShare,
  type HelperCtx,
} from "./assert-location-active.integration.spec";
import { buildInactiveFixture, dropInactiveFixture } from "../../testing/location-inactive-fixture";

/**
 * `F2.10` Unit E — Vitest entry point for `assertLocationActive`. Assertions
 * live in the sibling `.spec` (§4.6). The helper runs on a real `bms_tenant`
 * transaction under the GUC, as `withTenant` opens it; the superuser pool
 * writes the fixture and plays the concurrent deactivation.
 */
const PREFIX = "H";

const connectionString = requireIntegrationDb({
  item: "F2.10",
  label: "assertLocationActive reads the location FOR SHARE",
  because:
    "this suite is the only proof that the inactive-location check holds the row against a " +
    "concurrent deactivation (ADR 0098 Amendment 1, A5).",
  connection: "owner",
});

describe.skipIf(!connectionString)("F2.10 — assertLocationActive", () => {
  const run = randomUUID().slice(0, 8);
  const pools: pg.Pool[] = [];
  let ctx: HelperCtx | undefined;
  let superPool: pg.Pool | undefined;

  const use = (): HelperCtx => {
    if (!ctx) throw new Error("F2.10 Unit E: the fixture was not built");
    return ctx;
  };

  beforeAll(async () => {
    const url = connectionString as string;
    superPool = await openIntegrationPool(resolveIntegrationRoleUrl(url, "superuser", process.env), "F2.10");
    pools.push(superPool);
    const tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F2.10",
    );
    pools.push(tenantPool);
    const fx = await buildInactiveFixture(superPool, PREFIX, run);
    ctx = { tenantDb: createDb(tenantPool), superPool, fx };
  });

  afterAll(async () => {
    try {
      if (superPool) await dropInactiveFixture(superPool, PREFIX, run);
    } finally {
      await Promise.all(pools.map((pool) => pool.end()));
    }
  });

  it("E-T1a passes an active location, refuses an inactive one with 409 location_inactive, and 404s an absent one", async () => {
    await assertTheHelperAnswersEachState(use());
  });
  it("E-T1b holds the row FOR SHARE until the tenant transaction ends", async () => {
    await assertTheHelperHoldsTheRowForShare(use());
  });
});

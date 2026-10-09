import { randomUUID } from "node:crypto";

import type pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";

import { AccessControlService } from "../../auth/access-control.service";
import {
  openIntegrationPool,
  requireIntegrationDb,
  resolveIntegrationRoleUrl,
} from "../../testing/integration-db-gate";
import { asRole } from "../../testing/role-urls";
import {
  buildInactiveFixture,
  dropInactiveFixture,
} from "../../testing/location-inactive-fixture";
import { MasterDataAuditService } from "../master-data-audit.service";
import {
  assertCreateOnAnInactiveLocationIsRefused,
  assertReactivateOnAnInactiveLocationIsRefused,
  assertRenameOnAnInactiveLocationIsAllowed,
  type RtuCtx,
} from "./rtus.location-inactive.integration.spec";
import { RtusAdminService } from "./rtus.service";

/**
 * `F2.10` Unit E — Vitest entry point. Assertions live in the sibling `.spec`
 * (§4.6). The service runs on the real `bms_auth`, `bms_tenant` and
 * `bms_fleet` roles; the superuser pool writes the fixture in one per-run
 * organization, which `afterAll` deletes.
 */
const PREFIX = "R";

const connectionString = requireIntegrationDb({
  item: "F2.10",
  label: "RtusAdminService refuses an inactive location",
  because:
    "this suite is the only proof that an RTU create or reactivate onto an inactive location " +
    "is 409 location_inactive while a rename stays allowed (ADR 0098 ruling 15, Amendment 1 A4).",
  connection: "owner",
});

describe.skipIf(!connectionString)("F2.10 — RTUs refuse an inactive location", () => {
  const run = randomUUID().slice(0, 8);
  const pools: pg.Pool[] = [];
  let ctx: RtuCtx | undefined;
  let superPool: pg.Pool | undefined;

  const use = (): RtuCtx => {
    if (!ctx) throw new Error("F2.10 Unit E: the fixture was not built");
    return ctx;
  };

  beforeAll(async () => {
    const url = connectionString as string;
    superPool = await openIntegrationPool(resolveIntegrationRoleUrl(url, "superuser", process.env), "F2.10");
    pools.push(superPool);
    const authPool = await openIntegrationPool(resolveIntegrationRoleUrl(url, "auth", process.env), "F2.10");
    pools.push(authPool);
    const tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F2.10",
    );
    pools.push(tenantPool);
    const fleetPool = await openIntegrationPool(resolveIntegrationRoleUrl(url, "fleet", process.env), "F2.10");
    pools.push(fleetPool);

    const fleetDb = createDb(fleetPool);
    const tenantDb = createDb(tenantPool);
    const svc = new RtusAdminService(
      fleetDb,
      tenantDb,
      new AccessControlService(createDb(authPool), fleetDb),
      new MasterDataAuditService(tenantDb, fleetDb),
    );
    const fx = await buildInactiveFixture(superPool, PREFIX, run);
    ctx = { svc, superPool, fx };
  });

  afterAll(async () => {
    try {
      if (superPool) await dropInactiveFixture(superPool, PREFIX, run);
    } finally {
      await Promise.all(pools.map((pool) => pool.end()));
    }
  });

  it("E-T3a create on an inactive location is 409 location_inactive, with no row and no audit", async () => {
    await assertCreateOnAnInactiveLocationIsRefused(use());
  });
  it("E-T3b reactivate on an inactive location is 409 location_inactive and the RTU stays inactive", async () => {
    await assertReactivateOnAnInactiveLocationIsRefused(use());
  });
  it("E-T3c a rename on an inactive location is allowed (A4)", async () => {
    await assertRenameOnAnInactiveLocationIsAllowed(use());
  });
});

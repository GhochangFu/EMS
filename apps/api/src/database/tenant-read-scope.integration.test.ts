import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { assets, createDb } from "@bms/db";

import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";
import { withTenant } from "./tenant-context";
import {
  assertAdminRunsOnFleet,
  assertEmptyShortCircuitsWithoutQuery,
  assertSingleOrgRunsOnTenantWithGuc,
  assertTwoOrgRunsOnFleet,
  assertUnknownAssetsShortCircuit,
  type ReadScopeFixtures,
} from "./tenant-read-scope.integration.spec";

/**
 * `E7.1b` — Vitest entry point for `withReadScope`. Assertions live in the
 * sibling `.spec` (ADR 0014); this file owns the database lifecycle. It seeds one
 * asset in each of two organizations through `bms_tenant`, then drives the router
 * with a real `bms_tenant`/`bms_fleet` pair.
 *
 * The fixture creates NO location (it reuses seeded active locations), so it
 * cannot re-open the seed-breaker E7.1a closed. Cleanup is by per-run code.
 */
const connectionString = requireIntegrationDb({
  item: "E7.1b",
  label: "withReadScope pool/GUC routing against real, non-owner roles",
  because:
    "withReadScope is the one seam every conformed decision-1 LIST read runs through. Only real " +
    "bms_tenant/bms_fleet connections prove a single-organization actor lands on bms_tenant with its " +
    "org GUC set (decision 1, the RLS backstop) and that an admin or multi-organization actor lands on " +
    "bms_fleet with no GUC (decisions 2/3). A pure test cannot observe current_user or the GUC.",
});

const PREFIX = `E71B-RS-${randomUUID().replace(/-/g, "").slice(0, 12)}-`;

describe.skipIf(!connectionString)("E7.1b — withReadScope routes by resolved organization", () => {
  let fleetPool: pg.Pool;
  let tenantPool: pg.Pool;
  let fx: ReadScopeFixtures;

  beforeAll(async () => {
    const url = connectionString as string;
    fleetPool = await openIntegrationPool(url, "E7.1b"); // fleet (BYPASSRLS) by default
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "E7.1b",
    );

    // Two distinct organizations that each own at least one active location — one
    // asset hangs on each. The DISTINCT-org resolution is what the router keys on.
    const orgs = await fleetPool.query<{ id: string }>(
      `SELECT DISTINCT o.id
         FROM bms.organizations o
         JOIN bms.locations l ON l.organization_id = o.id AND l.active = true
        ORDER BY o.id
        LIMIT 2`,
    );
    if (orgs.rows.length < 2) {
      throw new Error("E7.1b: need two seeded organizations with an active location — run pnpm db:seed.");
    }
    const orgAId = orgs.rows[0].id;
    const orgBId = orgs.rows[1].id;

    const dom = await fleetPool.query<{ code: string }>(
      "SELECT code FROM bms.asset_domains WHERE active = true LIMIT 1",
    );
    if (!dom.rows[0]) {
      throw new Error("E7.1b: no active asset_domain — run pnpm db:seed.");
    }
    const domain = dom.rows[0].code;

    const tenantDb = createDb(tenantPool);

    const seedAsset = async (orgId: string, code: string): Promise<string> => {
      const loc = await fleetPool.query<{ id: string }>(
        `SELECT id FROM bms.locations
           WHERE organization_id = $1 AND active = true ORDER BY created_at, code LIMIT 1`,
        [orgId],
      );
      if (!loc.rows[0]) {
        throw new Error(`E7.1b: organization ${orgId} has no active location — run pnpm db:seed.`);
      }
      return withTenant(tenantDb, orgId, async (tx) => {
        const [asset] = await tx
          .insert(assets)
          .values({
            organizationId: orgId,
            code,
            name: "E7.1b read-scope asset",
            siteName: "E7.1b Site",
            locationId: loc.rows[0].id,
            domain,
            active: true,
          })
          .returning({ id: assets.id });
        return asset.id;
      });
    };

    const assetAId = await seedAsset(orgAId, `${PREFIX}A`);
    const assetBId = await seedAsset(orgBId, `${PREFIX}B`);

    fx = {
      tenantDb,
      fleetDb: createDb(fleetPool),
      orgAId,
      assetAId,
      assetBId,
    };
  });

  afterAll(async () => {
    if (fleetPool) {
      await fleetPool.query(`DELETE FROM bms.assets WHERE code LIKE $1`, [`${PREFIX}%`]);
    }
    await Promise.all([fleetPool, tenantPool].filter(Boolean).map((p) => p.end()));
  });

  it("routes a single-organization actor to bms_tenant with the org GUC set (decision 1)", async () => {
    await assertSingleOrgRunsOnTenantWithGuc(fx);
  });

  it("routes a two-organization actor to bms_fleet with no GUC (decision 3)", async () => {
    await assertTwoOrgRunsOnFleet(fx);
  });

  it("routes the admin sentinel (null) to bms_fleet (decision 2)", async () => {
    await assertAdminRunsOnFleet(fx);
  });

  it("short-circuits an empty scope to onEmpty without a query", async () => {
    await assertEmptyShortCircuitsWithoutQuery(fx);
  });

  it("short-circuits unknown asset ids to onEmpty", async () => {
    await assertUnknownAssetsShortCircuit(fx);
  });
});

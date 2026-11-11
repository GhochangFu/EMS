import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import type pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { assets, createDb, locations } from "@bms/db";

import { AccessControlService } from "../../auth/access-control.service";
import { withTenant } from "../../database/tenant-context";
import { openIntegrationPool, requireIntegrationDb, resolveIntegrationRoleUrl } from "../../testing/integration-db-gate";
import { asRole } from "../../testing/role-urls";
import { SEEDED, jwtFor, primeSeededSubjects } from "../../testing/seeded-subjects";
import { deleteWorkOrderEvents } from "../../testing/work-order-events-cleanup";
import { WorkOrdersService } from "../../work-orders/work-orders.service";
import { MasterDataAuditService } from "../master-data-audit.service";
import {
  assertAPrefixChangeReachesLaterTicketsOnly,
  assertAnUnknownCodeIsNotFound,
  assertOnlyTheGlobalAdminMayReadOrWrite,
  assertTheColumnCheckHoldsThePattern,
  assertTheListAnswersEveryDomain,
  type AssetDomainFixtures,
} from "./asset-domains.service.integration.spec";
import { AssetDomainsAdminService } from "./asset-domains.service";

/**
 * `E3.1` (ADR 0122 rulings P8 and R4) — Vitest entry point. Assertions live in the sibling `.spec` (ADR 0014); this
 * file owns the database lifecycle.
 */
const connectionString = requireIntegrationDb({
  item: "E3.1",
  label: "the asset-domain work-order prefix against real, non-owner roles",
  because:
    "the route's guarantees live in Postgres: the role is read from a real bms.users row, the write and its " +
    "org-less audit row are one real transaction on the fleet pool, the column CHECK holds the pattern, and " +
    "the reference allocator reads the new prefix in a real statement. A fake proves none of them.",
});

// Per-run fixture prefixes (F4.65): randomUUID() sits in each declaration because the
// isolation invariant (tests/integration-fixture-isolation.test.ts) reads it literally.
const FAMILY = "E31-DOM-";
const PREFIX = `${FAMILY}${randomUUID().replace(/-/g, "").slice(0, 12)}-`;
/** The domain this run adds to the platform vocabulary: lower case, as a domain code is written. */
const DOMAIN_FAMILY = "e31d_";
const DOMAIN_PREFIX = `${DOMAIN_FAMILY}${randomUUID().replace(/-/g, "").slice(0, 12)}_`;

/** Deletes what this suite made for the assets matching `like`, children first; the callers delete the assets, locations and domains. */
async function deleteFixtures(fleet: pg.Pool, superuserUrl: string, like: string, olderThanMinutes?: number): Promise<void> {
  const minutes = olderThanMinutes ?? 0;
  const ownAssets = `SELECT id FROM bms.assets WHERE code LIKE $1 AND created_at <= now() - make_interval(mins => $2::integer)`;
  const ownWorkOrders = `SELECT id FROM bms.work_orders WHERE asset_id IN (${ownAssets})`;
  const args = [like, minutes];
  await deleteWorkOrderEvents(superuserUrl, { assetCodeLike: like, olderThanMinutes: minutes });
  await fleet.query(`DELETE FROM bms.audit_log WHERE entity_type = 'work_order' AND entity_id IN (${ownWorkOrders})`, args);
  await fleet.query(`DELETE FROM bms.work_orders WHERE asset_id IN (${ownAssets})`, args);
}

/** Reaps rows a killed earlier run left: every statement is age-bounded, so a run in flight is out of reach. Non-fatal. */
async function sweepStaleRuns(fleet: pg.Pool, superuserUrl: string): Promise<void> {
  try {
    await deleteFixtures(fleet, superuserUrl, `${FAMILY}%`, 30);
    await fleet.query(`DELETE FROM bms.assets WHERE code LIKE $1 AND created_at < now() - interval '30 minutes'`, [`${FAMILY}%`]);
    await fleet.query(`DELETE FROM bms.locations WHERE code LIKE $1 AND created_at < now() - interval '30 minutes'`, [`${FAMILY}%`]);
    await fleet.query(`DELETE FROM bms.audit_log WHERE action = 'master.asset_domain.update' AND payload->>'code' LIKE $1 AND created_at < now() - interval '30 minutes'`, [
      `${DOMAIN_FAMILY}%`,
    ]);
    await fleet.query(`DELETE FROM bms.asset_domains WHERE code LIKE $1 AND created_at < now() - interval '30 minutes'`, [`${DOMAIN_FAMILY}%`]);
  } catch (err) {
    process.stderr.write(
      `[E3.1] could not sweep stale ${FAMILY} rows: ${err instanceof Error ? err.message : String(err)}\n` +
        "        Harmless for this run — fixture codes are per-run — but the rows stay.\n",
    );
  }
}

describe.skipIf(!connectionString)("E3.1 — the asset-domain work-order prefix under real roles", () => {
  let authPool: pg.Pool;
  let tenantPool: pg.Pool;
  let fleetPool: pg.Pool;
  let ctx: AssetDomainFixtures;

  beforeAll(async () => {
    const url = connectionString as string;
    authPool = await openIntegrationPool(process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"), "E3.1");
    tenantPool = await openIntegrationPool(process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"), "E3.1");
    fleetPool = await openIntegrationPool(resolveIntegrationRoleUrl(url, "fleet", process.env), "E3.1");
    await primeSeededSubjects(fleetPool);
    await sweepStaleRuns(fleetPool, resolveIntegrationRoleUrl(url, "superuser", process.env));

    const organizationAdmin = jwtFor(SEEDED.organizationAdmin, "organization_admin");
    const org = await fleetPool.query<{ id: string }>(
      "SELECT a.organization_id AS id FROM bms.user_organization_access a JOIN bms.users u ON u.id = a.user_id WHERE u.email = $1 LIMIT 1",
      [SEEDED.organizationAdmin],
    );
    if (!org.rows[0]) throw new Error(`E3.1: ${SEEDED.organizationAdmin} has no organization grant — run pnpm db:seed.`);
    const organizationId = org.rows[0].id;

    const ownDomain = `${DOMAIN_PREFIX}dom`;
    await fleetPool.query("INSERT INTO bms.asset_domains (code, label, sort_order, active) VALUES ($1, 'E3.1 fixture domain', 9000, true)", [ownDomain]);

    const tenantDb = createDb(tenantPool);
    const fleetDb = createDb(fleetPool);
    const assetId = await withTenant(tenantDb, organizationId, async (tx) => {
      const [loc] = await tx
        .insert(locations)
        .values({
          organizationId,
          code: `${PREFIX}LOC`,
          slug: `${PREFIX.toLowerCase()}loc`,
          name: "E3.1 fixture location",
          type: "smoc_campus",
          latitude: 0,
          longitude: 0,
          active: true,
          updatedAt: sql`now()`,
        })
        .returning({ id: locations.id });
      const [row] = await tx
        .insert(assets)
        .values({ organizationId, code: `${PREFIX}A1`, name: "E3.1 A1", siteName: "E3.1 Site", locationId: loc.id, domain: ownDomain, active: true })
        .returning({ id: assets.id });
      return row.id;
    });

    const audit = new MasterDataAuditService(tenantDb, fleetDb);
    ctx = {
      svc: new AssetDomainsAdminService(fleetDb, new AccessControlService(createDb(authPool), fleetDb), audit),
      workOrders: new WorkOrdersService(fleetDb, tenantDb, audit),
      fleetPool,
      globalAdmin: jwtFor(SEEDED.globalAdmin, "admin"),
      organizationAdmin,
      locationAdmin: jwtFor(SEEDED.locationAdmin, "location_admin"),
      ownDomain,
      assetId,
    };
  });

  afterAll(async () => {
    if (fleetPool) {
      await deleteFixtures(fleetPool, resolveIntegrationRoleUrl(connectionString as string, "superuser", process.env), `${PREFIX}%`);
      await fleetPool.query(`DELETE FROM bms.assets WHERE code LIKE $1`, [`${PREFIX}%`]);
      await fleetPool.query(`DELETE FROM bms.locations WHERE code LIKE $1`, [`${PREFIX}%`]);
      await fleetPool.query(`DELETE FROM bms.audit_log WHERE action = 'master.asset_domain.update' AND payload->>'code' LIKE $1`, [`${DOMAIN_PREFIX}%`]);
      await fleetPool.query(`DELETE FROM bms.asset_domains WHERE code LIKE $1`, [`${DOMAIN_PREFIX}%`]);
    }
    await Promise.all([authPool, tenantPool, fleetPool].filter(Boolean).map((p) => p.end()));
  });

  it("lets only the global admin read the list or write a prefix (403 for a tenant administrator)", async () => {
    await assertOnlyTheGlobalAdminMayReadOrWrite(ctx);
  });

  it("answers every domain with its prefix", async () => {
    await assertTheListAnswersEveryDomain(ctx);
  });

  it("answers 404 for an unknown code", async () => {
    await assertAnUnknownCodeIsNotFound(ctx);
  });

  it("audits the old and the new prefix, and reaches later tickets only", async () => {
    await assertAPrefixChangeReachesLaterTicketsOnly(ctx);
  });

  it("holds the prefix pattern in the column's own CHECK", async () => {
    await assertTheColumnCheckHoldsThePattern(ctx);
  });
});

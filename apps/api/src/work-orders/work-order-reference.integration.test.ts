import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { assetTemplates, assets, createDb, fixtureAssetDomainCode, locations } from "@bms/db";

import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { withTenant } from "../database/tenant-context";
import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";
import { jwtFor, primeSeededSubjects } from "../testing/seeded-subjects";
import {
  assertAForeignSettingCannotTouchTheCounter,
  assertACloseStopsTheSlaClock,
  assertAReferenceDoesNotFollowTheTemplate,
  assertARollbackLeavesNoGap,
  assertATicketWithNoSlaReadsNone,
  assertAnUnseenAssetIsRefused,
  assertConcurrentCreatesGetContiguousNumbers,
  assertEachOrganizationCountsOnItsOwn,
  assertResolvedAtIsStampedOnce,
  assertThePrefixPrecedence,
  assertTheReferenceWidensPastSixDigits,
  assertTheSlaSnapshotFollowsOverridePolicyDefault,
  type WorkOrderReferenceFixtures,
} from "./work-order-reference.integration.spec";
import { WorkOrdersService } from "./work-orders.service";

/**
 * `E3.1` (ADR 0122 decisions 2 and 3) — Vitest entry point. Assertions live in the
 * sibling `.spec` (ADR 0014); this file owns the database lifecycle.
 */
const connectionString = requireIntegrationDb({
  item: "E3.1",
  label: "work-order reference allocator and SLA snapshot against real, non-owner roles",
  because:
    "the allocator's row lock, the counter's WITH CHECK and the SLA policy read are only real under " +
    "bms_tenant, where FORCE row security binds. A mocked database proves none of: twenty concurrent " +
    "creates get twenty contiguous numbers, a second organization cannot bump the first one's counter, " +
    "and the template prefix wins over the domain's.",
});

const ORGANIZATION_ADMIN_EMAIL = "phe-admin@bms.local";

// Per-run fixture prefix (F4.65): randomUUID() sits in PREFIX's own declaration because
// the isolation invariant (tests/integration-fixture-isolation.test.ts) reads it literally.
const FAMILY = "E31-REF-";
const PREFIX = `${FAMILY}${randomUUID().replace(/-/g, "").slice(0, 12)}-`;

describe.skipIf(!connectionString)("E3.1 — work-order reference and SLA snapshot under real RLS", () => {
  let tenantPool: pg.Pool;
  let fleetPool: pg.Pool;
  let ctx: WorkOrderReferenceFixtures;
  let fixtureDomain = "";
  let organizationId = "";
  const createdOrgIds: string[] = [];

  beforeAll(async () => {
    const url = connectionString as string;
    // Twenty concurrent creates each hold a connection while they wait on the counter row.
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "E3.1",
      { max: 8 },
    );
    fleetPool = await openIntegrationPool(
      process.env.DATABASE_URL_FLEET ?? asRole(url, "bms_fleet", "bms_fleet_dev"),
      "E3.1",
    );
    await primeSeededSubjects(fleetPool);
    const actor = jwtFor(ORGANIZATION_ADMIN_EMAIL, "organization_admin");

    // Two organizations of this run's own. The suite asserts exact counter values, so it
    // cannot share an organization with a suite that creates work orders in parallel
    // (the E7.1b work-order and maintenance suites both write in the seeded PHE one).
    const makeOrganization = async (suffix: string): Promise<string> => {
      const created = await fleetPool.query<{ id: string }>(
        "INSERT INTO bms.organizations (code, name, currency) VALUES ($1, $2, 'INR') RETURNING id",
        [`${PREFIX}${suffix}`, `E3.1 reference fixture ${suffix}`],
      );
      const id = created.rows[0]?.id;
      if (!id) throw new Error(`E3.1: fixture organization ${suffix} was not created`);
      createdOrgIds.push(id);
      return id;
    };
    organizationId = await makeOrganization("A");
    const foreignOrgId = await makeOrganization("B");

    const water = await fleetPool.query<{ work_order_prefix: string | null }>(
      "SELECT work_order_prefix FROM bms.asset_domains WHERE code = 'water'",
    );
    if (water.rows[0]?.work_order_prefix !== "WATER") {
      throw new Error("E3.1: the water domain has no WATER prefix — run pnpm db:migrate.");
    }

    // A domain with no prefix, so an asset in it reads GEN. A per-run code, swept below.
    fixtureDomain = fixtureAssetDomainCode("woref");
    await fleetPool.query("INSERT INTO bms.asset_domains (code, label, sort_order) VALUES ($1, $2, 999)", [
      fixtureDomain,
      "E3.1 fixture",
    ]);

    const tenantDb = createDb(tenantPool);
    const fleetDb = createDb(fleetPool);

    const ids = await withTenant(tenantDb, organizationId, async (tx) => {
      const [loc] = await tx
        .insert(locations)
        .values({
          organizationId,
          code: `${PREFIX}LOC`,
          slug: `${PREFIX.toLowerCase()}loc`,
          name: "E3.1 reference location",
          type: "smoc_campus",
          latitude: 0,
          longitude: 0,
          active: true,
          updatedAt: sql`now()`,
        })
        .returning({ id: locations.id });
      const template = async (suffix: string, workOrderPrefix: string | null): Promise<string> => {
        const [row] = await tx
          .insert(assetTemplates)
          .values({
            organizationId,
            code: `${PREFIX}${suffix}`,
            version: 1,
            name: `E3.1 ${suffix}`,
            assetType: "stp",
            domain: "water",
            status: "published",
            workOrderPrefix,
          })
          .returning({ id: assetTemplates.id });
        return row.id;
      };
      const asset = async (suffix: string, domain: string, templateId: string | null): Promise<string> => {
        const [row] = await tx
          .insert(assets)
          .values({
            organizationId,
            code: `${PREFIX}${suffix}`,
            name: `E3.1 ${suffix}`,
            siteName: "E3.1 Site",
            locationId: loc.id,
            domain,
            templateId,
            active: true,
          })
          .returning({ id: assets.id });
        return row.id;
      };
      const stpTemplateId = await template("T-STP", "STP");
      const plainTemplateId = await template("T-PLAIN", null);
      return {
        stpTemplateId,
        stpAssetId: await asset("A-STP", "water", stpTemplateId),
        plainTemplateAssetId: await asset("A-PLAIN", "water", plainTemplateId),
        domainAssetId: await asset("A-DOM", "water", null),
        genAssetId: await asset("A-GEN", fixtureDomain, null),
      };
    });

    const foreignAssetId = await withTenant(tenantDb, foreignOrgId, async (tx) => {
      const [loc] = await tx
        .insert(locations)
        .values({
          organizationId: foreignOrgId,
          code: `${PREFIX}B-LOC`,
          slug: `${PREFIX.toLowerCase()}b-loc`,
          name: "E3.1 reference location B",
          type: "smoc_campus",
          latitude: 0,
          longitude: 0,
          active: true,
          updatedAt: sql`now()`,
        })
        .returning({ id: locations.id });
      const [row] = await tx
        .insert(assets)
        .values({
          organizationId: foreignOrgId,
          code: `${PREFIX}B-DOM`,
          name: "E3.1 B-DOM",
          siteName: "E3.1 Site",
          locationId: loc.id,
          domain: "water",
          active: true,
        })
        .returning({ id: assets.id });
      return row.id;
    });

    ctx = {
      svc: new WorkOrdersService(fleetDb, tenantDb, new MasterDataAuditService(tenantDb, fleetDb)),
      tenantDb,
      fleetPool,
      actor,
      organizationId,
      foreignOrgId,
      foreignAssetId,
      ...ids,
    };
  });

  afterAll(async () => {
    // Children first, on the BYPASSRLS fleet connection, each bounded to this run's own
    // codes or its own two organizations.
    if (fleetPool) {
      await fleetPool.query(
        `DELETE FROM bms.work_orders WHERE asset_id IN (SELECT id FROM bms.assets WHERE code LIKE $1)`,
        [`${PREFIX}%`],
      );
      await fleetPool.query(`DELETE FROM bms.assets WHERE code LIKE $1`, [`${PREFIX}%`]);
      await fleetPool.query(`DELETE FROM bms.asset_templates WHERE code LIKE $1`, [`${PREFIX}%`]);
      await fleetPool.query(`DELETE FROM bms.locations WHERE code LIKE $1`, [`${PREFIX}%`]);
      if (createdOrgIds.length > 0) {
        await fleetPool.query("DELETE FROM bms.work_order_sla_policies WHERE organization_id = ANY($1)", [createdOrgIds]);
        await fleetPool.query("DELETE FROM bms.work_order_counters WHERE organization_id = ANY($1)", [createdOrgIds]);
        await fleetPool.query("DELETE FROM bms.audit_log WHERE organization_id = ANY($1)", [createdOrgIds]);
        await fleetPool.query("DELETE FROM bms.organizations WHERE id = ANY($1)", [createdOrgIds]);
      }
      if (fixtureDomain) {
        await fleetPool.query(`DELETE FROM bms.asset_domains WHERE code = $1`, [fixtureDomain]);
      }
    }
    await Promise.all([tenantPool, fleetPool].filter(Boolean).map((p) => p.end()));
  });

  it("gives twenty concurrent creates twenty contiguous numbers", async () => {
    await assertConcurrentCreatesGetContiguousNumbers(ctx);
  });

  it("counts each organization on its own", async () => {
    await assertEachOrganizationCountsOnItsOwn(ctx);
  });

  it("gives a rolled-back number back", async () => {
    await assertARollbackLeavesNoGap(ctx);
  });

  it("prefers the template prefix, then the domain's, then GEN", async () => {
    await assertThePrefixPrecedence(ctx);
  });

  it("refuses to read or bump a counter under another organization's setting", async () => {
    await assertAForeignSettingCannotTouchTheCounter(ctx);
  });

  it("widens the reference past six digits", async () => {
    await assertTheReferenceWidensPastSixDigits(ctx);
  });

  it("snapshots the SLA from the override, the policy, then the default", async () => {
    await assertTheSlaSnapshotFollowsOverridePolicyDefault(ctx);
  });

  it("reads none for a ticket with no SLA", async () => {
    await assertATicketWithNoSlaReadsNone(ctx);
  });

  it("refuses an asset that is not the organization's, and spends no number", async () => {
    await assertAnUnseenAssetIsRefused(ctx);
  });

  it("stamps resolvedAt once, so a later drag does not turn met into missed", async () => {
    await assertResolvedAtIsStampedOnce(ctx);
  });

  it("stops the SLA clock at close for a ticket closed without being resolved", async () => {
    await assertACloseStopsTheSlaClock(ctx);
  });

  it("keeps a reference when its template's prefix changes", async () => {
    await assertAReferenceDoesNotFollowTheTemplate(ctx);
  });
});

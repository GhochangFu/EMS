import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";

import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { AccessControlService } from "../auth/access-control.service";
import { jwtFor, SEEDED } from "../auth/access-control.integration.spec";
import { openIntegrationPool, requireIntegrationDb, resolveIntegrationRoleUrl } from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";
import { primeSeededSubjects } from "../testing/seeded-subjects";
import { DashboardsService } from "./dashboards.service";
import {
  aMicrosecondStampMatchesItsMilliseconds,
  anUncastableIfMatchIs412NotA500,
  aStaleIfMatchIs412AndWritesNothing,
  noIfMatchAppliesWithoutACompare,
  type PreconditionCtx,
  theLiveIfMatchApplies,
} from "./dashboards.service.precondition.integration.spec";

/**
 * `F4.247` — Vitest entry point. Assertions live in the sibling `.spec` (ADR 0014); this file
 * owns the database lifecycle, this run's dashboards and their cleanup.
 */
const connectionString = requireIntegrationDb({
  item: "F4.247",
  label: "PUT /dashboards/:id/widgets with If-Match",
  because:
    "the conditional stamp, its millisecond text compare and the rollback of a 412 are facts " +
    "about a real Postgres that a fake db cannot prove.",
});

const RUN = randomUUID().replace(/-/g, "").slice(0, 8);

describe.skipIf(!connectionString)("F4.247 — DashboardsService.putWidgets with If-Match (ADR 0099 Amendment 5 C3)", () => {
  let fleetPool: pg.Pool;
  let superuserPool: pg.Pool;
  let tenantPool: pg.Pool;
  let authPool: pg.Pool;
  const dashboardIds: string[] = [];
  let ctx: PreconditionCtx;

  beforeAll(async () => {
    const url = connectionString as string;
    const POOL = { max: 2 } as const;
    fleetPool = await openIntegrationPool(url, "F4.247", POOL);
    await primeSeededSubjects(fleetPool);
    superuserPool = await openIntegrationPool(resolveIntegrationRoleUrl(url, "superuser", process.env), "F4.247", POOL);
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F4.247",
      POOL,
    );
    authPool = await openIntegrationPool(
      process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"),
      "F4.247",
      POOL,
    );
    const fleetDb = createDb(fleetPool);
    const { rows } = await fleetPool.query<{ id: string }>(`SELECT id FROM bms.organizations WHERE code = 'ESKOM'`);
    const eskomOrgId = rows[0]?.id;
    if (!eskomOrgId) throw new Error("F4.247: the ESKOM organization is not seeded — run pnpm db:seed");

    const accessControl = new AccessControlService(createDb(authPool), fleetDb);
    const audit = new MasterDataAuditService(createDb(tenantPool), fleetDb);
    const service = new DashboardsService(createDb(tenantPool), fleetDb, accessControl, audit);
    const actor = jwtFor(SEEDED.globalAdmin, "admin");
    let n = 0;
    ctx = {
      service,
      actor,
      superuserPool,
      newDashboard: async () => {
        n += 1;
        const created = await service.create(actor, {
          organizationId: eskomOrgId,
          slug: `f4247-if-match-${RUN}-${n}`,
          name: "F4.247 If-Match fixture",
        } as Parameters<DashboardsService["create"]>[1]);
        dashboardIds.push(created.id);
        return created.id;
      },
    };
  }, 60_000);

  afterAll(async () => {
    if (dashboardIds.length > 0) {
      await superuserPool.query(`DELETE FROM bms.audit_log WHERE entity_id = ANY($1::uuid[])`, [dashboardIds]);
      await superuserPool.query(`DELETE FROM bms.dashboards WHERE id = ANY($1::uuid[])`, [dashboardIds]);
    }
    await Promise.all([fleetPool, superuserPool, tenantPool, authPool].filter(Boolean).map((p) => p.end()));
  }, 60_000);

  it("applies on the live If-Match and moves updatedAt", async () => {
    await theLiveIfMatchApplies(ctx);
  }, 60_000);

  it("refuses a stale If-Match with 412, writing no widget, no audit row and no stamp", async () => {
    await aStaleIfMatchIs412AndWritesNothing(ctx);
  }, 60_000);

  it("matches a microsecond stamp by its milliseconds", async () => {
    await aMicrosecondStampMatchesItsMilliseconds(ctx);
  }, 60_000);

  it("applies with no If-Match and no compare", async () => {
    await noIfMatchAppliesWithoutACompare(ctx);
  }, 60_000);

  it("answers 412, never 500, for an If-Match Postgres cannot cast", async () => {
    await anUncastableIfMatchIs412NotA500(ctx);
  }, 60_000);
});

import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";

import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { jwtFor, SEEDED } from "../auth/access-control.integration.spec";
import { AccessControlService } from "../auth/access-control.service";
import {
  openIntegrationPool,
  requireIntegrationDb,
  resolveIntegrationRoleUrl,
} from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";
import * as spec from "./mimic-layouts.service.flags.integration.spec";
import type { FlagsCtx } from "./mimic-layouts.service.flags.integration.spec";
import { MimicLayoutsService } from "./mimic-layouts.service";

/**
 * `F3.74` Task 1.6 — Vitest entry point for the layout unit flags on `MimicLayoutsService`
 * against a real database (plan D3b, FL1–FL6). Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns the pools, the fixtures and the cleanup.
 *
 * **Cleanup deletes only rows this suite created, by id** — never a broad `DELETE` (the
 * `F3.37` data-loss finding). The layouts' nodes and pipes cascade.
 */
const connectionString = requireIntegrationDb({
  item: "F3.74",
  label: "MimicLayoutsService fan-out and source flags",
  because:
    "the replace-all reset, the flags CHECK backstop and its 400 translation, and the " +
    "cross-organization 404 are facts about a real connection and real row security.",
});

const RUN = randomUUID().replace(/-/g, "").slice(0, 8);

describe.skipIf(!connectionString)("F3.74 — MimicLayoutsService flags against a live database", () => {
  let ownerPool: pg.Pool;
  let tenantPool: pg.Pool;
  let authPool: pg.Pool;
  let fleetPool: pg.Pool;
  const layoutIds = new Set<string>();
  let ctx: FlagsCtx;

  beforeAll(async () => {
    const url = connectionString as string;
    ownerPool = await openIntegrationPool(resolveIntegrationRoleUrl(url, "superuser", process.env), "F3.74");
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F3.74",
    );
    authPool = await openIntegrationPool(
      process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"),
      "F3.74",
    );
    fleetPool = await openIntegrationPool(url, "F3.74");
    const fleetDb = createDb(fleetPool);

    const row = await ownerPool.query<{ id: string }>(`SELECT id FROM bms.organizations WHERE code = 'ESKOM' LIMIT 1`);
    const eskomOrgId = row.rows[0]?.id;
    if (!eskomOrgId) throw new Error("F3.74: organization ESKOM not found — run pnpm db:seed");

    const tenantDb = createDb(tenantPool);
    const accessControl = new AccessControlService(createDb(authPool), fleetDb);
    const audit = new MasterDataAuditService(tenantDb, fleetDb);
    ctx = {
      service: new MimicLayoutsService(fleetDb, tenantDb, accessControl, audit),
      ownerPool,
      tenantPool,
      eskomOrgId,
      globalAdmin: jwtFor(SEEDED.globalAdmin, "admin"),
      phewbOrgAdmin: jwtFor(SEEDED.organizationAdmin, "organization_admin"),
      slug: (suffix) => `f374-${RUN}-${suffix}`,
      track: (id) => {
        layoutIds.add(id);
      },
    };
  }, 60_000);

  afterAll(async () => {
    if (ownerPool) {
      // Also every layout carrying this run's slug prefix: a refusal case whose guard is broken
      // creates a row it never got the id of.
      const byRun = await ownerPool.query<{ id: string }>(`SELECT id FROM bms.mimic_layouts WHERE slug LIKE $1`, [
        `f374-${RUN}-%`,
      ]);
      const ids = [...new Set([...layoutIds, ...byRun.rows.map((r) => r.id)])];
      if (ids.length > 0) {
        await ownerPool.query(`DELETE FROM bms.audit_log WHERE entity_id = ANY($1::uuid[])`, [ids]);
        await ownerPool.query(`DELETE FROM bms.mimic_layouts WHERE id = ANY($1::uuid[])`, [ids]);
      }
    }
    await Promise.all([ownerPool, tenantPool, authPool, fleetPool].filter(Boolean).map((p) => p.end()));
  }, 60_000);

  it("FL1 a PUT round-trips both flags on GET", async () => {
    await spec.assertAPutRoundTripsBothFlags(ctx);
  }, 60_000);

  it("FL2 a create answers the flags it stored", async () => {
    await spec.assertACreateAnswersTheFlags(ctx);
  }, 60_000);

  it("FL3 a PUT that omits the flags resets a stored true to false", async () => {
    await spec.assertAPutOmittingTheFlagsResetsThem(ctx);
  }, 60_000);

  it("FL4 a direct panel insert with a flag is refused by the CHECK and translates to a 400 without an id", async () => {
    await spec.assertADirectPanelInsertWithAFlagIs400WithoutAnId(ctx);
  }, 60_000);

  it("FL5 a service write of a flagged panel is a 400 and writes nothing", async () => {
    await spec.assertAServiceWriteOfAFlaggedPanelIs400(ctx);
  }, 60_000);

  it("FL6 a flagged layout of another organization is a 404", async () => {
    await spec.assertAFlaggedLayoutOfAnotherOrganizationIs404(ctx);
  }, 60_000);
});

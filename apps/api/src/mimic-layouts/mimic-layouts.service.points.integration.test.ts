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
import * as spec from "./mimic-layouts.service.points.integration.spec";
import type { PointsCtx } from "./mimic-layouts.service.points.integration.spec";
import { MimicLayoutsService } from "./mimic-layouts.service";
import { primeSeededSubjects } from "../testing/seeded-subjects";

/**
 * `F4.307` T4 — Vitest entry point for a unit's point list on `MimicLayoutsService` against a
 * real database (ADR 0081 Amendment 1, plan C7, PT1–PT7). Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns the pools, the fixtures and the cleanup.
 *
 * **Cleanup deletes only rows this suite created, by id or by this run's prefix** — never a broad
 * `DELETE` (the `F3.37` data-loss finding). The layouts' nodes, pipes and point rows cascade; the
 * planted point keys go after the layouts that reference them.
 */
const connectionString = requireIntegrationDb({
  item: "F4.307",
  label: "MimicLayoutsService unit point lists",
  because:
    "the list's order, the replace-all clear, the active-key check with its retired-code " +
    "exemption and the point-key foreign key are facts about a real connection and real row security.",
});

const RUN = randomUUID().replace(/-/g, "").slice(0, 8);

describe.skipIf(!connectionString)("F4.307 — MimicLayoutsService point lists against a live database", () => {
  let ownerPool: pg.Pool;
  let tenantPool: pg.Pool;
  let authPool: pg.Pool;
  let fleetPool: pg.Pool;
  const layoutIds = new Set<string>();
  const pointKeyCodes: string[] = [];
  let ctx: PointsCtx;

  beforeAll(async () => {
    const url = connectionString as string;
    ownerPool = await openIntegrationPool(resolveIntegrationRoleUrl(url, "superuser", process.env), "F4.307");
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F4.307",
    );
    authPool = await openIntegrationPool(
      process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"),
      "F4.307",
    );
    fleetPool = await openIntegrationPool(url, "F4.307");
    // F3.78: jwtFor carries the real bms.users.id as sub (ADR 0089 decision 4).
    await primeSeededSubjects(fleetPool);
    const fleetDb = createDb(fleetPool);

    const row = await ownerPool.query<{ id: string }>(`SELECT id FROM bms.organizations WHERE code = 'ESKOM' LIMIT 1`);
    const eskomOrgId = row.rows[0]?.id;
    if (!eskomOrgId) throw new Error("F4.307: organization ESKOM not found — run pnpm db:seed");

    const plantPointKey = async (suffix: string): Promise<string> => {
      const code = `f4307_${RUN}_${suffix}`;
      await ownerPool.query(`INSERT INTO bms.point_keys (code, name, active) VALUES ($1, $2, true)`, [
        code,
        `F4.307 ${suffix}`,
      ]);
      pointKeyCodes.push(code);
      return code;
    };
    const keys = [await plantPointKey("a"), await plantPointKey("b"), await plantPointKey("c")] as const;

    const tenantDb = createDb(tenantPool);
    const accessControl = new AccessControlService(createDb(authPool), fleetDb);
    const audit = new MasterDataAuditService(tenantDb, fleetDb);
    ctx = {
      service: new MimicLayoutsService(fleetDb, tenantDb, accessControl, audit),
      ownerPool,
      eskomOrgId,
      globalAdmin: jwtFor(SEEDED.globalAdmin, "admin"),
      keys,
      plantPointKey,
      slug: (suffix) => `f4307-${RUN}-${suffix}`,
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
        `f4307-${RUN}-%`,
      ]);
      const ids = [...new Set([...layoutIds, ...byRun.rows.map((r) => r.id)])];
      if (ids.length > 0) {
        await ownerPool.query(`DELETE FROM bms.audit_log WHERE entity_id = ANY($1::uuid[])`, [ids]);
        await ownerPool.query(`DELETE FROM bms.mimic_layouts WHERE id = ANY($1::uuid[])`, [ids]);
      }
      // After the layouts: their point rows reference these codes, and cascade with them.
      if (pointKeyCodes.length > 0) {
        await ownerPool.query(`DELETE FROM bms.point_keys WHERE code = ANY($1::text[])`, [pointKeyCodes]);
      }
    }
    await Promise.all([ownerPool, tenantPool, authPool, fleetPool].filter(Boolean).map((p) => p.end()));
  }, 60_000);

  it("PT1 a create and a PUT round-trip the list in order; other nodes read []", async () => {
    await spec.assertTheListOrderRoundTrips(ctx);
  }, 60_000);

  it("PT2 a PUT that omits the list clears the stored one", async () => {
    await spec.assertAPutOmittingTheListClearsIt(ctx);
  }, 60_000);

  it("PT3 an unknown code is a 400 without the code, and writes nothing", async () => {
    await spec.assertAnUnknownCodeIs400AndWritesNothing(ctx);
  }, 60_000);

  it("PT4 a retired listed code re-saves but cannot be added to another layout", async () => {
    await spec.assertARetiredListedCodeReSavesButCannotBeAdded(ctx);
  }, 60_000);

  it("PT5 validateProposal's baseline carries the list, and its create check refuses an unknown code", async () => {
    await spec.assertAProposalCarriesAndChecksTheList(ctx);
  }, 60_000);

  it("PT6 the audit payload counts the listed units", async () => {
    await spec.assertTheAuditCountsListedUnits(ctx);
  }, 60_000);

  it("PT7 the point-key foreign key translates to the same 400", () => {
    spec.assertThePointKeyFkTranslatesTo400();
  });
});

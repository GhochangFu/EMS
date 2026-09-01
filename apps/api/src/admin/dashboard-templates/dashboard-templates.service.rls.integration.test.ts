import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";
import type { BmsDb } from "@bms/db";

import { jwtFor, SEEDED } from "../../auth/access-control.integration.spec";
import { AccessControlService } from "../../auth/access-control.service";
import {
  openIntegrationPool,
  requireIntegrationDb,
  resolveIntegrationRoleUrl,
} from "../../testing/integration-db-gate";
import { asRole } from "../../testing/role-urls";
import { VocabulariesService } from "../../vocabularies/vocabularies.service";
import { MasterDataAuditService } from "../master-data-audit.service";
import {
  assertAuditRowCommitted,
  assertForeignTemplateIdOnDashboardIsRefused,
  assertForeignTemplateIsInvisibleToAnotherTenant,
  assertScopedAdminIsForbiddenOnAnotherOrgTemplate,
  assertSecondDraftIsRefusedByThePartialIndex,
  assertUnknownSectionIsA400NamingTheLiveSet,
} from "./dashboard-templates.service.rls.integration.spec";
import { DashboardTemplatesService } from "./dashboard-templates.service";

/**
 * `F3.36` Part E1 — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns the database lifecycle, per-run fixture codes, and
 * cleanup.
 *
 * **Cleanup deletes only rows this suite created, by id.** `F3.37`'s pre-merge
 * review found an `afterAll` that erased every organization's real role-change
 * history on a developer database — a broad `DELETE` in a test is a data-loss
 * bug that only ever fires on someone's own machine.
 */
const connectionString = requireIntegrationDb({
  item: "F3.36",
  label: "DashboardTemplatesService tenant isolation, the dashboards template_id policy leg, and the draft index",
  because:
    "whether a foreign tenant sees a template, whether stamping a dashboard with another " +
    "organization's template_id is refused by the POLICY rather than by the foreign key, and " +
    "whether the partial draft index bites are all facts about a real connection and real RLS. " +
    "A source scan proves the migration SAYS them; only this proves Postgres DOES them.",
});

const RUN = randomUUID().replace(/-/g, "").slice(0, 8);
const OWNED_CODE = `f336-owned-${RUN}`;
const DRAFT_RIVAL_CODE = `f336-rival-${RUN}`;
const UNKNOWN_SECTION_CODE = `f336-badsection-${RUN}`;
const CROSS_ORG_SLUG = `f336-crossorg-${RUN}`;

describe.skipIf(!connectionString)(
  "F3.36 — dashboard template tenant isolation and the dashboards template_id leg",
  () => {
    let ownerPool: pg.Pool;
    let tenantPool: pg.Pool;
    let authPool: pg.Pool;
    let fleetDb: BmsDb;

    let eskomOrgId: string;
    let phewbOrgId: string;
    const templateIds: string[] = [];

    const makeService = (): DashboardTemplatesService => {
      const tenantDb = createDb(tenantPool);
      const accessControl = new AccessControlService(createDb(authPool), fleetDb);
      const audit = new MasterDataAuditService(tenantDb, fleetDb);
      const vocabularies = new VocabulariesService(fleetDb);
      return new DashboardTemplatesService(fleetDb, tenantDb, accessControl, audit, vocabularies);
    };

    beforeAll(async () => {
      const url = connectionString as string;
      ownerPool = await openIntegrationPool(
        resolveIntegrationRoleUrl(url, "superuser", process.env),
        "F3.36",
      );
      tenantPool = await openIntegrationPool(
        process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
        "F3.36",
      );
      authPool = await openIntegrationPool(
        process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"),
        "F3.36",
      );
      fleetDb = createDb(await openIntegrationPool(url, "F3.36"));

      const eskom = await ownerPool.query<{ id: string }>(
        `SELECT id FROM bms.organizations WHERE code = 'ESKOM' LIMIT 1`,
      );
      const phewb = await ownerPool.query<{ id: string }>(
        `SELECT id FROM bms.organizations WHERE code = 'PHEWB' LIMIT 1`,
      );
      eskomOrgId = eskom.rows[0]?.id ?? "";
      phewbOrgId = phewb.rows[0]?.id ?? "";
      if (!eskomOrgId || !phewbOrgId) {
        throw new Error("F3.36: ESKOM/PHEWB organizations not found — run pnpm db:seed");
      }
    }, 60_000);

    afterAll(async () => {
      // By id, and only the ids this suite created. Never a broad DELETE.
      if (templateIds.length > 0) {
        await ownerPool.query(`DELETE FROM bms.audit_log WHERE entity_id = ANY($1::uuid[])`, [
          templateIds,
        ]);
        await ownerPool.query(`DELETE FROM bms.dashboard_templates WHERE id = ANY($1::uuid[])`, [
          templateIds,
        ]);
      }
      await ownerPool.query(`DELETE FROM bms.dashboards WHERE slug = $1`, [CROSS_ORG_SLUG]);
      await Promise.all([ownerPool, tenantPool, authPool].filter(Boolean).map((p) => p.end()));
    }, 60_000);

    it("an ESKOM template is invisible to a PHEWB session, and its audit row committed", async () => {
      const service = makeService();
      const globalAdmin = jwtFor(SEEDED.globalAdmin, "admin");

      const created = await service.create(globalAdmin, {
        organizationId: eskomOrgId,
        code: OWNED_CODE,
        name: "F3.36 tenant isolation proof",
        section: "electrical",
      } as Parameters<DashboardTemplatesService["create"]>[1]);
      templateIds.push(created.id);

      await assertForeignTemplateIsInvisibleToAnotherTenant(
        tenantPool,
        created.id,
        eskomOrgId,
        phewbOrgId,
      );
      await assertAuditRowCommitted(ownerPool, created.id, eskomOrgId, "create");
    }, 60_000);

    it("a PHEWB dashboard cannot be stamped with an ESKOM template_id — refused by the policy", async () => {
      const service = makeService();
      const globalAdmin = jwtFor(SEEDED.globalAdmin, "admin");

      const eskomTemplate = await service.create(globalAdmin, {
        organizationId: eskomOrgId,
        code: `${OWNED_CODE}-stamp`,
        name: "F3.36 cross-org stamp proof",
        section: "electrical",
      } as Parameters<DashboardTemplatesService["create"]>[1]);
      templateIds.push(eskomTemplate.id);

      await assertForeignTemplateIdOnDashboardIsRefused(
        tenantPool,
        eskomTemplate.id,
        phewbOrgId,
        CROSS_ORG_SLUG,
      );
    }, 60_000);

    it("a second draft of the same code is refused by the partial unique index", async () => {
      const service = makeService();
      const globalAdmin = jwtFor(SEEDED.globalAdmin, "admin");

      const first = await service.create(globalAdmin, {
        organizationId: eskomOrgId,
        code: DRAFT_RIVAL_CODE,
        name: "F3.36 draft index proof",
        section: "electrical",
      } as Parameters<DashboardTemplatesService["create"]>[1]);
      templateIds.push(first.id);

      await assertSecondDraftIsRefusedByThePartialIndex(ownerPool, eskomOrgId, DRAFT_RIVAL_CODE);
    }, 60_000);

    it("a location-scoped admin is refused another organization's template", async () => {
      const service = makeService();
      const globalAdmin = jwtFor(SEEDED.globalAdmin, "admin");

      const phewbTemplate = await service.create(globalAdmin, {
        organizationId: phewbOrgId,
        code: `${OWNED_CODE}-foreign`,
        name: "F3.36 scope proof",
        section: "water",
      } as Parameters<DashboardTemplatesService["create"]>[1]);
      templateIds.push(phewbTemplate.id);

      // wc-admin@bms.local is ESKOM's location_admin — no authority over any PHEWB row.
      const eskomLocationAdmin = jwtFor(SEEDED.locationAdmin, "location_admin");
      await assertScopedAdminIsForbiddenOnAnotherOrgTemplate(
        service,
        eskomLocationAdmin,
        phewbTemplate.id,
      );
    }, 60_000);

    it("an unknown section is a 400 that names the live set, not a foreign-key 500", async () => {
      const service = makeService();
      const globalAdmin = jwtFor(SEEDED.globalAdmin, "admin");
      await assertUnknownSectionIsA400NamingTheLiveSet(
        service,
        globalAdmin,
        eskomOrgId,
        UNKNOWN_SECTION_CODE,
      );
    }, 60_000);
  },
);

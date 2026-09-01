import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";
import type { BmsDb } from "@bms/db";
import { DASHBOARD_GRID } from "@bms/shared";

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
import { DashboardTemplatesInstantiateService } from "./dashboard-templates-instantiate.service";
import {
  assertDraftCannotBeInstantiated,
  assertForeignGroupIsRefusedAndLeavesNothing,
  assertResolutionReportCoversEveryOutcome,
  assertTemplateStampIsOnTheDashboardRow,
} from "./dashboard-templates-instantiate.integration.spec";
import { DashboardTemplatesService } from "./dashboard-templates.service";

/**
 * `F3.36` Part E4 — Vitest entry point. Owns the fixtures and cleanup.
 *
 * **The fixture is built so the four outcomes are genuinely distinguishable.**
 * Four assets share the `chiller` role; three carry a `kW` point and all four
 * carry `kVA`. The same role therefore yields `truncated` on a one-point widget,
 * `partial` on a many-point widget bound to `kW`, and `bound` on one bound to
 * `kVA` — the separations Amendment 2 had to rule, which a happy-path fixture
 * would collapse into one. A sixth widget, `mixed-chart`, names two roles where
 * one resolves fully and the other matches nothing: the case the first resolver
 * reported as `bound`.
 *
 * **Cleanup is by id, and only the ids this suite created.** `F3.37`'s review
 * found an `afterAll` that erased every organization's real history on a
 * developer database.
 */
const connectionString = requireIntegrationDb({
  item: "F3.36",
  label: "section template instantiation — the Amendment 2 resolution report",
  because:
    "which member a role resolves to, how many points a widget ends up with, and whether a " +
    "refused instantiate leaves a half-built dashboard behind are all facts about real rows " +
    "and a real transaction. A unit test with a fake db proves none of them.",
});

const RUN = randomUUID().replace(/-/g, "").slice(0, 8);
const GROUP_CODE = `f336-inst-${RUN}`;
const PUBLISHED_CODE = `f336-inst-tmpl-${RUN}`;
const DRAFT_CODE = `f336-inst-draft-${RUN}`;
const REPORT_SLUG = `f336-report-${RUN}`;
const FOREIGN_SLUG = `f336-foreign-${RUN}`;
const DRAFT_SLUG = `f336-draftinst-${RUN}`;

/** Six widgets: one per outcome, plus the mixed-role regression case. */
const TEMPLATE_CONTENT = {
  widgets: [
    {
      key: "chiller-gauge",
      title: "Lead chiller load",
      gridX: 0,
      gridY: 0,
      gridW: 3,
      gridH: 3,
      bindings: [{ assetRoleCode: "chiller", pointKey: "kW", pointRole: "primary", sortOrder: 0 }],
      sources: [],
      widgetType: "radial_gauge",
      config: { min: 0, max: 100 },
    },
    {
      key: "chiller-chart",
      title: "Chiller load trend",
      gridX: 3,
      gridY: 0,
      gridW: 6,
      gridH: 4,
      bindings: [{ assetRoleCode: "chiller", pointKey: "kW", pointRole: "series", sortOrder: 0 }],
      sources: [],
      widgetType: "chart",
      config: { series: "line" },
    },
    {
      key: "chiller-full",
      title: "Chiller apparent power",
      gridX: 0,
      gridY: 4,
      gridW: 6,
      gridH: 4,
      bindings: [{ assetRoleCode: "chiller", pointKey: "kVA", pointRole: "series", sortOrder: 0 }],
      sources: [],
      widgetType: "chart",
      config: { series: "line" },
    },
    {
      // Two roles: one resolves every member it matched, the other matches
      // nothing. The summed resolver called this `bound`; it is `partial`.
      key: "mixed-chart",
      title: "Chillers and cooling tower",
      gridX: 0,
      gridY: 8,
      gridW: 6,
      gridH: 4,
      bindings: [
        { assetRoleCode: "chiller", pointKey: "kVA", pointRole: "series", sortOrder: 0 },
        { assetRoleCode: "cooling-tower", pointKey: "kW", pointRole: "series", sortOrder: 1 },
      ],
      sources: [],
      widgetType: "chart",
      config: { series: "line" },
    },
    {
      key: "tower-tile",
      title: "Cooling tower",
      gridX: 6,
      gridY: 4,
      gridW: 3,
      gridH: 2,
      bindings: [
        { assetRoleCode: "cooling-tower", pointKey: "kW", pointRole: "primary", sortOrder: 0 },
      ],
      sources: [],
      widgetType: "value_tile",
      config: {},
    },
    {
      key: "alarms-tile",
      title: "Active alarms",
      gridX: 9,
      gridY: 0,
      gridW: 3,
      gridH: 2,
      bindings: [],
      sources: [{ catalogKey: "alarms.active.count", params: {}, sortOrder: 0 }],
      widgetType: "value_tile",
      config: {},
    },
  ],
};

describe.skipIf(!connectionString)(
  "F3.36 — section template instantiation and the Amendment 2 resolution report",
  () => {
    let ownerPool: pg.Pool;
    let tenantPool: pg.Pool;
    let authPool: pg.Pool;
    let fleetDb: BmsDb;

    let eskomOrgId: string;
    let phewbOrgId: string;
    let eskomGroupId: string;
    let phewbGroupId: string;
    let publishedTemplateId: string;
    let firstChillerAssetId: string;
    let draftTemplateId: string;

    const templateIds: string[] = [];
    const dashboardIds: string[] = [];
    const assetIds: string[] = [];
    let createdGroupId: string | undefined;

    const makeInstantiate = (): DashboardTemplatesInstantiateService => {
      const tenantDb = createDb(tenantPool);
      const accessControl = new AccessControlService(createDb(authPool), fleetDb);
      const audit = new MasterDataAuditService(tenantDb, fleetDb);
      const vocabularies = new VocabulariesService(fleetDb);
      const templates = new DashboardTemplatesService(
        fleetDb,
        tenantDb,
        accessControl,
        audit,
        vocabularies,
      );
      return new DashboardTemplatesInstantiateService(
        fleetDb,
        tenantDb,
        accessControl,
        audit,
        templates,
      );
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

      const orgs = await ownerPool.query<{ id: string; code: string }>(
        `SELECT id, code FROM bms.organizations WHERE code IN ('ESKOM','PHEWB')`,
      );
      eskomOrgId = orgs.rows.find((r) => r.code === "ESKOM")?.id ?? "";
      phewbOrgId = orgs.rows.find((r) => r.code === "PHEWB")?.id ?? "";
      if (!eskomOrgId || !phewbOrgId) {
        throw new Error("F3.36: ESKOM/PHEWB organizations not found — run pnpm db:seed");
      }

      // F4.53: the OLDEST row is a seeded one, which predates every suite in the
      // run and is the only one no concurrent suite can delete underneath us.
      const location = await ownerPool.query<{ id: string }>(
        `SELECT id FROM bms.locations WHERE organization_id = $1 ORDER BY created_at, id LIMIT 1`,
        [eskomOrgId],
      );
      const locationId = location.rows[0]?.id;
      if (!locationId) throw new Error("F3.36: ESKOM has no location — run pnpm db:seed");

      const group = await ownerPool.query<{ id: string }>(
        `INSERT INTO bms.asset_groups (organization_id, location_id, code, name)
         VALUES ($1, $2, $3, 'F3.36 instantiate fixture') RETURNING id`,
        [eskomOrgId, locationId, GROUP_CODE],
      );
      eskomGroupId = group.rows[0]?.id ?? "";
      createdGroupId = eskomGroupId;

      // Three chillers. Codes are ordered so "the first by assets.code" is a
      // stated expectation rather than whatever the planner returns.
      for (const suffix of ["a", "b", "c", "d"]) {
        const asset = await ownerPool.query<{ id: string }>(
          `INSERT INTO bms.assets (organization_id, location_id, code, name, site_name, domain)
           VALUES ($1, $2, $3, $4, 'F3.36 fixture site', 'hvac') RETURNING id`,
          [eskomOrgId, locationId, `${GROUP_CODE}-${suffix}`, `F3.36 chiller ${suffix}`],
        );
        const assetId = asset.rows[0]?.id ?? "";
        assetIds.push(assetId);
        if (suffix === "a") firstChillerAssetId = assetId;
        await ownerPool.query(
          `INSERT INTO bms.asset_group_members (asset_group_id, asset_id, role)
           VALUES ($1, $2, 'chiller')`,
          [eskomGroupId, assetId],
        );
        // Every chiller carries kVA.
        await ownerPool.query(
          `INSERT INTO bms.asset_points (organization_id, asset_id, point_key, source_data_key, unit)
           VALUES ($1, $2, 'kVA', $3, 'kVA')`,
          [eskomOrgId, assetId, `${GROUP_CODE}-${suffix}-kva`],
        );
        // `c` is the one member WITHOUT a kW point, which is what separates
        // `partial` from `bound` on two otherwise identical charts. `d` is the
        // fourth member, added so the over-match case has three resolving
        // members against a max=1 widget — Amendment 2 decision 2 then has its
        // own fixture instead of sharing decision 3's, which is the conflation
        // the `F3.36` correctness review pointed out.
        if (suffix !== "c") {
          await ownerPool.query(
            `INSERT INTO bms.asset_points (organization_id, asset_id, point_key, source_data_key, unit)
             VALUES ($1, $2, 'kW', $3, 'kW')`,
            [eskomOrgId, assetId, `${GROUP_CODE}-${suffix}-kw`],
          );
        }
      }

      const phewbGroup = await ownerPool.query<{ id: string }>(
        `SELECT id FROM bms.asset_groups WHERE organization_id = $1 ORDER BY created_at, id LIMIT 1`,
        [phewbOrgId],
      );
      phewbGroupId = phewbGroup.rows[0]?.id ?? "";

      const published = await ownerPool.query<{ id: string }>(
        `INSERT INTO bms.dashboard_templates
           (organization_id, code, version, name, section, status, content, published_at)
         VALUES ($1, $2, 1, 'F3.36 instantiate fixture', 'hvac', 'published', $3, now())
         RETURNING id`,
        [eskomOrgId, PUBLISHED_CODE, JSON.stringify(TEMPLATE_CONTENT)],
      );
      publishedTemplateId = published.rows[0]?.id ?? "";
      templateIds.push(publishedTemplateId);

      const draft = await ownerPool.query<{ id: string }>(
        `INSERT INTO bms.dashboard_templates
           (organization_id, code, version, name, section, status, content)
         VALUES ($1, $2, 1, 'F3.36 draft fixture', 'hvac', 'draft', $3)
         RETURNING id`,
        [eskomOrgId, DRAFT_CODE, JSON.stringify(TEMPLATE_CONTENT)],
      );
      draftTemplateId = draft.rows[0]?.id ?? "";
      templateIds.push(draftTemplateId);

      // The canvas is 12 columns wide; the fixture's widest row is gridX 9 + gridW 3.
      if (DASHBOARD_GRID.columns < 12) {
        throw new Error("F3.36: the fixture assumes a canvas at least as wide as it lays out");
      }
    }, 60_000);

    afterAll(async () => {
      if (dashboardIds.length > 0) {
        await ownerPool.query(`DELETE FROM bms.audit_log WHERE entity_id = ANY($1::uuid[])`, [
          dashboardIds,
        ]);
        await ownerPool.query(`DELETE FROM bms.dashboards WHERE id = ANY($1::uuid[])`, [
          dashboardIds,
        ]);
      }
      await ownerPool.query(`DELETE FROM bms.dashboards WHERE slug = ANY($1::text[])`, [
        [REPORT_SLUG, FOREIGN_SLUG, DRAFT_SLUG],
      ]);
      if (templateIds.length > 0) {
        await ownerPool.query(`DELETE FROM bms.audit_log WHERE entity_id = ANY($1::uuid[])`, [
          templateIds,
        ]);
        await ownerPool.query(`DELETE FROM bms.dashboard_templates WHERE id = ANY($1::uuid[])`, [
          templateIds,
        ]);
      }
      if (assetIds.length > 0) {
        await ownerPool.query(`DELETE FROM bms.asset_points WHERE asset_id = ANY($1::uuid[])`, [
          assetIds,
        ]);
        await ownerPool.query(
          `DELETE FROM bms.asset_group_members WHERE asset_id = ANY($1::uuid[])`,
          [assetIds],
        );
        await ownerPool.query(`DELETE FROM bms.assets WHERE id = ANY($1::uuid[])`, [assetIds]);
      }
      if (createdGroupId) {
        await ownerPool.query(`DELETE FROM bms.asset_groups WHERE id = $1`, [createdGroupId]);
      }
      await Promise.all([ownerPool, tenantPool, authPool].filter(Boolean).map((p) => p.end()));
    }, 60_000);

    it("reports truncated, partial, bound, unresolved and a catalog tile in one instantiation", async () => {
      const service = makeInstantiate();
      const globalAdmin = jwtFor(SEEDED.globalAdmin, "admin");

      const { dashboardId } = await assertResolutionReportCoversEveryOutcome(
        service,
        globalAdmin,
        publishedTemplateId,
        eskomGroupId,
        REPORT_SLUG,
        firstChillerAssetId,
      );
      dashboardIds.push(dashboardId);

      await assertTemplateStampIsOnTheDashboardRow(ownerPool, dashboardId, publishedTemplateId);
    }, 60_000);

    it("a group in another organization is refused, and leaves no half-built dashboard", async () => {
      const service = makeInstantiate();
      const globalAdmin = jwtFor(SEEDED.globalAdmin, "admin");
      await assertForeignGroupIsRefusedAndLeavesNothing(
        service,
        ownerPool,
        globalAdmin,
        publishedTemplateId,
        phewbGroupId,
        FOREIGN_SLUG,
      );
    }, 60_000);

    it("a draft template cannot be instantiated", async () => {
      const service = makeInstantiate();
      const globalAdmin = jwtFor(SEEDED.globalAdmin, "admin");
      await assertDraftCannotBeInstantiated(
        service,
        globalAdmin,
        draftTemplateId,
        eskomGroupId,
        DRAFT_SLUG,
      );
    }, 60_000);
  },
);

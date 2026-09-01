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
    /** Set only when the seed supplied no PHEWB asset group and this suite made one. */
    let createdPhewbGroupId: string | undefined;

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
        // `F3.39`: `asset_points.point_key` references `point_keys(code)` from
        // migration `0057`. This suite's bindings use `kW` and `kVA` — its own
        // codes, in that casing, distinct from the seeded snake_case `kw`
        // because the resolution being tested is exact-match. They must exist
        // in the now-fleet-wide catalog before any row names them; `afterAll`
        // removes them.
        await ownerPool.query(
          `INSERT INTO bms.point_keys (code, name, active) VALUES
             ('kW', 'F3.36 Fixture kW', true),
             ('kVA', 'F3.36 Fixture kVA', true)
           ON CONFLICT DO NOTHING`,
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

      /**
       * **A fresh `pnpm db:seed` gives PHEWB locations but NO asset groups.**
       *
       * This read used to fall back to `""`, which turned the foreign-group
       * assertion into `invalid input syntax for type uuid: ""` — a 500 from
       * Postgres rather than the 403 the test claims to prove. It passed on
       * every developer database, which accumulates PHEWB groups from the pilot
       * seed and from other suites' fixtures, and failed on the only database
       * that is actually clean: CI's.
       *
       * `dashboards.service.rls.integration.test.ts` documents this exact trap
       * and carries this exact fallback. A seeded row is still preferred
       * (`F4.53` — the oldest row is the one no concurrent suite can delete out
       * from under the fixture); this is what to do when the seed has none.
       */
      const phewbLocation = await ownerPool.query<{ id: string }>(
        `SELECT id FROM bms.locations WHERE organization_id = $1 ORDER BY created_at, id LIMIT 1`,
        [phewbOrgId],
      );
      const phewbLocationId = phewbLocation.rows[0]?.id;
      if (!phewbLocationId) {
        throw new Error("F3.36: PHEWB has no location — run pnpm db:seed");
      }

      const phewbGroup = await ownerPool.query<{ id: string }>(
        `SELECT id FROM bms.asset_groups WHERE organization_id = $1 ORDER BY created_at, id LIMIT 1`,
        [phewbOrgId],
      );
      phewbGroupId = phewbGroup.rows[0]?.id ?? "";
      if (!phewbGroupId) {
        const created = await ownerPool.query<{ id: string }>(
          `INSERT INTO bms.asset_groups (organization_id, location_id, code, name)
           VALUES ($1, $2, $3, 'F3.36 foreign-group fixture') RETURNING id`,
          [phewbOrgId, phewbLocationId, `f336-foreign-${RUN}`],
        );
        phewbGroupId = created.rows[0]?.id ?? "";
        createdPhewbGroupId = phewbGroupId;
      }
      if (!phewbGroupId) {
        throw new Error("F3.36: could not read or create a PHEWB asset group");
      }

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
      // `F3.39`: after the asset_points that reference them. Exact codes, never
      // a LIKE — the catalog is fleet-wide now, so a wide delete here would
      // erase another organization's real vocabulary.
      await ownerPool.query(`DELETE FROM bms.point_keys WHERE code = ANY($1::text[])`, [
        ["kW", "kVA"],
      ]);
      /**
       * **Delete every dashboard pointing at a group this suite created, not
       * only the ones this suite created.**
       *
       * The group delete failed on CI with
       * `dashboards_asset_group_id_fkey … is still referenced from table
       * "dashboards"`, after every test had passed. The cause is a cross-suite
       * race `F3.37`'s closure already recorded: on a CLEAN database, another
       * suite adopts "the oldest asset group in the organization", and on CI
       * this fixture's group was the only one there. That suite's dashboard is
       * not in `dashboardIds`, so a delete keyed on this suite's own ids leaves
       * it behind and the parent delete then fails.
       *
       * Still narrow — scoped to the two group ids this suite created, never a
       * blanket delete. `F3.37`'s review found an `afterAll` that erased every
       * organization's real history on a developer database, and the fix for a
       * cleanup that misses rows is never to widen it past what the suite owns.
       */
      const createdGroupIds = [createdGroupId, createdPhewbGroupId].filter(
        (id): id is string => Boolean(id),
      );
      if (createdGroupIds.length > 0) {
        await ownerPool.query(
          `DELETE FROM bms.audit_log WHERE entity_id IN (
             SELECT id FROM bms.dashboards WHERE asset_group_id = ANY($1::uuid[]))`,
          [createdGroupIds],
        );
        await ownerPool.query(
          `DELETE FROM bms.dashboards WHERE asset_group_id = ANY($1::uuid[])`,
          [createdGroupIds],
        );
        await ownerPool.query(
          `DELETE FROM bms.asset_group_members WHERE asset_group_id = ANY($1::uuid[])`,
          [createdGroupIds],
        );
        await ownerPool.query(`DELETE FROM bms.asset_groups WHERE id = ANY($1::uuid[])`, [
          createdGroupIds,
        ]);
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

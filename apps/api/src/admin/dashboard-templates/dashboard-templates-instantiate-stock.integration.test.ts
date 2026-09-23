import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type {
  DashboardTemplateDto,
  InstantiateSectionTemplateResponse,
} from "@bms/shared";

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
  assertAerationChartIsBound,
  assertAerationTileIsBound,
  assertAerationTileRowWasWritten,
  assertEveryWidgetReported,
  assertInletScreenIsTheRecordedV1Consequence,
  assertSustainabilityInstantiatedOrganizationWide,
  assertSustainabilityOverviewPublished,
  assertSustainabilityWidgetsAllResolve,
} from "./dashboard-templates-instantiate-stock.integration.spec";
import { DashboardTemplatesInstantiateService } from "./dashboard-templates-instantiate.service";
import { DashboardTemplatesService } from "./dashboard-templates.service";
import { STOCK_DASHBOARD_TEMPLATE_CATALOG } from "./stock-catalog";

/**
 * `F3.45` — Vitest entry point. Owns the fixture and cleanup.
 *
 * **The content under test is the SHIPPED `stp-overview` entry, imported from
 * the module** — never restated here, because a restated copy would stay green
 * while the catalog drifted. `F3.36`'s wrapper instantiates hand-written
 * content; this one instantiates what an organization actually imports.
 *
 * **The fixture is one v1 plant**: one `water` asset, one `aeration`
 * membership, one active `aeration_do_mgl` point. `bms.point_keys` is NOT
 * touched — `aeration_do_mgl` is seeded (`point-keys-seed.ts`), which is the
 * whole point: the catalog now binds a code the seed supplies, and the `F3.39`
 * FK is satisfied without this suite inserting its own vocabulary. There is
 * therefore no `point_keys` delete in `afterAll` either.
 *
 * **A separate pair, not a second `describe` in the `F3.36` wrapper**, so its
 * cleanup can only reach ids this suite created. Cleanup is by id (`F3.37`'s
 * review found an `afterAll` that erased every organization's real history).
 *
 * Instantiate runs ONCE in `beforeAll`; the five `it()`s read the same
 * response, so the `unresolved` claim and the two `bound` claims describe one
 * instantiation rather than five that could each be right alone.
 */
const connectionString = requireIntegrationDb({
  item: "F3.45",
  label: "stock stp-overview instantiation — a rebound binding resolves bound",
  because:
    "whether the shipped catalog's aeration_do_mgl binding finds a real asset_points row on a " +
    "real aeration member is a fact about rows and the resolver's exact-match lookup. The f3.38 " +
    "text scan proves the key exists in a vocabulary; only instantiation proves it resolves.",
});

const RUN = randomUUID().replace(/-/g, "").slice(0, 8);
const GROUP_CODE = `f345-stp-${RUN}`;
const TEMPLATE_CODE = `f345-stp-tmpl-${RUN}`;
const DASHBOARD_SLUG = `f345-stp-${RUN}`;

const stpOverview = STOCK_DASHBOARD_TEMPLATE_CATALOG.find((entry) => entry.code === "stp-overview");
if (!stpOverview) {
  throw new Error("F3.45: the stock catalog no longer carries an `stp-overview` entry");
}
const STP_OVERVIEW_CONTENT = stpOverview.content;

/**
 * `E4.2` PR 2 sweep — the SECOND stock entry this suite drives, and the reason
 * it is here rather than beside the fourteen-triple unit claim.
 *
 * `sustainability-overview` carries fifteen `params.pointKey` values, and `U3`
 * put the one gate on the template path inside `DashboardTemplatesService.publish`:
 * `assertSourceParamsPointKeysActive` reads `bms.point_keys` on the fleet pool.
 * With `stp-overview` the only entry this suite published — and published by a
 * direct `INSERT ... status 'published'` that never calls the service at all —
 * not one of those fifteen codes ever met the seeded vocabulary. A typo in any
 * of them shipped green: the unit claims compare the catalog against ITSELF,
 * and `tests/f3.38` compares it against repository SOURCE, which is not the
 * same thing as a row in the database an organization actually reads.
 *
 * So this half inserts a DRAFT and calls `publish` through the service, which
 * is the door the stock import path uses, and then instantiates it through the
 * **organization-wide arm** (`assetGroupId: null`, U8b / ADR 0072 decision 1) —
 * the only arm it can take: the entry ships zero role bindings, and the group
 * arm's `assertGroupTargetIsWritable` has nothing to resolve them against.
 */
const sustainabilityOverview = STOCK_DASHBOARD_TEMPLATE_CATALOG.find(
  (entry) => entry.code === "sustainability-overview",
);
if (!sustainabilityOverview) {
  throw new Error("E4.2: the stock catalog no longer carries a `sustainability-overview` entry");
}
const SUSTAINABILITY_CONTENT = sustainabilityOverview.content;
const SUSTAINABILITY_TEMPLATE_CODE = `e42-sust-tmpl-${RUN}`;
const SUSTAINABILITY_SLUG = `e42-sust-${RUN}`;

describe.skipIf(!connectionString)(
  "F3.45 — stp-overview resolves aeration_do_mgl as bound against a v1 plant asset",
  () => {
    let ownerPool: pg.Pool;
    let tenantPool: pg.Pool;
    let authPool: pg.Pool;
    let fleetPool: pg.Pool;
    let fleetDb: BmsDb;

    let eskomOrgId: string;
    let groupId: string | undefined;
    let plantAssetId: string;
    let response: InstantiateSectionTemplateResponse;
    let sustainabilityPublished: DashboardTemplateDto;
    let sustainabilityResponse: InstantiateSectionTemplateResponse;

    const templateIds: string[] = [];
    const dashboardIds: string[] = [];
    const assetIds: string[] = [];

    // Restated rather than exported from the F3.36 wrapper's describe — a
    // shared helper is a second thing to keep honest (the f2.13 precedent).
    //
    // `E4.2` returns BOTH services, because the sustainability half publishes
    // through `DashboardTemplatesService` — the door `U3`'s point-key check
    // lives behind — before it instantiates. Building the templates service
    // twice would give the instantiate service a different instance from the
    // one that published, which is a difference this suite has no reason to
    // introduce.
    const makeServices = (): {
      templates: DashboardTemplatesService;
      instantiate: DashboardTemplatesInstantiateService;
    } => {
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
      return {
        templates,
        instantiate: new DashboardTemplatesInstantiateService(
          fleetDb,
          tenantDb,
          accessControl,
          audit,
          templates,
        ),
      };
    };

    beforeAll(async () => {
      const url = connectionString as string;
      ownerPool = await openIntegrationPool(
        resolveIntegrationRoleUrl(url, "superuser", process.env),
        "F3.45",
      );
      tenantPool = await openIntegrationPool(
        process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
        "F3.45",
      );
      authPool = await openIntegrationPool(
        process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"),
        "F3.45",
      );
      fleetPool = await openIntegrationPool(url, "F3.45");
      fleetDb = createDb(fleetPool);

      const org = await ownerPool.query<{ id: string }>(
        `SELECT id FROM bms.organizations WHERE code = 'ESKOM'`,
      );
      eskomOrgId = org.rows[0]?.id ?? "";
      if (!eskomOrgId) throw new Error("F3.45: ESKOM organization not found — run pnpm db:seed");

      // F4.53: the OLDEST row is a seeded one, which predates every suite in the
      // run and is the only one no concurrent suite can delete underneath us.
      const location = await ownerPool.query<{ id: string }>(
        `SELECT id FROM bms.locations WHERE organization_id = $1 ORDER BY created_at, id LIMIT 1`,
        [eskomOrgId],
      );
      const locationId = location.rows[0]?.id;
      if (!locationId) throw new Error("F3.45: ESKOM has no location — run pnpm db:seed");

      const group = await ownerPool.query<{ id: string }>(
        `INSERT INTO bms.asset_groups (organization_id, location_id, code, name)
         VALUES ($1, $2, $3, 'F3.45 stp-overview fixture') RETURNING id`,
        [eskomOrgId, locationId, GROUP_CODE],
      );
      groupId = group.rows[0]?.id;
      if (!groupId) throw new Error("F3.45: asset group insert returned no id");

      // One plant asset (ADR 0040 ruling 5), domain `water` (migration 0029).
      const asset = await ownerPool.query<{ id: string }>(
        `INSERT INTO bms.assets (organization_id, location_id, code, name, site_name, domain)
         VALUES ($1, $2, $3, 'F3.45 STP plant', 'F3.45 fixture site', 'water') RETURNING id`,
        [eskomOrgId, locationId, `${GROUP_CODE}-plant`],
      );
      plantAssetId = asset.rows[0]?.id ?? "";
      if (!plantAssetId) throw new Error("F3.45: asset insert returned no id");
      assetIds.push(plantAssetId);

      await ownerPool.query(
        `INSERT INTO bms.asset_group_members (asset_group_id, asset_id, role)
         VALUES ($1, $2, 'aeration')`,
        [groupId, plantAssetId],
      );
      // `aeration_do_mgl` is SEEDED in bms.point_keys; this suite neither
      // inserts nor deletes it. `active` is the column default, as in F3.36.
      await ownerPool.query(
        `INSERT INTO bms.asset_points (organization_id, asset_id, point_key, source_data_key, unit)
         VALUES ($1, $2, 'aeration_do_mgl', $3, 'mg/L')`,
        [eskomOrgId, plantAssetId, `${GROUP_CODE}-plant-do`],
      );

      const published = await ownerPool.query<{ id: string }>(
        `INSERT INTO bms.dashboard_templates
           (organization_id, code, version, name, section, status, content, published_at)
         VALUES ($1, $2, 1, 'F3.45 stp-overview fixture', 'stp', 'published', $3, now())
         RETURNING id`,
        [eskomOrgId, TEMPLATE_CODE, JSON.stringify(STP_OVERVIEW_CONTENT)],
      );
      const templateId = published.rows[0]?.id;
      if (!templateId) throw new Error("F3.45: template insert returned no id");
      templateIds.push(templateId);

      const { templates: templatesService, instantiate: service } = makeServices();
      const admin = jwtFor(SEEDED.globalAdmin, "admin");
      response = await service.instantiate(admin, templateId, {
        assetGroupId: groupId,
        slug: DASHBOARD_SLUG,
        name: "F3.45 stp-overview resolution proof",
      });
      dashboardIds.push(response.dashboard.id);

      // ---- E4.2: the sustainability half ---------------------------------
      //
      // Inserted as a DRAFT, on purpose. `publish` runs `assertTransition`, so
      // a row already `published` would skip the method this half exists to
      // reach — and with it `assertSourceParamsPointKeysActive`, the U3 gate
      // the fifteen shipped `pointKey` values have never met.
      const draft = await ownerPool.query<{ id: string }>(
        `INSERT INTO bms.dashboard_templates
           (organization_id, code, version, name, section, status, content)
         VALUES ($1, $2, 1, 'E4.2 sustainability-overview fixture', 'sustainability', 'draft', $3)
         RETURNING id`,
        [eskomOrgId, SUSTAINABILITY_TEMPLATE_CODE, JSON.stringify(SUSTAINABILITY_CONTENT)],
      );
      const sustainabilityTemplateId = draft.rows[0]?.id;
      if (!sustainabilityTemplateId) throw new Error("E4.2: sustainability draft insert returned no id");
      templateIds.push(sustainabilityTemplateId);

      sustainabilityPublished = await templatesService.publish(admin, sustainabilityTemplateId);
      sustainabilityResponse = await service.instantiate(admin, sustainabilityTemplateId, {
        assetGroupId: null,
        slug: SUSTAINABILITY_SLUG,
        name: "E4.2 sustainability-overview publish proof",
      });
      dashboardIds.push(sustainabilityResponse.dashboard.id);
    }, 60_000);

    // The post-merge sweep (F3.45): vitest runs `afterAll` after a failed
    // `beforeAll` too. The unguarded slug delete then ran with `eskomOrgId`
    // `""` and threw `invalid input syntax for type uuid`, which masked the
    // real `beforeAll` error and skipped every `end()` below. So: every
    // cleanup step is guarded on the state it needs, and the pools close in
    // a `finally` whatever the cleanup did.
    afterAll(async () => {
      try {
        if (dashboardIds.length > 0) {
          await ownerPool.query(`DELETE FROM bms.audit_log WHERE entity_id = ANY($1::uuid[])`, [
            dashboardIds,
          ]);
          await ownerPool.query(`DELETE FROM bms.dashboards WHERE id = ANY($1::uuid[])`, [
            dashboardIds,
          ]);
        }
        if (eskomOrgId) {
          await ownerPool.query(
            `DELETE FROM bms.dashboards WHERE organization_id = $1 AND slug = $2`,
            [eskomOrgId, DASHBOARD_SLUG],
          );
        }
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
        // No `bms.point_keys` delete: `aeration_do_mgl` is the seed's row.
        // Every dashboard pointing at the group this suite created, not only the
        // ones in `dashboardIds` — F3.36 records the cross-suite race on a clean
        // database where another suite adopts "the oldest asset group". Still
        // scoped to this suite's one group id, never wider.
        if (groupId) {
          await ownerPool.query(
            `DELETE FROM bms.audit_log WHERE entity_id IN (
               SELECT id FROM bms.dashboards WHERE asset_group_id = $1)`,
            [groupId],
          );
          await ownerPool.query(`DELETE FROM bms.dashboards WHERE asset_group_id = $1`, [groupId]);
          await ownerPool.query(`DELETE FROM bms.asset_group_members WHERE asset_group_id = $1`, [
            groupId,
          ]);
          await ownerPool.query(`DELETE FROM bms.asset_groups WHERE id = $1`, [groupId]);
        }
      } finally {
        await Promise.all(
          [ownerPool, tenantPool, authPool, fleetPool].filter(Boolean).map((p) => p.end()),
        );
      }
    }, 60_000);

    it("reports every stp-overview widget", () => {
      assertEveryWidgetReported(response);
    });

    it("aeration-tile resolves bound: one member, one aeration_do_mgl point", () => {
      assertAerationTileIsBound(response);
    });

    it("aeration-chart resolves bound on the same member and key", () => {
      assertAerationChartIsBound(response);
    });

    it("inlet-screen-tile reports unresolved — the recorded v1 one-role-per-plant consequence", () => {
      assertInletScreenIsTheRecordedV1Consequence(response);
    });

    it("the Aeration DO widget row carries exactly one point, on the fixture asset", () => {
      assertAerationTileRowWasWritten(response, plantAssetId);
    });

    it("sustainability-overview publishes — its fifteen pointKey values are in the seeded catalog (E4.2 U3)", () => {
      assertSustainabilityOverviewPublished(sustainabilityPublished);
    });

    it("sustainability-overview instantiates organization-wide, with no scope column set (E4.2 U8b)", () => {
      assertSustainabilityInstantiatedOrganizationWide(sustainabilityResponse);
    });

    it("every one of its 19 widgets resolves — a zero-binding widget is bound", () => {
      assertSustainabilityWidgetsAllResolve(sustainabilityResponse);
    });
  },
);

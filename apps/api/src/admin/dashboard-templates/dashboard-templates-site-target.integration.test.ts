import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import type { JwtPayload } from "@bms/shared";
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
  DashboardTemplatesInstantiateService,
  type SiteTemplateArm,
} from "./dashboard-templates-instantiate.service";
import {
  assertDraftFromSiteTemplateKeepsTheTarget,
  assertGroupBodyOnSiteTemplateIsRefused,
  assertGroupPatchWithoutTabsIsTaken,
  assertLocationAdminCannotReachTheSiteArm,
  assertPatchIsCheckedAgainstTheStoredTarget,
  assertPublishReChecksTheStoredTarget,
  assertTabSourceParamsAreCheckedAtPublish,
  assertTabSourcePointKeysAreCheckedAtPublish,
  assertSiteArmAnswers501UntilWired,
  assertSiteArmReceivesTheTemplateAndBody,
  assertSiteBodyOnGroupTemplateIsRefused,
  assertSitePatchCarryingTabsIsTaken,
  assertSitePatchWithoutTabsIsRefusedAndKeepsTheTabs,
  assertSiteTemplateWithTabWidgetsOnlyPublishes,
  assertUnknownTabDomainIsRefusedAtPublish,
} from "./dashboard-templates-site-target.integration.spec";
import { DashboardTemplatesService } from "./dashboard-templates.service";
import { primeSeededSubjects } from "../../testing/seeded-subjects";

/**
 * `F3.73` plan Task 2.2 — Vitest entry point. Owns the fixtures and cleanup.
 *
 * Four template rows, written as the superuser: a site DRAFT whose only widgets sit in tabs
 * (the publish case), a site draft whose tab names domain `nope`, a PUBLISHED site template and
 * a PUBLISHED asset-group template (the instantiate cases). Cleanup is by id, and only the ids
 * this suite created — `F3.37`'s review found an `afterAll` that erased every organization's
 * history on a developer database.
 */
const connectionString = requireIntegrationDb({
  item: "F3.73",
  label: "section template target — publish and instantiate against the stored target",
  because:
    "publish reads the stored row and bms.asset_domains, and instantiation reads the stored " +
    "row's target column; a request schema can see neither, so only real rows prove the rule.",
});

const RUN = randomUUID().replace(/-/g, "").slice(0, 8);
const MISMATCH_SLUG = `f373-mismatch-${RUN}`;

/** A legal tab widget with no binding: publish then checks no role, source or point key. */
const tabWidget = (key: string) => ({
  key,
  title: null,
  gridX: 0,
  gridY: 0,
  gridW: 3,
  gridH: 2,
  bindings: [],
  sources: [],
  widgetType: "value_tile",
  config: {},
});

const siteContent = (domain: string) => ({
  widgets: [],
  tabs: [
    { key: "overview", label: "Overview", sortOrder: 0, domain: null, widgets: [tabWidget("o1")] },
    { key: "sld", label: "SLD", sortOrder: 1, domain, widgets: [tabWidget("s1")] },
  ],
});

/** A site template whose one tab tile carries `source` — the publish gates must walk into it. */
const siteContentWithTabSource = (source: unknown) => ({
  widgets: [],
  tabs: [
    {
      key: "overview",
      label: "Overview",
      sortOrder: 0,
      domain: null,
      widgets: [{ ...tabWidget("src"), sources: [source] }],
    },
  ],
});

describe.skipIf(!connectionString)(
  "F3.73 — the template target on the publish and instantiate paths",
  () => {
    let ownerPool: pg.Pool;
    let tenantPool: pg.Pool;
    let authPool: pg.Pool;
    let fleetDb: BmsDb;

    let eskomOrgId: string;
    let locationId: string;
    let groupId: string;
    let siteDraftId: string;
    let badDomainDraftId: string;
    let badParamsDraftId: string;
    let badPointKeyDraftId: string;
    let siteWithTopLevelDraftId: string;
    let sitePatchDraftId: string;
    let groupPatchDraftId: string;
    let sitePublishedId: string;
    let groupPublishedId: string;
    const templateIds: string[] = [];

    const makeServices = (
      arm?: SiteTemplateArm,
    ): { templates: DashboardTemplatesService; instantiate: DashboardTemplatesInstantiateService } => {
      const tenantDb = createDb(tenantPool);
      const accessControl = new AccessControlService(createDb(authPool), fleetDb);
      const audit = new MasterDataAuditService(tenantDb, fleetDb);
      const templates = new DashboardTemplatesService(
        fleetDb,
        tenantDb,
        accessControl,
        audit,
        new VocabulariesService(fleetDb),
      );
      const instantiate = new DashboardTemplatesInstantiateService(
        fleetDb,
        tenantDb,
        accessControl,
        audit,
        templates,
        arm,
      );
      return { templates, instantiate };
    };
    let admin: JwtPayload;

    beforeAll(async () => {
      const url = connectionString as string;
      ownerPool = await openIntegrationPool(
        resolveIntegrationRoleUrl(url, "superuser", process.env),
        "F3.73",
      );
      tenantPool = await openIntegrationPool(
        process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
        "F3.73",
      );
      authPool = await openIntegrationPool(
        process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"),
        "F3.73",
      );
      // F3.78: jwtFor carries the real bms.users.id as sub (ADR 0089 decision 4).
      await primeSeededSubjects(authPool);
      admin = jwtFor(SEEDED.globalAdmin, "admin");
      fleetDb = createDb(await openIntegrationPool(url, "F3.73"));

      const org = await ownerPool.query<{ id: string }>(
        `SELECT id FROM bms.organizations WHERE code = 'ESKOM'`,
      );
      eskomOrgId = org.rows[0]?.id ?? "";
      if (!eskomOrgId) throw new Error("F3.73: ESKOM organization not found — run pnpm db:seed");

      // The oldest seeded location, by code: the `F4.53` rule the instantiate suite follows.
      const location = await ownerPool.query<{ id: string }>(
        `SELECT id FROM bms.locations WHERE organization_id = $1 ORDER BY created_at, code LIMIT 1`,
        [eskomOrgId],
      );
      locationId = location.rows[0]?.id ?? "";
      if (!locationId) throw new Error("F3.73: ESKOM has no location — run pnpm db:seed");
      const group = await ownerPool.query<{ id: string }>(
        `SELECT id FROM bms.asset_groups WHERE organization_id = $1 ORDER BY created_at, code LIMIT 1`,
        [eskomOrgId],
      );
      groupId = group.rows[0]?.id ?? "";
      if (!groupId) throw new Error("F3.73: ESKOM has no asset group — run pnpm db:seed");

      const insert = async (
        code: string,
        target: string,
        status: string,
        content: unknown,
      ): Promise<string> => {
        const row = await ownerPool.query<{ id: string }>(
          `INSERT INTO bms.dashboard_templates
             (organization_id, code, version, name, section, target, status, content, published_at)
           VALUES ($1, $2, 1, 'F3.73 target fixture', $3, $4, $5, $6, $7)
           RETURNING id`,
          [
            eskomOrgId,
            code,
            target === "site" ? "site" : "hvac",
            target,
            status,
            JSON.stringify(content),
            status === "published" ? new Date() : null,
          ],
        );
        const id = row.rows[0]?.id ?? "";
        templateIds.push(id);
        return id;
      };
      siteDraftId = await insert(`f373-site-draft-${RUN}`, "site", "draft", siteContent("electrical"));
      badDomainDraftId = await insert(`f373-site-nope-${RUN}`, "site", "draft", siteContent("nope"));
      badParamsDraftId = await insert(
        `f373-site-params-${RUN}`,
        "site",
        "draft",
        siteContentWithTabSource({
          catalogKey: "alarms.active.count",
          params: { locationId },
          sortOrder: 0,
        }),
      );
      badPointKeyDraftId = await insert(
        `f373-site-pointkey-${RUN}`,
        "site",
        "draft",
        siteContentWithTabSource({
          catalogKey: "sustainability.total",
          params: { pointKey: `f373_absent_${RUN}`, aggregate: "sum" },
          sortOrder: 0,
        }),
      );
      // Written past the schema on purpose: the row a write can no longer make, which publish
      // must still refuse from the stored target.
      siteWithTopLevelDraftId = await insert(`f373-site-top-${RUN}`, "site", "draft", {
        widgets: [tabWidget("top")],
        tabs: [],
      });
      // Its own rows: a surviving mutation of the PATCH refusal wipes these tabs, and the
      // publish case must not depend on that.
      sitePatchDraftId = await insert(`f373-site-patch-${RUN}`, "site", "draft", siteContent("electrical"));
      groupPatchDraftId = await insert(`f373-group-patch-${RUN}`, "asset_group", "draft", {
        widgets: [tabWidget("g0")],
      });
      sitePublishedId = await insert(`f373-site-pub-${RUN}`, "site", "published", siteContent("electrical"));
      groupPublishedId = await insert(`f373-group-pub-${RUN}`, "asset_group", "published", {
        widgets: [tabWidget("g1")],
      });
    }, 60_000);

    afterAll(async () => {
      if (!ownerPool) return;
      // A draft `createDraftFrom` made is found by this run's codes too, so a case that fails
      // before it records the id still leaves nothing behind.
      const drafts = await ownerPool.query<{ id: string }>(
        `SELECT id FROM bms.dashboard_templates WHERE code LIKE 'f373-%' AND code LIKE $1`,
        [`%-${RUN}`],
      );
      templateIds.push(...drafts.rows.map((row) => row.id));
      if (templateIds.length > 0) {
        await ownerPool.query(`DELETE FROM bms.audit_log WHERE entity_id = ANY($1::uuid[])`, [
          templateIds,
        ]);
        await ownerPool.query(`DELETE FROM bms.dashboard_templates WHERE id = ANY($1::uuid[])`, [
          templateIds,
        ]);
      }
      await ownerPool.query(`DELETE FROM bms.dashboards WHERE slug = $1`, [MISMATCH_SLUG]);
      await Promise.all([ownerPool, tenantPool, authPool].filter(Boolean).map((p) => p.end()));
    }, 60_000);

    it("a site template whose only widgets are in tabs publishes", async () => {
      await assertSiteTemplateWithTabWidgetsOnlyPublishes(makeServices().templates, admin, siteDraftId);
    });

    it("publish refuses a tab whose domain is not a live asset domain", async () => {
      await assertUnknownTabDomainIsRefusedAtPublish(
        makeServices().templates,
        admin,
        badDomainDraftId,
        ownerPool,
      );
    });

    it("instantiate refuses a group body on a site template", async () => {
      await assertGroupBodyOnSiteTemplateIsRefused(
        makeServices().instantiate,
        admin,
        sitePublishedId,
        groupId,
        MISMATCH_SLUG,
        ownerPool,
      );
    });

    it("instantiate refuses a site body on an asset-group template", async () => {
      await assertSiteBodyOnGroupTemplateIsRefused(
        makeServices().instantiate,
        admin,
        groupPublishedId,
        locationId,
      );
    });

    it("the site arm answers 501 until the copy action is wired", async () => {
      await assertSiteArmAnswers501UntilWired(makeServices().instantiate, admin, sitePublishedId, locationId);
    });

    it("an injected site arm receives the template and the body", async () => {
      await assertSiteArmReceivesTheTemplateAndBody(
        (arm) => makeServices(arm).instantiate,
        admin,
        sitePublishedId,
        eskomOrgId,
        locationId,
        groupId,
      );
    });

    it("a location admin is refused the site arm by the authorship guard, and the arm is not called", async () => {
      await assertLocationAdminCannotReachTheSiteArm(
        (arm) => makeServices(arm).instantiate,
        jwtFor(SEEDED.locationAdmin, "location_admin"),
        sitePublishedId,
        locationId,
      );
    });

    it("publish checks a tab widget's source params", async () => {
      await assertTabSourceParamsAreCheckedAtPublish(makeServices().templates, admin, badParamsDraftId);
    });

    it("publish checks a tab widget's source point key", async () => {
      await assertTabSourcePointKeysAreCheckedAtPublish(
        makeServices().templates,
        admin,
        badPointKeyDraftId,
      );
    });

    it("publish re-checks the stored target: a site row with top-level widgets is refused", async () => {
      await assertPublishReChecksTheStoredTarget(makeServices().templates, admin, siteWithTopLevelDraftId);
    });

    it("a PATCH is checked against the stored target", async () => {
      await assertPatchIsCheckedAgainstTheStoredTarget(
        makeServices().templates,
        admin,
        badDomainDraftId,
        tabWidget("patched"),
      );
    });

    it("a site PATCH omitting content.tabs is refused and the stored tabs survive", async () => {
      await assertSitePatchWithoutTabsIsRefusedAndKeepsTheTabs(
        makeServices().templates,
        admin,
        sitePatchDraftId,
        ownerPool,
      );
    });

    it("the same site PATCH carrying content.tabs is taken", async () => {
      await assertSitePatchCarryingTabsIsTaken(
        makeServices().templates,
        admin,
        sitePatchDraftId,
        siteContent("electrical").tabs.slice(0, 1),
        ownerPool,
      );
    });

    it("an asset-group PATCH omitting content.tabs is still taken", async () => {
      await assertGroupPatchWithoutTabsIsTaken(
        makeServices().templates,
        admin,
        groupPatchDraftId,
        tabWidget("g1"),
      );
    });

    it("a draft opened from a published site template keeps the site target", async () => {
      const draftId = await assertDraftFromSiteTemplateKeepsTheTarget(
        makeServices().templates,
        admin,
        sitePublishedId,
      );
      templateIds.push(draftId);
    });
  },
);

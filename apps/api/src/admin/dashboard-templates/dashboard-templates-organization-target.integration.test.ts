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
import { primeSeededSubjects } from "../../testing/seeded-subjects";
import { VocabulariesService } from "../../vocabularies/vocabularies.service";
import { MasterDataAuditService } from "../master-data-audit.service";
import {
  DashboardTemplatesInstantiateService,
  type OrganizationTemplateArm,
} from "./dashboard-templates-instantiate.service";
import {
  assertADraftOrganizationTemplateIsRefused,
  assertAForeignOrganizationIdIsA404,
  assertAssetGroupAdminCannotReachTheOrganizationArm,
  assertLocationAdminReachesTheOrganizationArm,
  assertOrganizationArmAnswers501UntilWired,
  assertOrganizationArmReceivesTheTemplateAndBody,
  assertOrganizationBodyOnGroupTemplateIsRefused,
} from "./dashboard-templates-organization-target.integration.spec";
import { DashboardTemplatesService } from "./dashboard-templates.service";

/**
 * `F4.317` task 3.4 — Vitest entry point. Owns the fixtures and cleanup.
 *
 * Three ESKOM template rows, written as the superuser: a PUBLISHED and a DRAFT organization
 * template, and a PUBLISHED asset-group template (the body/target mismatch). Cleanup is by id,
 * and only the ids this suite created.
 */
const connectionString = requireIntegrationDb({
  item: "F4.317",
  label: "the instantiate service's organization arm — the checks before the seam",
  because:
    "the organization arm reads the stored row's target, status and organization, and the " +
    "caller's role and location grants; only real rows prove what it refuses before delegating.",
});

const RUN = randomUUID().replace(/-/g, "").slice(0, 8);

const strip = {
  widgets: [
    {
      key: "alarms-tile",
      title: "Open alarms",
      gridX: 0,
      gridY: 0,
      gridW: 3,
      gridH: 2,
      bindings: [],
      sources: [
        { catalogKey: "alarms.active.count", params: {}, sortOrder: 0 },
        { catalogKey: "alarms.critical.count", params: {}, sortOrder: 1 },
      ],
      widgetType: "value_tile",
      config: { compareToPrevious: true },
    },
  ],
  tabs: [],
};

describe.skipIf(!connectionString)("F4.317 — the instantiate organization arm (seam only)", () => {
  let ownerPool: pg.Pool;
  let tenantPool: pg.Pool;
  let authPool: pg.Pool;
  let fleetDb: BmsDb;

  let eskomOrgId: string;
  let phewbOrgId: string;
  let publishedId: string;
  let draftId: string;
  let groupPublishedId: string;
  const templateIds: string[] = [];
  let admin: JwtPayload;

  const makeService = (arm?: OrganizationTemplateArm): DashboardTemplatesInstantiateService => {
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
    return new DashboardTemplatesInstantiateService(
      fleetDb,
      tenantDb,
      accessControl,
      audit,
      templates,
      undefined,
      arm,
    );
  };

  beforeAll(async () => {
    const url = connectionString as string;
    ownerPool = await openIntegrationPool(resolveIntegrationRoleUrl(url, "superuser", process.env), "F4.317");
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F4.317",
    );
    authPool = await openIntegrationPool(
      process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"),
      "F4.317",
    );
    await primeSeededSubjects(authPool);
    admin = jwtFor(SEEDED.globalAdmin, "admin");
    fleetDb = createDb(await openIntegrationPool(url, "F4.317"));

    const orgs = await ownerPool.query<{ code: string; id: string }>(
      `SELECT code, id FROM bms.organizations WHERE code IN ('ESKOM', 'PHEWB')`,
    );
    eskomOrgId = orgs.rows.find((row) => row.code === "ESKOM")?.id ?? "";
    phewbOrgId = orgs.rows.find((row) => row.code === "PHEWB")?.id ?? "";
    if (!eskomOrgId || !phewbOrgId) throw new Error("F4.317: ESKOM/PHEWB not found — run pnpm db:seed");

    const insert = async (code: string, target: string, status: string, content: unknown): Promise<string> => {
      const row = await ownerPool.query<{ id: string }>(
        `INSERT INTO bms.dashboard_templates
           (organization_id, code, version, name, section, target, status, content, published_at)
         VALUES ($1, $2, 1, 'F4.317 organization arm fixture', $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          eskomOrgId,
          code,
          target === "organization" ? "organization" : "hvac",
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
    publishedId = await insert(`f4317-org-pub-${RUN}`, "organization", "published", strip);
    draftId = await insert(`f4317-org-draft-${RUN}`, "organization", "draft", strip);
    groupPublishedId = await insert(`f4317-group-pub-${RUN}`, "asset_group", "published", strip);
  }, 60_000);

  afterAll(async () => {
    if (!ownerPool) return;
    if (templateIds.length > 0) {
      await ownerPool.query(`DELETE FROM bms.audit_log WHERE entity_id = ANY($1::uuid[])`, [templateIds]);
      await ownerPool.query(`DELETE FROM bms.dashboard_templates WHERE id = ANY($1::uuid[])`, [templateIds]);
    }
    await Promise.all([ownerPool, tenantPool, authPool].filter(Boolean).map((p) => p.end()));
  }, 60_000);

  it("answers 501 while no organization arm is provided", async () => {
    await assertOrganizationArmAnswers501UntilWired(makeService(), admin, publishedId, eskomOrgId);
  });

  it("hands the provided arm the template and the body, and returns its answer", async () => {
    await assertOrganizationArmReceivesTheTemplateAndBody(makeService, admin, publishedId, eskomOrgId);
  });

  it("answers 404 for an organizationId that is not the template's", async () => {
    await assertAForeignOrganizationIdIsA404(makeService, admin, publishedId, phewbOrgId);
  });

  it("lets a location admin of the organization reach the arm (ADR 0112 decision 5)", async () => {
    await assertLocationAdminReachesTheOrganizationArm(
      makeService,
      jwtFor(SEEDED.locationAdmin, "location_admin"),
      publishedId,
      eskomOrgId,
    );
  });

  it("refuses an asset-group admin before the arm", async () => {
    await assertAssetGroupAdminCannotReachTheOrganizationArm(
      makeService,
      jwtFor(SEEDED.assetGroupAdmin, "asset_group_admin"),
      publishedId,
      eskomOrgId,
    );
  });

  it("refuses an organization body on an asset-group template", async () => {
    await assertOrganizationBodyOnGroupTemplateIsRefused(makeService(), admin, groupPublishedId, eskomOrgId);
  });

  it("refuses a draft organization template", async () => {
    await assertADraftOrganizationTemplateIsRefused(makeService(), admin, draftId, eskomOrgId);
  });
});

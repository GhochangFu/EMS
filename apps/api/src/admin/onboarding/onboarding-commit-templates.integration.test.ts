import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb, onboardingSessions } from "@bms/db";
import type { JwtPayload, OnboardingCommitResponseDto, OnboardingDraft } from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { CalcParametersService } from "../../calc/calc-parameters.service";
import { withTenant } from "../../database/tenant-context";
import { openIntegrationPool, requireIntegrationDb } from "../../testing/integration-db-gate";
import { asRole } from "../../testing/role-urls";
import { jwtFor, primeSeededSubjects } from "../../testing/seeded-subjects";
import { VocabulariesService } from "../../vocabularies/vocabularies.service";
import { AssetDashboardsInstantiateService } from "../asset-templates/asset-dashboards-instantiate.service";
import { createAssetTemplateBodySchema } from "../asset-templates/asset-templates.schema";
import { AssetTemplatesAdminService } from "../asset-templates/asset-templates.service";
import { AssetTemplateInstantiationService } from "../asset-templates/asset-templates-instantiate.service";
import { AssetTemplatesStockService } from "../asset-templates/asset-templates-stock.service";
import { STOCK_ASSET_TEMPLATE_CATALOG } from "../asset-templates/stock-catalog/stock-catalog";
import type { StockAssetTemplateEntry } from "../asset-templates/stock-catalog/types";
import { MasterDataAuditService } from "../master-data-audit.service";
import { OnboardingCommitService } from "./onboarding-commit.service";
import {
  ADMIN_EMAIL,
  CODES,
  ORGANIZATION_ADMIN_EMAIL,
  assertATakenTemplatedAssetCodeRefusesTheCommit,
  assertAnOrganizationAdminCommitsAnOrganizationTemplate,
  assertOnlyTheTemplatedAssetsCarryThePin,
  assertTemplatedAssetPointsAreFedByTheNewRtu,
  assertTheAuthoredCommitAnswersTheTemplateCounts,
  assertTheCommitCloseClearsTheRing,
  SEEDED_RING,
  assertTheAuthoredCommitWritesTheFourAuditActions,
  assertTheAuthoredTemplateIsPublished,
  assertTheCommitAndTheRouteWriteTheSameColumns,
  assertTheRefusedCommitWroteNothing,
  assertTheStockCommitSeedsRulesAndDashboards,
  assertTheStockEntryIsStampedAndAuditedAsAnImport,
  authoredDraft,
  cleanup,
  collisionDraft,
  organizationDraft,
  stockDraft,
  type Fixtures,
  type Outcome,
} from "./onboarding-commit-templates.integration.spec";
import { OnboardingTemplateCatalogService } from "./onboarding-template-catalog.service";
import { OnboardingValidateService } from "./onboarding-validate.service";

/**
 * `F3.22` PR 2 — Vitest entry point for the one-transaction template commit
 * (ADR 0091 decisions 4, 5, 10). Assertions live in the sibling `.spec` (ADR
 * 0014); this file owns the database lifecycle, in the shape of
 * `onboarding-commit.service.rls.integration.test.ts`, plus the three template
 * services and the real template catalog — a fake catalog context would fail
 * the commit's own validation before the transaction, and prove nothing.
 */
const connectionString = requireIntegrationDb({
  item: "F3.22",
  label: "the onboarding commit publishes and instantiates templates in its one transaction",
  because:
    "whether a template, an RTU and a point key written earlier in the commit transaction are " +
    "visible to the template cores, whether a refusal rolls back every row of the draft, and " +
    "whether an organization_admin can instantiate onto a location the same transaction wrote " +
    "are database behaviours under the bms_tenant role and FORCE row-level security.",
});

describe.skipIf(!connectionString)("F3.22 — the onboarding commit writes templates in one transaction", () => {
  let ownerPool: pg.Pool | undefined;
  let authPool: pg.Pool | undefined;
  let tenantPool: pg.Pool | undefined;
  let fleetPool: pg.Pool | undefined;
  let fx: Fixtures;
  const auditEntityIds: string[] = [];
  const sessionIds: string[] = [];

  beforeAll(async () => {
    const url = connectionString as string;
    const owner = await openIntegrationPool(url, "F3.22");
    ownerPool = owner;
    authPool = await openIntegrationPool(
      process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"),
      "F3.22",
    );
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F3.22",
    );
    const fleet = await openIntegrationPool(
      process.env.DATABASE_URL_FLEET ?? asRole(url, "bms_fleet", "bms_fleet_dev"),
      "F3.22",
    );
    fleetPool = fleet;

    // A crashed earlier run cannot share this run's prefix, so this sweeps nothing
    // today; it stays so a re-run inside one process starts clean.
    await cleanup(owner, { auditEntityIds: [], sessionIds: [] });

    await primeSeededSubjects(fleet);
    const adminJwt: JwtPayload = jwtFor(ADMIN_EMAIL, "admin");
    const organizationAdminJwt: JwtPayload = jwtFor(ORGANIZATION_ADMIN_EMAIL, "organization_admin");

    const org = await owner.query<{ id: string }>(
      `SELECT uoa.organization_id AS id
         FROM bms.user_organization_access uoa
         JOIN bms.users u ON u.id = uoa.user_id
        WHERE u.email = $1
        LIMIT 1`,
      [ORGANIZATION_ADMIN_EMAIL],
    );
    const organizationId = org.rows[0]?.id;
    const { rows: liveDomains } = await owner.query<{ code: string }>(
      `SELECT code FROM bms.asset_domains WHERE active = true`,
    );
    const { rows: liveKeys } = await owner.query<{ code: string }>(
      `SELECT code FROM bms.point_keys WHERE active = true AND code NOT LIKE 'F322%' ORDER BY code`,
    );
    const domains = new Set(liveDomains.map((row) => row.code));
    const keys = new Set(liveKeys.map((row) => row.code));
    // The smallest shipped entry whose domain and point keys are live here.
    const shipped = [...STOCK_ASSET_TEMPLATE_CATALOG]
      .sort((a, b) => a.points.length - b.points.length)
      .find((entry) => domains.has(entry.domain) && entry.points.every((point) => keys.has(point.pointKey)));
    const anyKey = liveKeys[0]?.code;
    if (!organizationId || !shipped || !anyKey) {
      throw new Error(
        "F3.22 fixtures missing — need phe-admin@bms.local's organization grant, one active point " +
          "key and a shipped stock entry whose domain and point keys are active. Run 'pnpm db:seed'.",
      );
    }
    const domain = shipped.domain;
    // The shipped entry under this run's code, so V10 never meets a code the
    // organization already holds and cleanup deletes only this run's row.
    const stockEntry: StockAssetTemplateEntry = { ...shipped, code: CODES.stock.template };

    const tenantDb = createDb(tenantPool);
    const fleetDb = createDb(fleet);
    const access = new AccessControlService(createDb(authPool), fleetDb);
    const audit = new MasterDataAuditService(tenantDb, fleetDb);
    const vocabularies = new VocabulariesService(tenantDb);
    const templates = new AssetTemplatesAdminService(
      fleetDb,
      tenantDb,
      access,
      audit,
      vocabularies,
      new CalcParametersService(fleetDb),
    );
    const instantiation = new AssetTemplateInstantiationService(
      fleetDb,
      tenantDb,
      access,
      audit,
      vocabularies,
      new AssetDashboardsInstantiateService(fleetDb, tenantDb, templates, audit, access),
    );
    const stock = new AssetTemplatesStockService([stockEntry], access, templates);
    const commitSvc = new OnboardingCommitService(
      fleetDb,
      tenantDb,
      access,
      audit,
      new OnboardingValidateService(),
      vocabularies,
      new OnboardingTemplateCatalogService(fleetDb, stock),
      templates,
      instantiation,
      stock,
    );

    // I4's organization template, published before the run.
    const orgTemplate = await templates.create(
      adminJwt,
      createAssetTemplateBodySchema.parse({
        organizationId,
        code: CODES.organization.template,
        name: "F3.22 organization template",
        assetType: "f322",
        domain,
        points: [{ pointKey: anyKey, kind: "measured", sourceDataKeyPattern: "{asset_code}_O" }],
      }),
    );
    await templates.publish(adminJwt, orgTemplate.id);
    auditEntityIds.push(orgTemplate.id);

    // I3's held asset code, on its own location in the same organization.
    const held = await owner.query<{ id: string }>(
      `INSERT INTO bms.locations (organization_id, code, slug, name, type, latitude, longitude)
       VALUES ($1, $2, $3, 'F3.22 held-code location', 'smoc_campus', 0, 0)
       RETURNING id`,
      [organizationId, CODES.collision.existingLocation, CODES.collision.existingLocation.toLowerCase()],
    );
    await owner.query(
      `INSERT INTO bms.assets (organization_id, code, name, site_name, location_id, domain)
       VALUES ($1, $2, 'F3.22 held code', 'F3.22 Site', $3, $4)`,
      [organizationId, CODES.collision.taken, held.rows[0]?.id, domain],
    );

    const seedSession = async (draft: OnboardingDraft): Promise<string> => {
      const id = await withTenant(tenantDb, organizationId, async (tx) => {
        const [row] = await tx
          .insert(onboardingSessions)
          .values({ organizationId, status: "draft", currentPhase: "review", draft, checkpoints: SEEDED_RING })
          .returning({ id: onboardingSessions.id });
        return row.id;
      });
      sessionIds.push(id);
      auditEntityIds.push(id);
      return id;
    };
    const ids = {
      authored: await seedSession(authoredDraft(domain)),
      stock: await seedSession(stockDraft(stockEntry)),
      collision: await seedSession(collisionDraft(domain, anyKey)),
      organization: await seedSession(organizationDraft(domain)),
    };

    const commit = async (jwt: JwtPayload, sessionId: string): Promise<Outcome> => {
      try {
        const result: OnboardingCommitResponseDto = await commitSvc.commit(jwt, sessionId);
        auditEntityIds.push(result.locationId, ...result.templateIds);
        return { ok: true, result };
      } catch (error) {
        return { ok: false, error };
      }
    };
    const outcomes = {
      authored: await commit(adminJwt, ids.authored),
      stock: await commit(adminJwt, ids.stock),
      collision: await commit(adminJwt, ids.collision),
      // Decision 5: the organization_admin, not the global admin, who passes
      // canManageLocation whatever the option says.
      organization: await commit(organizationAdminJwt, ids.organization),
    };

    fx = { fleet, organizationId, adminJwt, instantiation, stockEntry, sessionIds: ids, outcomes };
  }, 120_000);

  afterAll(async () => {
    if (ownerPool) {
      await cleanup(ownerPool, { auditEntityIds, sessionIds });
    }
    await Promise.all([ownerPool?.end(), authPool?.end(), tenantPool?.end(), fleetPool?.end()]);
  });

  it("I1: the result carries one template, two templated assets and their points", () => {
    assertTheAuthoredCommitAnswersTheTemplateCounts(fx);
  });

  it("I1: the authored template is published at version 1", async () => {
    await assertTheAuthoredTemplateIsPublished(fx);
  });

  it("I1: only the templated assets carry template_id", async () => {
    await assertOnlyTheTemplatedAssetsCarryThePin(fx);
  });

  it("I1: the four audit actions are written, in one organization", async () => {
    await assertTheAuthoredCommitWritesTheFourAuditActions(fx);
  });

  it("I2: a stock entry is stamped and audited as an import", async () => {
    await assertTheStockEntryIsStampedAndAuditedAsAnImport(fx);
  });

  it("I2: the stock entry's alarms and views seed rules and dashboards in the commit", () => {
    assertTheStockCommitSeedsRulesAndDashboards(fx);
  });

  it("I3: a taken templated asset code refuses the commit with the core's text", () => {
    assertATakenTemplatedAssetCodeRefusesTheCommit(fx);
  });

  it("I3: the refused commit wrote nothing and the session is still a draft", async () => {
    await assertTheRefusedCommitWroteNothing(fx);
  });

  it("F3.25: the commit close clears the checkpoint ring; the refused commit keeps it", async () => {
    await assertTheCommitCloseClearsTheRing(fx);
  });

  it("I4: an organization_admin commits an organization template onto the new RTU", async () => {
    await assertAnOrganizationAdminCommitsAnOrganizationTemplate(fx);
  });

  it("I5: each templated asset has one point per measured template point, on the new RTU", async () => {
    await assertTemplatedAssetPointsAreFedByTheNewRtu(fx);
  });

  it("I5: the commit and the instantiate route fill the same asset-point columns", async () => {
    await assertTheCommitAndTheRouteWriteTheSameColumns(fx);
  });
});

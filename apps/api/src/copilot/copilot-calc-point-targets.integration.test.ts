import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { assetPoints, assets, assetTemplates, createDb } from "@bms/db";

import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import { registerFixturePointKeys } from "../testing/integration-fixtures";
import { asRole } from "../testing/role-urls";
import {
  anAssetOutsideTheAllowedOrganizationsIsRefused,
  aPinnedAssetInTheListIsRefused,
  type CalcPointTargetsCtx,
  twentySixIdsAreRefused,
  twoOrganizationsAreRefused,
  twoTemplateLessAssetsResolveToTheirOrganization,
} from "./copilot-calc-point-targets.integration.spec";

/**
 * `F4.311` PR 3 — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns the database lifecycle: one template version and
 * four fixture assets (three in one seeded organization, one pinned, and one
 * in a second), their points on two per-run catalog keys, committed with ids
 * registered before the insert and deleted in `afterAll`.
 */
const connectionString = requireIntegrationDb({
  item: "F4.311",
  label: "the copilot's calcPointBatch target against real, non-owner roles",
  because:
    "a batch card's organization is the one that holds every listed asset with no template, read " +
    "under each allowed organization's tenant policy. Only a real bms_tenant connection proves a " +
    "pinned asset or another organization's asset is never found, so such a batch is refused.",
});

// Per-run fixture codes (F4.65): randomUUID() sits in each const's own declaration because the isolation
// invariant (tests/integration-fixture-isolation.test.ts) reads it literally.
const PREFIX = `F4311T-${randomUUID().replace(/-/g, "").slice(0, 12)}-`;
const SHARED_KEY = `f4311t_shared_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
const ONLY_A1_KEY = `f4311t_only_${randomUUID().replace(/-/g, "").slice(0, 10)}`;

describe.skipIf(!connectionString)("F4.311 PR 3 — the calcPointBatch target under real RLS", () => {
  let ownerPool: pg.Pool;
  let tenantPool: pg.Pool;
  let ctx: CalcPointTargetsCtx;
  let releasePointKeys: (() => Promise<void>) | undefined;
  // Registered before the insert, so a failure between insert and assignment leaves nothing behind.
  const fixtureAssetIds: string[] = [];
  const fixtureTemplateIds: string[] = [];

  beforeAll(async () => {
    const url = connectionString as string;
    ownerPool = await openIntegrationPool(url, "F4.311");
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F4.311",
    );
    releasePointKeys = await registerFixturePointKeys(ownerPool, [SHARED_KEY, ONLY_A1_KEY]);
    const orgs = await ownerPool.query<{ id: string }>(
      `SELECT o.id FROM bms.organizations o
        WHERE EXISTS (SELECT 1 FROM bms.locations l WHERE l.organization_id = o.id AND l.active = true)
        ORDER BY o.created_at, o.code LIMIT 2`,
    );
    const [orgA, orgB] = orgs.rows;
    if (!orgA || !orgB) throw new Error("F4.311: need two seeded organizations with an active location — run pnpm db:seed.");
    const locationOf = async (organizationId: string): Promise<string> => {
      const loc = await ownerPool.query<{ id: string }>(
        `SELECT id FROM bms.locations WHERE organization_id = $1 AND active = true ORDER BY created_at, code LIMIT 1`,
        [organizationId],
      );
      return loc.rows[0]?.id as string;
    };
    const dom = await ownerPool.query<{ code: string }>("SELECT code FROM bms.asset_domains WHERE active = true ORDER BY code LIMIT 1");
    const domain = dom.rows[0]?.code;
    if (!domain) throw new Error("F4.311: no active asset_domain — run pnpm db:seed.");

    const fleetDb = createDb(ownerPool);
    const templateId = randomUUID();
    fixtureTemplateIds.push(templateId);
    await fleetDb.insert(assetTemplates).values({
      id: templateId,
      organizationId: orgA.id,
      code: `${PREFIX}TPL`,
      version: 1,
      name: "F4.311 target template",
      assetType: "test_rig",
      domain,
      status: "published",
      publishedAt: new Date(),
    });
    const seedAsset = async (organizationId: string, suffix: string, keys: string[], pinned: string | null = null) => {
      const id = randomUUID();
      fixtureAssetIds.push(id);
      await fleetDb.insert(assets).values({
        id,
        organizationId,
        code: `${PREFIX}${suffix}`,
        name: `F4.311 target asset ${suffix}`,
        siteName: "F4.311 Site",
        locationId: await locationOf(organizationId),
        domain,
        templateId: pinned,
        active: true,
      });
      for (const pointKey of keys) {
        await fleetDb.insert(assetPoints).values({
          organizationId,
          assetId: id,
          pointKey,
          sourceDataKey: `${PREFIX}${suffix}/${pointKey}`,
          sourceKind: "unmapped",
          rtuId: null,
          active: true,
        });
      }
      return id;
    };
    ctx = {
      tenantDb: createDb(tenantPool),
      orgA: orgA.id,
      orgB: orgB.id,
      bareA1: await seedAsset(orgA.id, "A1", [SHARED_KEY, ONLY_A1_KEY]),
      bareA2: await seedAsset(orgA.id, "A2", [SHARED_KEY]),
      pinnedA: await seedAsset(orgA.id, "AP", [SHARED_KEY], templateId),
      bareB: await seedAsset(orgB.id, "B", [SHARED_KEY]),
      sharedKey: SHARED_KEY,
      onlyA1Key: ONLY_A1_KEY,
    };
  });

  afterAll(async () => {
    if (ownerPool && fixtureAssetIds.length > 0) {
      await ownerPool.query("DELETE FROM bms.asset_points WHERE asset_id = ANY($1)", [fixtureAssetIds]);
      await ownerPool.query("DELETE FROM bms.assets WHERE id = ANY($1)", [fixtureAssetIds]);
    }
    if (ownerPool && fixtureTemplateIds.length > 0) {
      await ownerPool.query("DELETE FROM bms.asset_templates WHERE id = ANY($1)", [fixtureTemplateIds]);
    }
    await releasePointKeys?.();
    await Promise.all([ownerPool, tenantPool].filter(Boolean).map((pool) => pool.end()));
  });

  it("two template-less assets of one organization resolve to it, with the keys both have", () =>
    twoTemplateLessAssetsResolveToTheirOrganization(ctx));
  it("a template-pinned asset in the list is refused", () => aPinnedAssetInTheListIsRefused(ctx));
  it("twenty-six ids are refused", () => twentySixIdsAreRefused(ctx));
  it("assets of two organizations are refused", () => twoOrganizationsAreRefused(ctx));
  it("an asset outside the allowed organizations is refused", () => anAssetOutsideTheAllowedOrganizationsIsRefused(ctx));
});

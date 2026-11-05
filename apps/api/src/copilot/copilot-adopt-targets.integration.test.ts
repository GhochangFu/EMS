import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { assets, assetTemplates, createDb } from "@bms/db";

import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";
import {
  type AdoptTargetsCtx,
  anAssetOfTheOtherOrganizationIsRefused,
  aPinnedAssetIsRefused,
  aTemplateLessAssetOfTheVersionsOrganizationResolves,
  anAssetFoundNowhereKeepsTheGeneralRefusal,
  aMalformedVersionIdIsTheMalformedSentence,
} from "./copilot-adopt-targets.integration.spec";

/**
 * `F4.312` PR 2 — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns the database lifecycle: one published version in
 * the first seeded organization and three fixture assets (a template-less and
 * a pinned one in that organization, a template-less one in a second),
 * committed with ids registered before the insert and deleted in `afterAll`.
 */
const connectionString = requireIntegrationDb({
  item: "F4.312",
  label: "the copilot's assetTemplateAdopt target against real, non-owner roles",
  because:
    "an adoption card lists assets of the version's organization with no template, read under " +
    "that organization's tenant policy. Only a real bms_tenant connection proves a pinned asset or " +
    "another organization's asset is never admitted, so such a batch is refused.",
});

// Per-run fixture codes (F4.65): randomUUID() sits in the const's own declaration because the isolation
// invariant (tests/integration-fixture-isolation.test.ts) reads it literally.
const PREFIX = `F4312T-${randomUUID().replace(/-/g, "").slice(0, 12)}-`;

describe.skipIf(!connectionString)("F4.312 PR 2 — the assetTemplateAdopt target under real RLS", () => {
  let ownerPool: pg.Pool;
  let tenantPool: pg.Pool;
  let ctx: AdoptTargetsCtx;
  // Registered before the insert, so a failure between insert and assignment leaves nothing behind.
  const fixtureAssetIds: string[] = [];
  const fixtureTemplateIds: string[] = [];

  beforeAll(async () => {
    const url = connectionString as string;
    ownerPool = await openIntegrationPool(url, "F4.312");
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F4.312",
    );
    const orgs = await ownerPool.query<{ id: string }>(
      `SELECT o.id FROM bms.organizations o
        WHERE EXISTS (SELECT 1 FROM bms.locations l WHERE l.organization_id = o.id AND l.active = true)
        ORDER BY o.created_at, o.code LIMIT 2`,
    );
    const [orgA, orgB] = orgs.rows;
    if (!orgA || !orgB) throw new Error("F4.312: need two seeded organizations with an active location — run pnpm db:seed.");
    const locationOf = async (organizationId: string): Promise<string> => {
      const loc = await ownerPool.query<{ id: string }>(
        `SELECT id FROM bms.locations WHERE organization_id = $1 AND active = true ORDER BY created_at, code LIMIT 1`,
        [organizationId],
      );
      return loc.rows[0]?.id as string;
    };
    const dom = await ownerPool.query<{ code: string }>("SELECT code FROM bms.asset_domains WHERE active = true ORDER BY code LIMIT 1");
    const domain = dom.rows[0]?.code;
    if (!domain) throw new Error("F4.312: no active asset_domain — run pnpm db:seed.");

    const fleetDb = createDb(ownerPool);
    const versionA = randomUUID();
    fixtureTemplateIds.push(versionA);
    await fleetDb.insert(assetTemplates).values({
      id: versionA,
      organizationId: orgA.id,
      code: `${PREFIX}TPL`,
      version: 1,
      name: "F4.312 adopt target template",
      assetType: "test_rig",
      domain,
      status: "published",
      publishedAt: new Date(),
    });
    const seedAsset = async (organizationId: string, suffix: string, pinned: string | null = null) => {
      const id = randomUUID();
      fixtureAssetIds.push(id);
      await fleetDb.insert(assets).values({
        id,
        organizationId,
        code: `${PREFIX}${suffix}`,
        name: `F4.312 adopt target asset ${suffix}`,
        siteName: "F4.312 Site",
        locationId: await locationOf(organizationId),
        domain,
        templateId: pinned,
        active: true,
      });
      return id;
    };
    ctx = {
      tenantDb: createDb(tenantPool),
      orgA: orgA.id,
      orgB: orgB.id,
      versionA,
      versionCode: `${PREFIX}TPL`,
      bareA: await seedAsset(orgA.id, "A"),
      pinnedA: await seedAsset(orgA.id, "AP", versionA),
      pinnedACode: `${PREFIX}AP`,
      bareB: await seedAsset(orgB.id, "B"),
      bareBCode: `${PREFIX}B`,
    };
  });

  afterAll(async () => {
    if (ownerPool && fixtureAssetIds.length > 0) {
      await ownerPool.query("DELETE FROM bms.assets WHERE id = ANY($1)", [fixtureAssetIds]);
    }
    if (ownerPool && fixtureTemplateIds.length > 0) {
      await ownerPool.query("DELETE FROM bms.asset_templates WHERE id = ANY($1)", [fixtureTemplateIds]);
    }
    await Promise.all([ownerPool, tenantPool].filter(Boolean).map((pool) => pool.end()));
  });

  it("a template-less asset of the version's organization resolves to it", () =>
    aTemplateLessAssetOfTheVersionsOrganizationResolves(ctx));
  it("an asset of the other organization is refused by the organization sentence", () => anAssetOfTheOtherOrganizationIsRefused(ctx));
  it("a pinned asset in the list is refused by the pinned sentence", () => aPinnedAssetIsRefused(ctx));
  it("an asset found in no allowed organization keeps the general refusal", () =>
    anAssetFoundNowhereKeepsTheGeneralRefusal(ctx, randomUUID()));
  it("a non-UUID version id is the malformed sentence", () => aMalformedVersionIdIsTheMalformedSentence(ctx));
});

import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { assets, createDb } from "@bms/db";

import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";
import {
  anAssetOutsideTheAllowedOrganizationsIsRefused,
  aRowWhoseAssetIsOutsideTheReadScopeIsRefused,
  rowsSplitAcrossOrganizationsAreRefused,
  type RuleTargetsCtx,
  theGateIsTheConfigurationRoleClass,
  twoRowsOnOneOrganizationResolveToIt,
} from "./copilot-rule-targets.integration.spec";

/**
 * `F4.289` — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns the database lifecycle: three fixture assets (two
 * in one seeded organization, one in a second), committed with ids registered
 * before the insert and deleted in `afterAll`.
 */
const connectionString = requireIntegrationDb({
  item: "F4.289",
  label: "the copilot's ruleBatch target against real, non-owner roles",
  because:
    "a batch card's organization is the one that holds every row's asset, read under each allowed " +
    "organization's tenant policy. Only a real bms_tenant connection proves an asset of another " +
    "organization is never found, so a batch split across two organizations is refused.",
});

// Per-run fixture prefix (F4.65): every asset code starts with it. randomUUID() sits in PREFIX's own
// declaration because the isolation invariant (tests/integration-fixture-isolation.test.ts) reads it literally.
const PREFIX = `F4289T-${randomUUID().replace(/-/g, "").slice(0, 12)}-`;

describe.skipIf(!connectionString)("F4.289 — the ruleBatch target under real RLS", () => {
  let ownerPool: pg.Pool;
  let tenantPool: pg.Pool;
  let ctx: RuleTargetsCtx;
  // Registered before the insert, so a failure between insert and assignment leaves nothing behind.
  const fixtureAssetIds: string[] = [];

  beforeAll(async () => {
    const url = connectionString as string;
    ownerPool = await openIntegrationPool(url, "F4.289");
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F4.289",
    );
    const orgs = await ownerPool.query<{ id: string; name: string }>(
      `SELECT o.id, o.name FROM bms.organizations o
        WHERE EXISTS (SELECT 1 FROM bms.locations l WHERE l.organization_id = o.id AND l.active = true)
        ORDER BY o.created_at, o.code LIMIT 2`,
    );
    const [orgA, orgB] = orgs.rows;
    if (!orgA || !orgB) throw new Error("F4.289: need two seeded organizations with an active location — run pnpm db:seed.");
    const locationOf = async (organizationId: string): Promise<string> => {
      const loc = await ownerPool.query<{ id: string }>(
        `SELECT id FROM bms.locations WHERE organization_id = $1 AND active = true ORDER BY created_at, code LIMIT 1`,
        [organizationId],
      );
      return loc.rows[0]?.id as string;
    };
    const dom = await ownerPool.query<{ code: string }>("SELECT code FROM bms.asset_domains WHERE active = true ORDER BY code LIMIT 1");
    const domain = dom.rows[0]?.code;
    if (!domain) throw new Error("F4.289: no active asset_domain — run pnpm db:seed.");

    const fleetDb = createDb(ownerPool);
    const seedAsset = async (organizationId: string, suffix: string): Promise<string> => {
      const id = randomUUID();
      fixtureAssetIds.push(id);
      await fleetDb.insert(assets).values({
        id,
        organizationId,
        code: `${PREFIX}${suffix}`,
        name: `F4.289 target asset ${suffix}`,
        siteName: "F4.289 Site",
        locationId: await locationOf(organizationId),
        domain,
        active: true,
      });
      return id;
    };
    ctx = {
      tenantDb: createDb(tenantPool),
      orgA: orgA.id,
      orgB: orgB.id,
      orgNameA: orgA.name,
      assetA1: await seedAsset(orgA.id, "A1"),
      assetA2: await seedAsset(orgA.id, "A2"),
      assetB: await seedAsset(orgB.id, "B"),
    };
  });

  afterAll(async () => {
    if (ownerPool && fixtureAssetIds.length > 0) {
      await ownerPool.query("DELETE FROM bms.assets WHERE id = ANY($1)", [fixtureAssetIds]);
    }
    await Promise.all([ownerPool, tenantPool].filter(Boolean).map((pool) => pool.end()));
  });

  it("two rows on one organization resolve to it", () => twoRowsOnOneOrganizationResolveToIt(ctx));
  it("rows split across organizations are refused", () => rowsSplitAcrossOrganizationsAreRefused(ctx));
  it("an asset outside the allowed organizations is refused", () => anAssetOutsideTheAllowedOrganizationsIsRefused(ctx));
  it("a row whose asset is outside the read scope is refused", () => aRowWhoseAssetIsOutsideTheReadScopeIsRefused(ctx));
  it("the gate is the configuration role class", () => theGateIsTheConfigurationRoleClass(ctx));
});

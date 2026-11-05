import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";

import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";
import {
  anAssetOnAnRtuIsNamedByItsRtu,
  anAssetWithNoRtuIsNamedByItsLocation,
  type AssetTargetsCtx,
} from "./copilot-asset-targets.integration.spec";

/**
 * `F4.316` PR 7 — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns the database lifecycle: one RTU and two assets
 * (one on it, one with no RTU) at a seeded site, committed with ids registered
 * before the insert and deleted in `afterAll`.
 */
const connectionString = requireIntegrationDb({
  item: "F4.316",
  label: "the copilot's asset target names the asset by its label",
  because:
    "a card's asset name is read through LEFT JOINs to bms.rtus and bms.locations under the " +
    "asset's tenant policy. Only a real bms_tenant connection proves the joined names are visible " +
    "there and an asset with no RTU is still found.",
});

// Per-run fixture codes (F4.65): randomUUID() sits in the const's own declaration.
const PREFIX = `F4316C-${randomUUID().replace(/-/g, "").slice(0, 12)}-`;

describe.skipIf(!connectionString)("F4.316 PR 7 — the copilot's asset target under real RLS", () => {
  let ownerPool: pg.Pool;
  let tenantPool: pg.Pool;
  let ctx: AssetTargetsCtx;
  const fixtureAssetIds: string[] = [];
  const fixtureRtuIds: string[] = [];

  beforeAll(async () => {
    const url = connectionString as string;
    ownerPool = await openIntegrationPool(url, "F4.316");
    tenantPool = await openIntegrationPool(process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"), "F4.316");
    const site = await ownerPool.query<{ id: string; organization_id: string; name: string }>(
      `SELECT id, organization_id, name FROM bms.locations WHERE active = true ORDER BY created_at, code LIMIT 1`,
    );
    const location = site.rows[0];
    if (!location) throw new Error("F4.316: need a seeded active location — run pnpm db:seed.");
    const dom = await ownerPool.query<{ code: string }>("SELECT code FROM bms.asset_domains WHERE active = true ORDER BY code LIMIT 1");
    const domain = dom.rows[0]?.code;
    if (!domain) throw new Error("F4.316: no active asset_domain — run pnpm db:seed.");

    const rtuId = randomUUID();
    const rtuName = `${PREFIX}RTU name`;
    fixtureRtuIds.push(rtuId);
    await ownerPool.query(
      "INSERT INTO bms.rtus (id, organization_id, location_id, code, display_name, source_type) VALUES ($1, $2, $3, $4, $5, 'simulator')",
      [rtuId, location.organization_id, location.id, `${PREFIX}RTU`, rtuName],
    );
    const seedAsset = async (suffix: string, rtu: string | null) => {
      const id = randomUUID();
      fixtureAssetIds.push(id);
      await ownerPool.query(
        `INSERT INTO bms.assets (id, organization_id, code, name, site_name, location_id, rtu_id, domain)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, location.organization_id, `${PREFIX}${suffix}`, `F4.316 asset ${suffix}`, location.name, location.id, rtu, domain],
      );
      return id;
    };
    ctx = {
      tenantDb: createDb(tenantPool),
      organizationId: location.organization_id,
      withRtu: await seedAsset("R", rtuId),
      withRtuCode: `${PREFIX}R`,
      withoutRtu: await seedAsset("N", null),
      withoutRtuCode: `${PREFIX}N`,
      rtuName,
      locationName: location.name,
    };
  });

  afterAll(async () => {
    if (ownerPool && fixtureAssetIds.length > 0) await ownerPool.query("DELETE FROM bms.assets WHERE id = ANY($1)", [fixtureAssetIds]);
    if (ownerPool && fixtureRtuIds.length > 0) await ownerPool.query("DELETE FROM bms.rtus WHERE id = ANY($1)", [fixtureRtuIds]);
    await Promise.all([ownerPool, tenantPool].filter(Boolean).map((pool) => pool.end()));
  });

  it("names an asset on an RTU <code> · <RTU display name>", () => anAssetOnAnRtuIsNamedByItsRtu(ctx));
  it("names an asset with no RTU <code> · <location name>", () => anAssetWithNoRtuIsNamedByItsLocation(ctx));
});

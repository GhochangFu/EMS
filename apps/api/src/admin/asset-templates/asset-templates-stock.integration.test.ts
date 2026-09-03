import pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";
import type { AdminAssetTemplateDto } from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { VocabulariesService } from "../../vocabularies/vocabularies.service";
import { MasterDataAuditService } from "../master-data-audit.service";
import { AssetTemplatesAdminService } from "./asset-templates.service";
import { AssetTemplatesStockService } from "./asset-templates-stock.service";
import {
  assertAMechanicalEntryImportsAndPublishes,
  assertForeignOrganizationIsRefused,
  assertImportCopiesTheCatalogNotAPeer,
  assertImportLandsAStampedDraft,
  assertImportRunsEveryAuthoringGuard,
  assertListNeedsAMasterDataRole,
  assertLocationAdminCannotImport,
  assertReImportOpensTheNextVersion,
  assertTheShippedFeederImportsWholeAgainstTheRealVocabulary,
  assertUnknownCodeIs400NamingTheAvailableCodes,
  buildFixtureCatalog,
  cleanup,
  loadFixtures,
  mintInactiveKey,
  type Fixtures,
} from "./asset-templates-stock.integration.spec";
import { STOCK_ASSET_TEMPLATE_CATALOG } from "./stock-catalog/stock-catalog";
import type { StockAssetTemplateEntry } from "./stock-catalog/types";
import {
  openIntegrationPool,
  requireIntegrationDb,
} from "../../testing/integration-db-gate";
import { asRole } from "../../testing/role-urls";

/**
 * `F2.13` — Vitest entry point for the stock list/import. Assertions live in
 * the sibling `.spec` (ADR 0014); this file owns the database lifecycle and
 * builds the three service instances (fixture, empty, real catalog) by hand —
 * `F4.20`: no `design:paramtypes` here, so no Nest module.
 */
const connectionString = requireIntegrationDb({
  item: "F2.13",
  label: "asset-template stock catalog import tests",
  because:
    "the version bump on re-import, the peer-mutation property, the inactive-key refusal " +
    "before the insert, and the shipped feeder importing and publishing against the seeded " +
    "vocabulary are database behaviours — a green run without them asserts nothing.",
});

function stageOutput<T>(value: T | undefined, produced: string): T {
  if (value === undefined) {
    throw new Error(
      `this stage needs the ${produced}, which was never produced: an earlier stage failed.`,
    );
  }
  return value;
}

describe.skipIf(!connectionString)("F2.13 — stock asset-template catalog: list and import", () => {
  let pool: pg.Pool | undefined;
  let authPool: pg.Pool | undefined;
  let tenantPool: pg.Pool | undefined;
  let fleetPool: pg.Pool | undefined;
  let svc: AssetTemplatesAdminService;
  let stock: AssetTemplatesStockService;
  let emptyStock: AssetTemplatesStockService;
  let realStock: AssetTemplatesStockService;
  let fx: Fixtures;
  let first: AdminAssetTemplateDto | undefined;

  function requirePool(): pg.Pool {
    if (!pool) {
      throw new Error("pool is required — beforeAll did not run");
    }
    return pool;
  }

  beforeAll(async () => {
    const url = connectionString as string;
    pool = await openIntegrationPool(url, "F2.13");
    authPool = await openIntegrationPool(
      process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"),
      "F2.13",
    );
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F2.13",
    );
    fleetPool = await openIntegrationPool(
      process.env.DATABASE_URL_FLEET ?? asRole(url, "bms_fleet", "bms_fleet_dev"),
      "F2.13",
    );

    const tenantDb = createDb(tenantPool);
    const fleetDb = createDb(fleetPool);
    const accessControl = new AccessControlService(createDb(authPool), fleetDb);
    svc = new AssetTemplatesAdminService(
      fleetDb,
      tenantDb,
      accessControl,
      new MasterDataAuditService(tenantDb, fleetDb),
      new VocabulariesService(tenantDb),
    );
    fx = await loadFixtures(pool);
    await mintInactiveKey(pool);

    const makeStock = (catalog: readonly StockAssetTemplateEntry[]) =>
      new AssetTemplatesStockService(catalog, accessControl, svc);
    stock = makeStock(buildFixtureCatalog(fx));
    emptyStock = makeStock([]);
    realStock = makeStock(STOCK_ASSET_TEMPLATE_CATALOG);
  });

  afterAll(async () => {
    if (pool) {
      await cleanup(pool);
    }
    await Promise.all([pool?.end(), authPool?.end(), tenantPool?.end(), fleetPool?.end()]);
  });

  it("imports an entry as a stamped draft at version 1 with its points written", async () => {
    first = await assertImportLandsAStampedDraft(stock, requirePool(), fx);
  });

  it("opens the next version on a re-import, still stamped (ADR 0052 decision 4)", async () => {
    await assertReImportOpensTheNextVersion(stock, svc, fx, stageOutput(first, "first import"));
  });

  it("copies the catalog, never a peer organization's edited row (ADR 0049 decision 3)", async () => {
    await assertImportCopiesTheCatalogNotAPeer(stock, requirePool(), fx);
  });

  it("runs every authoring guard — an inactive point key and an unknown domain are refused before the insert", async () => {
    await assertImportRunsEveryAuthoringGuard(stock, requirePool(), fx);
  });

  it("imports the shipped electrical-feeder whole against the seeded vocabulary, then publishes it", async () => {
    await assertTheShippedFeederImportsWholeAgainstTheRealVocabulary(realStock, svc, requirePool(), fx);
  });

  it("imports the shipped mechanical-pump under the seeded mechanical domain, then publishes it", async () => {
    await assertAMechanicalEntryImportsAndPublishes(realStock, svc, requirePool(), fx);
  });

  it("refuses an unknown code with a 400 naming the available codes — and with an empty catalog", async () => {
    await assertUnknownCodeIs400NamingTheAvailableCodes(stock, emptyStock, fx);
  });

  it("refuses a location admin", async () => {
    await assertLocationAdminCannotImport(stock, fx);
  });

  it("refuses an organization admin of another organization", async () => {
    await assertForeignOrganizationIsRefused(stock, fx);
  });

  it("refuses the catalog list to a principal without a master-data role", async () => {
    await assertListNeedsAMasterDataRole(stock);
  });
});

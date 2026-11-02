import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";

import { AccessControlService } from "../../auth/access-control.service";
import { MasterDataAuditService } from "../master-data-audit.service";
import { openIntegrationPool, requireIntegrationDb } from "../../testing/integration-db-gate";
import { asRole } from "../../testing/role-urls";
import { VocabulariesService } from "../../vocabularies/vocabularies.service";
import { LocationsAdminService } from "./locations.service";
import {
  createAuditCarriesTheBody,
  createConvertsSquareFeet,
  createStoresSquareMetres,
  createWithoutTheKeyStoresNull,
  dtoParsesWithAndWithoutAnArea,
  updateReplaces,
  updateWithNullClears,
  updateWithoutTheKeyKeeps,
  type FloorAreaCtx,
} from "./locations.floor-area.integration.spec";
import { jwtFor, primeSeededSubjects } from "../../testing/seeded-subjects";

/**
 * `F4.304` — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns the database lifecycle, on the
 * `locations.timezone.integration.test.ts` harness.
 */
const connectionString = requireIntegrationDb({
  item: "F4.304",
  label: "bms.locations.floor_area_m2 on the LocationsAdminService write path",
  because: "the column, its CHECK and the numeric(12,2) rounding exist only in the real database.",
});

const ORGANIZATION_ADMIN_EMAIL = "phe-admin@bms.local";
const FAMILY = `F4304-FA-${Date.now()}`;

describe.skipIf(!connectionString)("F4.304 — locations.floor_area_m2 on the admin write path", () => {
  let fleetPool: pg.Pool;
  let authPool: pg.Pool;
  let tenantPool: pg.Pool;
  let ctx: FloorAreaCtx;
  const createdIds: string[] = [];

  beforeAll(async () => {
    const url = connectionString as string;
    fleetPool = await openIntegrationPool(
      process.env.DATABASE_URL_FLEET ?? asRole(url, "bms_fleet", "bms_fleet_dev"),
      "F4.304",
    );
    await primeSeededSubjects(fleetPool);
    authPool = await openIntegrationPool(
      process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"),
      "F4.304",
    );
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F4.304",
    );
    const { rows } = await fleetPool.query<{ id: string }>(
      `SELECT uoa.organization_id AS id
         FROM bms.user_organization_access uoa
         JOIN bms.users u ON u.id = uoa.user_id
        WHERE u.email = $1
        LIMIT 1`,
      [ORGANIZATION_ADMIN_EMAIL],
    );
    if (!rows[0]) {
      throw new Error(`F4.304: ${ORGANIZATION_ADMIN_EMAIL} has no organization grant — run pnpm db:seed.`);
    }
    const svc = new LocationsAdminService(
      createDb(fleetPool),
      createDb(tenantPool),
      new AccessControlService(createDb(authPool), createDb(fleetPool)),
      new MasterDataAuditService(createDb(tenantPool), createDb(fleetPool)),
      new VocabulariesService(createDb(tenantPool)),
    );
    ctx = {
      svc,
      fleetPool,
      organizationId: rows[0].id,
      jwt: jwtFor(ORGANIZATION_ADMIN_EMAIL, "organization_admin"),
      register: (id) => createdIds.push(id),
      family: FAMILY,
    };
  });

  afterAll(async () => {
    if (createdIds.length > 0) {
      await fleetPool.query(
        "DELETE FROM bms.audit_log WHERE entity_type = 'location' AND entity_id = ANY($1)",
        [createdIds],
      );
      await fleetPool.query("DELETE FROM bms.locations WHERE id = ANY($1)", [createdIds]);
    }
    await Promise.all([fleetPool.end(), authPool.end(), tenantPool.end()]);
  });

  it("A1 create with 1000 ft2 stores 92.90 m2 and the DTO reads 92.9", async () => {
    await createConvertsSquareFeet(ctx);
  });

  it("A2 create with 120 m2 stores 120.00", async () => {
    await createStoresSquareMetres(ctx);
  });

  it("A3 create without the key stores NULL", async () => {
    await createWithoutTheKeyStoresNull(ctx);
  });

  it("A4 update with floorArea null clears it", async () => {
    await updateWithNullClears(ctx);
  });

  it("A5 update without the key keeps it", async () => {
    await updateWithoutTheKeyKeeps(ctx);
  });

  it("A6 update with a new value replaces it", async () => {
    await updateReplaces(ctx);
  });

  it("A7 the DTO parses with adminLocationDtoSchema with and without an area", async () => {
    await dtoParsesWithAndWithoutAnArea(ctx);
  });

  it("A8 the create audit payload carries floorArea with value and unit", async () => {
    await createAuditCarriesTheBody(ctx);
  });
});

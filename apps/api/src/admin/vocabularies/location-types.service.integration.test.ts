import type pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";

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
  assertI10LocationAdminIsRefusedList,
  assertI11LocationAdminIsRefusedCreate,
  assertI12LocationAdminIsRefusedUpdate,
  assertI13LocationAdminIsRefusedDeactivate,
  assertI14LocationAdminIsRefusedReactivate,
  assertI15CreateWritesAnOrgLessAuditRow,
  assertI16OrganizationAdminIsRefusedCreate,
  assertI1CreateReturnsTheDefaults,
  assertI2ADuplicateCodeIsAConflict,
  assertI3UpdateWritesLabelAndSortOrder,
  assertI4AnEmptyPatchIsRefused,
  assertI5DeactivateKeepsTheRowInTheAdminList,
  assertI6DeactivateRemovesTheTypeFromTheDropdown,
  assertI7ReactivateRestoresTheType,
  assertI8aAnUnusedTypeCountsZero,
  assertI8bOneLocationCountsOne,
  assertI9TheSeededFourInSortOrder,
  type Ctx,
  removeFixtures,
} from "./location-types.service.integration.spec";
import { LocationTypesVocabularyAdminService } from "./location-types.service";

/**
 * `F4.162` (ADR 0077 Amendment 1, plan U2) — Vitest entry point for the
 * global-admin location-type write path. Assertions live in the sibling
 * `.spec` (ADR 0014); this file owns the database lifecycle.
 *
 * The service is built from real, non-owner roles — the `point-keys.rls`
 * shape: `bms_fleet` for the service's reads and writes, `bms_auth` for the
 * role lookup, `bms_tenant` + `bms_fleet` for the audit writer, `bms_tenant`
 * for the dropdown read. The superuser pool holds the fixture `bms.locations`
 * row (FORCE RLS) and the sweep.
 */
const connectionString = requireIntegrationDb({
  item: "F4.162",
  label: "location type vocabulary write path tests",
  connection: "owner",
  because:
    "a green run here would assert that only a global admin may list, create, rename, " +
    "retire or restore a bms.location_types row, that the fleet-wide location count is " +
    "a LEFT JOIN count, and that the audit row is org-less — while nothing checked any of " +
    "it against a real database. Fix the pipeline, do not relax this guard.",
});

describe.skipIf(!connectionString)(
  "F4.162 — location type vocabulary write path against a real database",
  () => {
    let authPool: pg.Pool;
    let tenantPool: pg.Pool;
    let fleetPool: pg.Pool;
    let superPool: pg.Pool;
    let ctx: Ctx;

    beforeAll(async () => {
      const url = connectionString as string;
      authPool = await openIntegrationPool(
        process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"),
        "F4.162",
      );
      tenantPool = await openIntegrationPool(
        process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
        "F4.162",
      );
      fleetPool = await openIntegrationPool(
        resolveIntegrationRoleUrl(url, "fleet", process.env),
        "F4.162",
      );
      superPool = await openIntegrationPool(
        resolveIntegrationRoleUrl(url, "superuser", process.env),
        "F4.162",
      );

      const tenantDb = createDb(tenantPool);
      const fleetDb = createDb(fleetPool);
      ctx = {
        svc: new LocationTypesVocabularyAdminService(
          fleetDb,
          new AccessControlService(createDb(authPool), fleetDb),
          new MasterDataAuditService(tenantDb, fleetDb),
        ),
        vocabularies: new VocabulariesService(tenantDb),
        superPool,
      };
      await removeFixtures(superPool);
    });

    afterAll(async () => {
      try {
        if (superPool) {
          await removeFixtures(superPool);
        }
      } finally {
        await Promise.all(
          [authPool, tenantPool, fleetPool, superPool]
            .filter((pool): pool is pg.Pool => pool !== undefined)
            .map((pool) => pool.end()),
        );
      }
    });

    it("I1 a create is active, sortOrder 0 and counts 0", async () => {
      await assertI1CreateReturnsTheDefaults(ctx);
    });

    it("I2 a repeated code is a ConflictException", async () => {
      await assertI2ADuplicateCodeIsAConflict(ctx);
    });

    it("I3 an update writes label and sortOrder", async () => {
      await assertI3UpdateWritesLabelAndSortOrder(ctx);
    });

    it("I4 an empty update is a BadRequestException", async () => {
      await assertI4AnEmptyPatchIsRefused(ctx);
    });

    it("I5 deactivate keeps the row in the admin list with active false", async () => {
      await assertI5DeactivateKeepsTheRowInTheAdminList(ctx);
    });

    it("I6 deactivate removes the type from the dropdown read", async () => {
      await assertI6DeactivateRemovesTheTypeFromTheDropdown(ctx);
    });

    it("I7 reactivate restores active true", async () => {
      await assertI7ReactivateRestoresTheType(ctx);
    });

    it("I8a an unused type counts 0", async () => {
      await assertI8aAnUnusedTypeCountsZero(ctx);
    });

    it("I8b one location of the type counts 1", async () => {
      await assertI8bOneLocationCountsOne(ctx);
    });

    it("I9 the seeded four are in sort_order order", async () => {
      await assertI9TheSeededFourInSortOrder(ctx);
    });

    it("I10 a location_admin is refused list", async () => {
      await assertI10LocationAdminIsRefusedList(ctx);
    });

    it("I11 a location_admin is refused create", async () => {
      await assertI11LocationAdminIsRefusedCreate(ctx);
    });

    it("I12 a location_admin is refused update", async () => {
      await assertI12LocationAdminIsRefusedUpdate(ctx);
    });

    it("I13 a location_admin is refused deactivate", async () => {
      await assertI13LocationAdminIsRefusedDeactivate(ctx);
    });

    it("I14 a location_admin is refused reactivate", async () => {
      await assertI14LocationAdminIsRefusedReactivate(ctx);
    });

    it("I15 the create audit row is org-less with a null entity id", async () => {
      await assertI15CreateWritesAnOrgLessAuditRow(ctx);
    });

    it("I16 an organization_admin is refused create", async () => {
      await assertI16OrganizationAdminIsRefusedCreate(ctx);
    });
  },
);

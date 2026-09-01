import type pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";

import { AccessControlService } from "../../auth/access-control.service";
import { openIntegrationPool, requireIntegrationDb } from "../../testing/integration-db-gate";
import { VocabulariesService } from "../../vocabularies/vocabularies.service";
import { MasterDataAuditService } from "../master-data-audit.service";
import {
  assertADuplicateCodeIsAConflict,
  assertAnEmptyPatchIsRefused,
  assertAnUnknownCodeIsNotFound,
  assertATenantAdministratorCannotWriteTheVocabulary,
  assertCreateLandsWithAnOrgLessAuditRow,
  assertCreateWithoutSortOrderTakesTheColumnDefault,
  assertPatchIsPartial,
  assertPatchRetiresACodeAndOnlyTheAdminReadKeepsIt,
  assertTheBodySchemasHold,
  assertTheEstateShapesAreInTheVocabulary,
  removeFixtures,
} from "./asset-roles.service.integration.spec";
import { AssetRolesAdminService } from "./asset-roles.service";

/**
 * `F3.40` (ADR 0051 decision 5) — Vitest entry point for the asset role write
 * path. Assertions live in the sibling `.spec` (ADR 0014); this file owns the
 * database lifecycle.
 */
const connectionString = requireIntegrationDb({
  item: "F3.40",
  label: "asset role vocabulary write path tests",
  because:
    "a green run here would assert that only a global admin may edit bms.asset_roles, " +
    "that a retired code leaves every picker while staying visible to the administrator " +
    "who retired it, and that migration 0060 put 'meter' and 'pump' in the vocabulary — " +
    "while nothing checked any of it against a real database. The gate is a role read " +
    "off bms.users and the retirement is a column the vocabularies query filters on; " +
    "neither exists without Postgres. Fix the pipeline, do not relax this guard.",
});

/**
 * The schemas need no database, so they run whether or not the gate above
 * resolves. A machine with no `DATABASE_URL` still checks that the write path
 * cannot create a code the migration scanners are blind to.
 */
describe("F3.40 — asset role request bodies", () => {
  it("rejects a non-kebab code, an unknown key and a renamed primary key", () => {
    assertTheBodySchemasHold();
  });
});

describe.skipIf(!connectionString)(
  "F3.40 — asset role vocabulary write path against a real database",
  () => {
    let pool: pg.Pool;
    let svc: AssetRolesAdminService;
    let vocabularies: VocabulariesService;

    beforeAll(async () => {
      pool = await openIntegrationPool(connectionString as string, "F3.40");
      const db = createDb(pool);
      svc = new AssetRolesAdminService(
        db,
        new AccessControlService(db, db),
        new MasterDataAuditService(db, db),
      );
      // `bms.asset_roles` has no policy and no FORCE flag, so the pool this
      // reads on does not change the answer — one `db` serves both services.
      vocabularies = new VocabulariesService(db);
      await removeFixtures(pool);
    });

    afterAll(async () => {
      try {
        await removeFixtures(pool);
      } finally {
        if (pool) {
          await pool.end();
        }
      }
    });

    it("carries migration 0060's meter and pump, active and in the electrical band", async () => {
      await assertTheEstateShapesAreInTheVocabulary(svc);
    });

    it("creates a code and audits it with no organization and no entity id", async () => {
      await assertCreateLandsWithAnOrgLessAuditRow(svc, pool);
    });

    it("takes the column default when a create omits sortOrder", async () => {
      await assertCreateWithoutSortOrderTakesTheColumnDefault(svc);
    });

    it("answers a repeated code with 409 rather than 500", async () => {
      await assertADuplicateCodeIsAConflict(svc);
    });

    it("refuses a tenant administrator on both verbs, and admits the same call for admin", async () => {
      await assertATenantAdministratorCannotWriteTheVocabulary(svc);
    });

    it("retires a code out of the pickers while the admin list keeps it", async () => {
      await assertPatchRetiresACodeAndOnlyTheAdminReadKeepsIt(svc, vocabularies);
    });

    it("leaves unnamed fields alone on a partial patch", async () => {
      await assertPatchIsPartial(svc);
    });

    it("refuses an empty patch", async () => {
      await assertAnEmptyPatchIsRefused(svc);
    });

    it("answers an unknown code with 404", async () => {
      await assertAnUnknownCodeIsNotFound(svc);
    });
  },
);

/**
 * `removeFixtures` lives in the `.spec` beside the prefix it sweeps, rather
 * than here where ADR 0014 puts the database lifecycle.
 *
 * `tests/integration-fixture-isolation.test.ts` reads the per-run prefix out of
 * the DECLARATION in the same file as the `DELETE`, so splitting the two would
 * make a safe sweep unreadable to that rule. The `beforeAll` call is what makes
 * the age-bounded half of it useful — it clears orphans a killed run left
 * behind before this run starts, rather than an hour after it ends.
 */

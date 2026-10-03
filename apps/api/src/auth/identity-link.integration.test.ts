import type pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";
import type { BmsDb } from "@bms/db";

import {
  openIntegrationPool,
  requireIntegrationDb,
  resolveIntegrationRoleUrl,
} from "../testing/integration-db-gate";
import {
  assertASecondLinkChangesNothing,
  assertDisabledUserIdsListsOnlyTheStampedRow,
  assertIsUserDisabledIsFalseForAnEnabledRow,
  assertIsUserDisabledIsTrueForAStampedRow,
  assertTheAuthRoleReadsDisabledAt,
  assertTheLinkChangesOneRowOnTheAuthRole,
} from "./identity-link.integration.spec";

/**
 * `F3.78` — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns the one `bms_auth` pool.
 */
const connectionString = requireIntegrationDb({
  item: "F3.78",
  label: "the subject link and the disabled_at read on a real bms_auth connection",
  because:
    "the guard links a verified email to its OIDC subject and reads disabled_at on the auth pool on " +
    "every request. Only a real bms_auth connection proves 0098's UPDATE (oidc_subject) and SELECT " +
    "(disabled_at) grants and the auth_bootstrap_write policy admit those two statements; a fake proves " +
    "neither, and a missing grant would 500 every request in production.",
});

describe.skipIf(!connectionString)("F3.78 — identity link on bms_auth (ADR 0089 decision 4)", () => {
  let pool: pg.Pool;
  let authDb: BmsDb;
  let superPool: pg.Pool;
  let superDb: BmsDb;

  beforeAll(async () => {
    pool = await openIntegrationPool(
      resolveIntegrationRoleUrl(connectionString as string, "auth", process.env),
      "F3.78",
    );
    authDb = createDb(pool);
    superPool = await openIntegrationPool(
      resolveIntegrationRoleUrl(connectionString as string, "superuser", process.env),
      "F3.78",
    );
    superDb = createDb(superPool);
  });

  afterAll(async () => {
    await pool?.end();
    await superPool?.end();
  });

  it("the link statement on bms_auth changes one row for a user with a NULL subject", async () => {
    await assertTheLinkChangesOneRowOnTheAuthRole(superDb);
  });

  it("a second link attempt for the same email changes zero rows and keeps the first subject", async () => {
    await assertASecondLinkChangesNothing(superDb);
  });

  it("SELECT disabled_at on bms_auth succeeds", async () => {
    await assertTheAuthRoleReadsDisabledAt(authDb);
  });

  it("isUserDisabled on bms_auth answers true for a row whose disabled_at is set", async () => {
    await assertIsUserDisabledIsTrueForAStampedRow(superDb);
  });

  it("isUserDisabled on bms_auth answers false for an enabled row it can see", async () => {
    await assertIsUserDisabledIsFalseForAnEnabledRow(superDb);
  });

  it("disabledUserIds on bms_auth returns the stamped id and not the enabled one", async () => {
    await assertDisabledUserIdsListsOnlyTheStampedRow(superDb);
  });
});

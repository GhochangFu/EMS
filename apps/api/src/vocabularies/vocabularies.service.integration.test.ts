import type pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";
import type { BmsDb } from "@bms/db";

import {
  assertAlarmSkillRejectsInactiveCode,
  assertAlarmSkillRejectsUnknownCode,
  assertAssetRoleRejectsInactiveCode,
  assertAssetRoleRejectsUnknownCode,
  assertListReturnsAlarmSkillsOrdered,
  assertListReturnsAssetRolesOrdered,
} from "./vocabularies.service.integration.spec";
import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";

/**
 * `E2.1` (ADR 0034) — Vitest entry point. Assertions live in the sibling
 * `.spec` (ADR 0014); this file owns the database lifecycle.
 */
const connectionString = requireIntegrationDb({
  item: "E2.1",
  label: "VocabulariesService alarm skill tests",
  because:
    "a green run here would assert that list() serves bms.alarm_skills ordered " +
    "and active-only, and that assertAlarmSkill rejects unknown and retired codes " +
    "— while nothing checked any of it against a real database. Fix the pipeline, " +
    "do not relax this guard.",
});

describe.skipIf(!connectionString)("E2.1 — VocabulariesService alarm skills against a real database", () => {
  let pool: pg.Pool;
  let db: BmsDb;

  beforeAll(async () => {
    pool = await openIntegrationPool(connectionString as string, "E2.1");
    db = createDb(pool);
  });

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
  });

  it("returns alarm skills ordered by sortOrder, active only", async () => {
    await assertListReturnsAlarmSkillsOrdered(db);
  });

  it("rejects an alarm skill code with no matching row", async () => {
    await assertAlarmSkillRejectsUnknownCode(db);
  });

  it("rejects a retired alarm skill code", async () => {
    await assertAlarmSkillRejectsInactiveCode(db);
  });
});

/**
 * `F3.37` (ADR 0049 decision 5) — the fifth vocabulary. Its own guard and its
 * own pool rather than three more `it`s above, because the guard message names
 * the item whose evidence a skip would silently withhold, and this is a
 * different item from `E2.1`.
 */
const roleConnectionString = requireIntegrationDb({
  item: "F3.37",
  label: "VocabulariesService asset role tests",
  because:
    "a green run here would assert that list() serves bms.asset_roles ordered " +
    "and active-only, and that assertAssetRole turns an unknown or retired code " +
    "into a 400 rather than letting asset_group_members_role_fkey surface as a " +
    "500 — while nothing checked any of it against a real database. Fix the " +
    "pipeline, do not relax this guard.",
});

describe.skipIf(!roleConnectionString)(
  "F3.37 — VocabulariesService asset roles against a real database",
  () => {
    let pool: pg.Pool;
    let db: BmsDb;

    beforeAll(async () => {
      pool = await openIntegrationPool(roleConnectionString as string, "F3.37");
      db = createDb(pool);
    });

    afterAll(async () => {
      if (pool) {
        await pool.end();
      }
    });

    it("returns asset roles ordered by sortOrder, active only", async () => {
      await assertListReturnsAssetRolesOrdered(db);
    });

    it("rejects an asset role code with no matching row, listing live codes", async () => {
      await assertAssetRoleRejectsUnknownCode(db);
    });

    it("rejects a retired asset role code", async () => {
      await assertAssetRoleRejectsInactiveCode(db);
    });
  },
);

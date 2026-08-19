import type pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";
import type { BmsDb } from "@bms/db";

import {
  assertAffectedAssetPairUnique,
  assertAlarmSkillsSeeded,
  assertOneEnrichmentPerAlarm,
  assertUndeclaredSkillRejected,
} from "./alarm-enrichment.integration.spec";
import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";

/**
 * `E2.1` (ADR 0034) — Vitest entry point. Assertions live in the sibling
 * `.spec` (ADR 0014); this file owns the database lifecycle, following
 * `alarm-raise.integration.test.ts`'s shape exactly.
 *
 * It has to be an integration suite: the guarantees under test are database
 * constraints (`alarm_enrichments_alarm_id_key`,
 * `alarm_affected_assets_enrichment_asset_key`,
 * `alarm_enrichments_skill_code_fkey`) — a unit test with a mocked `db`
 * would re-assert the mock's own behaviour, not the constraint.
 */
const connectionString = requireIntegrationDb({
  item: "E2.1",
  label: "alarm enrichment schema integration tests",
  because:
    "a green run here would assert that bms.alarm_skills is seeded, that " +
    "alarm_enrichments and alarm_affected_assets enforce their uniqueness " +
    "constraints, and that an undeclared skill code is rejected — while nothing " +
    "checked any of it against a real database. Fix the pipeline, do not relax " +
    "this guard.",
});

describe.skipIf(!connectionString)("E2.1 — alarm enrichment schema against a real database", () => {
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

  it("seeds the five alarm skill trades, active", async () => {
    await assertAlarmSkillsSeeded(db);
  });

  it("allows exactly one enrichment row per alarm", async () => {
    await assertOneEnrichmentPerAlarm(db);
  });

  it("allows exactly one (enrichment, asset) affected-asset pair", async () => {
    await assertAffectedAssetPairUnique(db);
  });

  it("rejects an enrichment with an undeclared skill code", async () => {
    await assertUndeclaredSkillRejected(db);
  });
});

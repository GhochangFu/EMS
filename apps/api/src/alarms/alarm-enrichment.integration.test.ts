import type pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";
import type { BmsDb } from "@bms/db";

import {
  assertAffectedAssetPairUnique,
  assertAlarmSkillsSeeded,
  assertDetailsEmptyScopeThrows,
  assertDetailsFiltersAffectedAssetsByScope,
  assertDetailsOmitsPairingWhenNoRule,
  assertDetailsReturnsOrganizationId,
  assertDetailsReturnsThresholdPairing,
  assertDetailsScopedByAssetIds,
  assertEnrichmentUpsertCreatesThenUpdates,
  assertEnrichmentUpsertDeleteScopedToCallerAccess,
  assertEnrichmentUpsertRejectsOutOfScopeAffectedAsset,
  assertEnrichmentUpsertRejectsUnknownSkill,
  assertEnrichmentUpsertReplacesAffectedAssetSet,
  assertEnrichmentUpsertScopedByAssetIds,
  assertEnrichmentUpsertTimestampsBehaveOnUpdate,
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

  it("details: returns the value-vs-threshold pairing for an alarm with a linked rule", async () => {
    await assertDetailsReturnsThresholdPairing(db);
  });

  it("details: returns the alarm's own asset's organizationId", async () => {
    await assertDetailsReturnsOrganizationId(db);
  });

  it("details: returns nulls for the pairing when the alarm has no linked rule", async () => {
    await assertDetailsOmitsPairingWhenNoRule(db);
  });

  it("details: raises not-found for an alarm outside the caller's asset scope", async () => {
    await assertDetailsScopedByAssetIds(db);
  });

  it("details: raises not-found for an empty asset scope", async () => {
    await assertDetailsEmptyScopeThrows(db);
  });

  it("details: filters affected assets outside the caller's scope", async () => {
    await assertDetailsFiltersAffectedAssetsByScope(db);
  });

  it("enrichment upsert: creates then overwrites the same row", async () => {
    await assertEnrichmentUpsertCreatesThenUpdates(db);
  });

  it("enrichment upsert: created_at survives an update; updated_at/updated_by are rewritten", async () => {
    await assertEnrichmentUpsertTimestampsBehaveOnUpdate(db);
  });

  it("enrichment upsert: rejects an unknown skillCode with a 400", async () => {
    await assertEnrichmentUpsertRejectsUnknownSkill(db);
  });

  it("enrichment upsert: rejects an out-of-scope affected asset and writes nothing", async () => {
    await assertEnrichmentUpsertRejectsOutOfScopeAffectedAsset(db);
  });

  it("enrichment upsert: replaces the affected-asset set", async () => {
    await assertEnrichmentUpsertReplacesAffectedAssetSet(db);
  });

  it("enrichment upsert: raises not-found for an alarm outside the caller's scope", async () => {
    await assertEnrichmentUpsertScopedByAssetIds(db);
  });

  it("enrichment upsert: a scoped replace does not delete an out-of-scope affected asset", async () => {
    await assertEnrichmentUpsertDeleteScopedToCallerAccess(db);
  });
});

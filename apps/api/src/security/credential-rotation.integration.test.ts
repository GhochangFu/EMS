import type pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";
import type { BmsDb } from "@bms/db";

import {
  assertChannelWalkRotatesSkipsAndIgnoresNoSecret,
  assertConcurrentChannelWriteWinsOverTheRotation,
  assertConcurrentConfigWriteWinsOverTheRotation,
  assertConfigRowRotatesToTheCurrentVersion,
  assertCredentialLessConfigRowIsNotScanned,
  assertRotatedRowDecryptsUnderTheCurrentKeyAlone,
  assertRotationLeavesUpdatedAtUntouched,
  assertSecondRunRotatesNothing,
  assertUnknownVersionIsCollectedAndTheWalkContinues,
} from "./credential-rotation.integration.spec";
import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";

/**
 * `E8.4` / ADR 0062 decision 6 — Vitest entry point. Assertions live in the
 * sibling `.spec` (ADR 0014); this file owns the database lifecycle.
 *
 * It has to be an integration suite: what is under test is a selection on a
 * `bytea IS NOT NULL` predicate, a compare-and-set `UPDATE` whose matched row
 * count is the verdict, and the column `updated_at` being left alone. A unit
 * test with a mocked `db` would re-assert the mock.
 */
const connectionString = requireIntegrationDb({
  item: "E8.4",
  label: "credential rotation integration tests",
  because:
    "a green run here would assert that rotate-credentials re-encrypts every " +
    "ciphertext-bearing row at the current version, never scans a credential-less " +
    "row, leaves a concurrently rewritten secret alone, collects an unknown stored " +
    "version instead of aborting, and never bumps updated_at — while nothing " +
    "checked any of it against a real database. Fix the pipeline, do not relax " +
    "this guard.",
});

describe.skipIf(!connectionString)("E8.4 — rotate-credentials against a real database", () => {
  let pool: pg.Pool;
  let db: BmsDb;

  beforeAll(async () => {
    pool = await openIntegrationPool(connectionString as string, "E8.4");
    db = createDb(pool);
  });

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
  });

  it("rotates a config row to the current version with new ciphertext bytes (decision 6)", async () => {
    await assertConfigRowRotatesToTheCurrentVersion(db);
  });

  it("leaves the rotated row readable under the current key alone", async () => {
    await assertRotatedRowDecryptsUnderTheCurrentKeyAlone(db);
  });

  it("does not scan a credential-less row whose key_version reads 1", async () => {
    await assertCredentialLessConfigRowIsNotScanned(db);
  });

  it("rotates, skips and ignores channels by their ciphertext and version", async () => {
    await assertChannelWalkRotatesSkipsAndIgnoresNoSecret(db);
  });

  it("rotates nothing on a second run", async () => {
    await assertSecondRunRotatesNothing(db);
  });

  it("collects an unknown stored version by name and keeps walking", async () => {
    await assertUnknownVersionIsCollectedAndTheWalkContinues(db);
  });

  it("lets a concurrent config write win over the rotation (ruling 7)", async () => {
    await assertConcurrentConfigWriteWinsOverTheRotation(db);
  });

  it("lets a concurrent channel write win over the rotation (ruling 7)", async () => {
    await assertConcurrentChannelWriteWinsOverTheRotation(db);
  });

  it("leaves updated_at untouched on both tables (ruling 3)", async () => {
    await assertRotationLeavesUpdatedAtUntouched(db);
  });
});

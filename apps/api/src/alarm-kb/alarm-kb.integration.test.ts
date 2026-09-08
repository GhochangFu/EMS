import type pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";
import type { BmsDb } from "@bms/db";

import {
  assertKbDropsAnAlarmWhoseOnlySkillDoesNotResolve,
  assertKbExcludesDraftAndArchivedTemplates,
  assertKbKeepsBothOrganizationsForAnUnrestrictedAdmin,
  assertKbKeepsTheSameCodeInTwoOrganizations,
  assertKbFindsAPhilosophyBearingClass,
  assertKbListsOneEntryPerCodeAtTheCurrentPublishedVersion,
  assertKbOmitsAlarmRowsWithNoPhilosophy,
  assertKbResolvesAnInactiveSkillLabel,
  assertKbReturnsNothingForAnEmptyScope,
  assertKbTreatsANonArrayScopeAsEmpty,
  assertKbScopedToTheCallersOrganization,
  assertMechanicalSkillIsSeeded,
} from "./alarm-kb.integration.spec";
import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";

/**
 * `E2.2` PR 2 (ADR 0059) — Vitest entry point. Assertions live in the sibling
 * `.spec` (ADR 0014); this file owns the database lifecycle.
 *
 * It has to be an integration suite: what is under test is a `DISTINCT ON`
 * version selection, a jsonpath filter and a hand-written tenant predicate on a
 * `BYPASSRLS` pool. A unit test with a mocked `db` would re-assert the mock.
 */
const connectionString = requireIntegrationDb({
  item: "E2.2",
  label: "alarm philosophy KB integration tests",
  because:
    "a green run here would assert that the KB lists one entry per code at its " +
    "current published version, excludes drafts and archived versions, drops " +
    "alarm rows with no philosophy, and refuses another tenant's templates — " +
    "while nothing checked any of it against a real database. The tenant " +
    "predicate in particular is hand-written on a BYPASSRLS pool, so nothing " +
    "else holds it. Fix the pipeline, do not relax this guard.",
});

describe.skipIf(!connectionString)("E2.2 — the alarm philosophy KB against a real database", () => {
  let pool: pg.Pool;
  let db: BmsDb;

  beforeAll(async () => {
    pool = await openIntegrationPool(connectionString as string, "E2.2");
    db = createDb(pool);
  });

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
  });

  it("has the seeded mechanical trade the label assertions depend on", async () => {
    await assertMechanicalSkillIsSeeded(db);
  });

  it("finds a philosophy-bearing class with every field resolved", async () => {
    await assertKbFindsAPhilosophyBearingClass(db);
  });

  it("lists one entry per code, at the current published version", async () => {
    await assertKbListsOneEntryPerCodeAtTheCurrentPublishedVersion(db);
  });

  it("excludes draft and archived templates", async () => {
    await assertKbExcludesDraftAndArchivedTemplates(db);
  });

  it("does not list a template belonging to another organization", async () => {
    await assertKbScopedToTheCallersOrganization(db);
  });

  it("omits alarm rows that carry no philosophy text", async () => {
    await assertKbOmitsAlarmRowsWithNoPhilosophy(db);
  });

  it("resolves the label of a retired (inactive) alarm skill", async () => {
    await assertKbResolvesAnInactiveSkillLabel(db);
  });

  it("returns nothing for a caller with an empty organization scope", async () => {
    await assertKbReturnsNothingForAnEmptyScope(db);
  });

  // Post-merge review of the merged E2.2 (2026-09-08).
  it("keeps both organizations' versions of one shared template code", async () => {
    await assertKbKeepsTheSameCodeInTwoOrganizations(db);
  });

  it("keeps both organizations for an unrestricted admin scope", async () => {
    await assertKbKeepsBothOrganizationsForAnUnrestrictedAdmin(db);
  });

  it("treats a scope that is neither null nor an array as empty", async () => {
    await assertKbTreatsANonArrayScopeAsEmpty(db);
  });

  it("drops an alarm whose only philosophy field is an unresolvable skill", async () => {
    await assertKbDropsAnAlarmWhoseOnlySkillDoesNotResolve(db);
  });
});

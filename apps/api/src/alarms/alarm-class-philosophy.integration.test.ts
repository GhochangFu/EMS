import type pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";
import type { BmsDb } from "@bms/db";

import {
  assertDetailsOmitsClassPhilosophyWhenOnlyAnUnresolvableSkillIsAuthored,
  assertDetailsOmitsClassPhilosophyWhenProvenanceIsNull,
  assertDetailsOmitsClassPhilosophyWhenTheAlarmCodeIsAbsent,
  assertDetailsRefusesATemplateFromAnotherOrganization,
  assertDetailsResolvesAnInactiveSkillLabel,
  assertDetailsReturnsClassPhilosophyForASeededRule,
} from "./alarm-class-philosophy.integration.spec";
import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";

/**
 * `E2.2` (ADR 0059) — Vitest entry point for the class philosophy block.
 * Assertions live in the sibling `.spec` (ADR 0014).
 *
 * Split out of `alarm-enrichment.integration.test.ts` on 2026-09-08 with its
 * assertions, which had pushed that file to 988 of AGENTS.md §4.5's 1000 lines.
 */
const connectionString = requireIntegrationDb({
  item: "E2.2",
  label: "alarm class philosophy integration tests",
  because:
    "a green run here would assert that a template-seeded rule resolves its " +
    "class philosophy, that a rule with no provenance resolves nothing, that a " +
    "dropped alarm entry yields null rather than another entry's text, and that " +
    "a template from another organization is unreadable through an alarm id — " +
    "while nothing checked any of it against a real database. The tenant " +
    "predicate runs on a BYPASSRLS pool, so nothing else holds it. Fix the " +
    "pipeline, do not relax this guard.",
});

describe.skipIf(!connectionString)("E2.2 — the class philosophy against a real database", () => {
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

  it("returns the class philosophy for a rule seeded from a template alarm", async () => {
    await assertDetailsReturnsClassPhilosophyForASeededRule(db);
  });

  it("returns a null class philosophy when the rule carries no provenance", async () => {
    await assertDetailsOmitsClassPhilosophyWhenProvenanceIsNull(db);
  });

  it("returns a null class philosophy when the pinned version dropped the alarm entry", async () => {
    await assertDetailsOmitsClassPhilosophyWhenTheAlarmCodeIsAbsent(db);
  });

  it("does not read a template belonging to another organization", async () => {
    await assertDetailsRefusesATemplateFromAnotherOrganization(db);
  });

  it("resolves the label of a retired (inactive) alarm skill", async () => {
    await assertDetailsResolvesAnInactiveSkillLabel(db);
  });

  // Post-merge review finding 4 (2026-09-08).
  it("returns null when the only philosophy field is an unresolvable skill", async () => {
    await assertDetailsOmitsClassPhilosophyWhenOnlyAnUnresolvableSkillIsAuthored(db);
  });
});

import { BadRequestException } from "@nestjs/common";
import { is, TransactionRollbackError } from "drizzle-orm";

import { alarmSkills } from "@bms/db";
import type { BmsDb } from "@bms/db";

import { VocabulariesService } from "./vocabularies.service";

/**
 * `E2.1` (ADR 0034) — `VocabulariesService`'s fourth vocabulary against a
 * real database. `list()`'s ordering and `assertAlarmSkill`'s active/inactive
 * distinction are both properties of the query against real rows, not of
 * this service's own logic — a mocked `db` would only prove the mock's own
 * behaviour, matching why the other vocabulary suites in this repo are
 * integration tests.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

async function withRollback(
  db: BmsDb,
  run: Parameters<BmsDb["transaction"]>[0],
): Promise<void> {
  await db.transaction(run).catch((err: unknown) => {
    if (!is(err, TransactionRollbackError)) {
      throw err;
    }
  });
}

/** `list()` returns `alarmSkills`, ordered by `sortOrder` then `code`, active only. */
export async function assertListReturnsAlarmSkillsOrdered(db: BmsDb): Promise<void> {
  await withRollback(db, async (tx) => {
    await tx
      .insert(alarmSkills)
      .values([
        { code: "e21_test_z_skill", label: "Z Test Skill", sortOrder: 5 },
        { code: "e21_test_inactive_skill", label: "Inactive Test Skill", sortOrder: 5, active: false },
      ]);

    const service = new VocabulariesService(tx);
    const { alarmSkills: skills } = await service.list();

    const testSkills = skills.filter((s) => s.code.startsWith("e21_test_"));
    assert(
      testSkills.length === 1 && testSkills[0]?.code === "e21_test_z_skill",
      `expected only the active test skill in list(), got: ${testSkills.map((s) => s.code).join(", ")}`,
    );

    // `sortOrder` 5 sorts before the seeded skills (10-50), so it must lead.
    const firstFive = skills.slice(0, 1).map((s) => s.code);
    assert(
      firstFive.includes("e21_test_z_skill"),
      `expected the sortOrder-5 test skill first, got: ${skills.map((s) => s.code).join(", ")}`,
    );

    tx.rollback();
  });
}

/** `assertAlarmSkill` rejects a code that names no row, listing live codes. */
export async function assertAlarmSkillRejectsUnknownCode(db: BmsDb): Promise<void> {
  await withRollback(db, async (tx) => {
    const service = new VocabulariesService(tx);

    let rejected = false;
    let message = "";
    try {
      await service.assertAlarmSkill("e21_test_not_a_real_skill");
    } catch (err) {
      // `instanceof BadRequestException` first: this is the guarantee the
      // method exists for (a 400, not the foreign key's 500) — asserting the
      // message alone would pass just as well against a plain `Error`
      // thrown for the wrong reason, which is exactly the class of gap this
      // suite's other rejection tests were tightened against.
      rejected = err instanceof BadRequestException;
      message = err instanceof Error ? err.message : String(err);
    }
    assert(rejected, "assertAlarmSkill must reject a code with no matching row with a BadRequestException");
    assert(
      message.includes("electrical"),
      `expected the rejection message to list live codes, got: ${message}`,
    );

    tx.rollback();
  });
}

/** `assertAlarmSkill` rejects an inactive (retired) code — existence is not enough. */
export async function assertAlarmSkillRejectsInactiveCode(db: BmsDb): Promise<void> {
  await withRollback(db, async (tx) => {
    await tx
      .insert(alarmSkills)
      .values({ code: "e21_test_retired_skill", label: "Retired Test Skill", active: false });

    const service = new VocabulariesService(tx);

    let rejected = false;
    try {
      await service.assertAlarmSkill("e21_test_retired_skill");
    } catch (err) {
      rejected = err instanceof BadRequestException;
    }
    assert(
      rejected,
      "assertAlarmSkill must reject a retired (active=false) code with a BadRequestException, not just a missing one",
    );

    tx.rollback();
  });
}

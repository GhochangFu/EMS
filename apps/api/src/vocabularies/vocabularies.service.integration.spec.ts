import { BadRequestException } from "@nestjs/common";
import { is, TransactionRollbackError } from "drizzle-orm";

import { alarmSkills, assetRoles } from "@bms/db";
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

/**
 * `F3.37` (ADR 0049 decision 5) — the fifth vocabulary, `bms.asset_roles`.
 *
 * Same three properties as the four before it, and for the same reason: the
 * ordering and the active/inactive distinction are properties of the query
 * against real rows, not of this service's own logic.
 *
 * **The seeded contents are deliberately not asserted anywhere below.** They
 * are rows now, and a list restated here would be a copy of migration 0051 —
 * the duplication this whole design removes. `tests/adr-0034-alarm-skill-
 * vocabulary.test.ts` states the rule; the count belongs to the §4.6
 * database check, not to a unit that would then need editing every time a
 * plant adds a role.
 */

/** `list()` returns `assetRoles`, ordered by `sortOrder` then `code`, active only. */
export async function assertListReturnsAssetRolesOrdered(db: BmsDb): Promise<void> {
  await withRollback(db, async (tx) => {
    await tx.insert(assetRoles).values([
      { code: "f337_test_z_role", label: "Z Test Role", sortOrder: 5 },
      { code: "f337_test_inactive_role", label: "Inactive Test Role", sortOrder: 5, active: false },
    ]);

    const service = new VocabulariesService(tx);
    const { assetRoles: roles } = await service.list();

    const testRoles = roles.filter((r) => r.code.startsWith("f337_test_"));
    assert(
      testRoles.length === 1 && testRoles[0]?.code === "f337_test_z_role",
      `expected only the active test role in list(), got: ${testRoles.map((r) => r.code).join(", ")}`,
    );

    // `sortOrder` 5 sorts before every seeded role (110-550), so it must lead.
    assert(
      roles[0]?.code === "f337_test_z_role",
      `expected the sortOrder-5 test role first, got: ${roles.slice(0, 3).map((r) => r.code).join(", ")}`,
    );

    // Ordering is the property under test, so read it off the whole array
    // rather than trusting the one row this test inserted.
    const out = roles.map((r) => r.sortOrder);
    assert(
      out.every((v, i) => i === 0 || (out[i - 1] as number) <= v),
      `expected assetRoles ordered by sortOrder ascending, got: ${out.join(", ")}`,
    );
    assert(
      roles.every((r) => r.active),
      "expected list() to exclude retired roles entirely",
    );

    tx.rollback();
  });
}

/** `assertAssetRole` rejects a code that names no row, listing live codes. */
export async function assertAssetRoleRejectsUnknownCode(db: BmsDb): Promise<void> {
  await withRollback(db, async (tx) => {
    const service = new VocabulariesService(tx);
    const { assetRoles: live } = await service.list();

    let rejected = false;
    let message = "";
    try {
      await service.assertAssetRole("f337_test_not_a_real_role");
    } catch (err) {
      // `instanceof BadRequestException` first, for the reason
      // `assertAlarmSkillRejectsUnknownCode` records: this method exists to
      // turn `asset_group_members_role_fkey` from a 500 into a 400, and a
      // message-only assertion would pass against a plain Error thrown for
      // the wrong reason.
      rejected = err instanceof BadRequestException;
      message = err instanceof Error ? err.message : String(err);
    }
    assert(
      rejected,
      "assertAssetRole must reject a code with no matching row with a BadRequestException",
    );
    // Compared against what `list()` actually returned rather than a literal,
    // so this does not become the copy of the seed the docblock above forbids.
    assert(
      live.length > 0 && message.includes(live[0]?.code as string),
      `expected the rejection message to list live codes, got: ${message}`,
    );

    tx.rollback();
  });
}

/** `assertAssetRole` rejects an inactive (retired) code — existence is not enough. */
export async function assertAssetRoleRejectsInactiveCode(db: BmsDb): Promise<void> {
  await withRollback(db, async (tx) => {
    await tx
      .insert(assetRoles)
      .values({ code: "f337_test_retired_role", label: "Retired Test Role", active: false });

    const service = new VocabulariesService(tx);

    let rejected = false;
    try {
      await service.assertAssetRole("f337_test_retired_role");
    } catch (err) {
      rejected = err instanceof BadRequestException;
    }
    assert(
      rejected,
      "assertAssetRole must reject a retired (active=false) code with a BadRequestException, not just a missing one",
    );

    tx.rollback();
  });
}

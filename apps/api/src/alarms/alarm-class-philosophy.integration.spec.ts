import { randomUUID } from "node:crypto";

import { eq, is, TransactionRollbackError } from "drizzle-orm";

import { alarmSkills, alarms, assetTemplates, automationRules, organizations } from "@bms/db";
import type { BmsDb } from "@bms/db";

import { AlarmDetailsService } from "./alarm-details.service";
import {
  seededRuleValues,
  type TemplateAlarm,
} from "../admin/asset-templates/template-alarm-rules";
import { createFixtureAssets, fixtureLocation } from "../testing/integration-fixtures";

/**
 * `E2.2` (ADR 0059) — the class philosophy on `GET /api/v1/alarms/:id/details`,
 * against a real database.
 *
 * **Extracted from `alarm-enrichment.integration.spec.ts` on 2026-09-08.** That
 * file is `E2.1`'s and had reached 988 lines against AGENTS.md §4.5's 1000-line
 * whole-file cap; the post-merge compliance review said extract before adding,
 * and the sixth assertion below is the addition. These assertions were never
 * `E2.1`'s subject anyway — they belong to the row that introduced them.
 *
 * Every assertion runs in its own transaction and rolls back, and every fixture
 * asset is built inside it. The reasons are in the `E2.1` file's header and in
 * `../testing/integration-fixtures.ts`.
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

/** A rule with NO provenance — the shape 290 of 290 rules on the dev database have. */
async function insertPlainTestAlarm(db: BmsDb, assetId: string, code: string): Promise<string> {
  const { organizationId } = await fixtureLocation(db);
  const [rule] = await db
    .insert(automationRules)
    .values({
      code,
      name: `E2.2 plain rule — ${code}`,
      category: "safety",
      ruleType: "threshold",
      organizationId,
      assetId,
      pointKey: "e21_test_point",
      operator: "gte",
      thresholdValue: 999_999,
      severity: "warning",
    })
    .returning({ id: automationRules.id });
  if (!rule) {
    throw new Error(`failed to insert plain rule ${code}`);
  }
  const [alarm] = await db
    .insert(alarms)
    .values({
      organizationId,
      assetId,
      ruleId: rule.id,
      severity: "warning",
      message: `E2.2 plain alarm — ${code}`,
    })
    .returning({ id: alarms.id });
  if (!alarm) {
    throw new Error(`failed to insert plain alarm ${code}`);
  }
  return alarm.id;
}


/**
 * One published template version carrying one philosophy-bearing alarm entry.
 *
 * Built in-transaction rather than read off the seed for the reason the file
 * header gives, and for a second one specific to `E2.2`: on the dev database
 * **0 of 290 `automation_rules` rows carry `source_template_id`** (plan §2), so
 * there is nothing on the seed to read. Every assertion below that resolves a
 * philosophy has to construct its own provenance.
 */
async function seedTemplateWithPhilosophy(
  db: BmsDb,
  args: {
    organizationId: string;
    code: string;
    alarmCode: string;
    skillCode: string | null;
  },
): Promise<{
  templateId: string;
  version: number;
  templateName: string;
  alarm: TemplateAlarm;
}> {
  const templateName = `E2.2 integration template — ${args.code}`;
  // The same object goes into the template's content AND into
  // `seededRuleValues` below, so the fixture cannot drift from itself.
  const alarm = {
    code: args.alarmCode,
    pointKey: "e21_test_point",
    message: "Bearing temperature high",
    severity: "warning",
    category: "safety",
    philosophy: {
      cause: "Lubrication starvation or a failing bearing race.",
      impact: "Unplanned outage of the driven train within hours.",
      action: "Reduce load, verify lubrication, schedule a bearing change.",
      ...(args.skillCode === null ? {} : { skill: args.skillCode }),
    },
  } as unknown as TemplateAlarm;

  const [template] = await db
    .insert(assetTemplates)
    .values({
      organizationId: args.organizationId,
      code: args.code,
      version: 1,
      name: templateName,
      assetType: "e22_test_machine",
      domain: "electrical",
      status: "published",
      content: { alarms: [alarm] },
    })
    .returning({ id: assetTemplates.id, version: assetTemplates.version });
  if (!template) {
    throw new Error(`failed to insert test template ${args.code}`);
  }
  return { templateId: template.id, version: template.version, templateName, alarm };
}

/**
 * A unique asset code for `seededRuleValues` to derive the rule code from.
 *
 * **Synthetic, not the fixture asset's real code, and CI is why.** The first
 * version of this helper selected `assets.code` by id — safe in itself, since
 * the id came from `createFixtureAssets` inside this very transaction — but
 * `tests/integration-fixture-isolation.test.ts` scans the source of every
 * rollback-isolated spec for a direct read of the assets table and cannot tell
 * a scoped one from a `LIMIT 1` off the seed. It failed the build, correctly by
 * its own rule — and it would flag this comment too if it named the pattern
 * literally, which is why it does not.
 *
 * Nothing under test depends on the two agreeing: `assetCode` reaches
 * `seededRuleValues` only through `seededRuleCode(assetCode, alarm.code)`, and
 * the join this suite exercises is `source_template_id` + `source_alarm_code`.
 * What the code must be is **unique**, so one transaction's rules cannot
 * collide with another's.
 */
function syntheticAssetCode(): string {
  return `FIXTURE-E22-${randomUUID()}`;
}

/**
 * An alarm whose rule carries `E2.4`'s provenance — the only path
 * `classPhilosophy` resolves through (ADR 0059 decision 3).
 *
 * **The row is built by `seededRuleValues`, the production function
 * `AssetTemplateInstantiationService.instantiate` calls, not by hand.** That is
 * the point of this helper. Hand-stamping `source_template_id` /
 * `source_alarm_code` here would test the join against a fixture's idea of
 * provenance rather than against the one instantiation actually writes: if that
 * function ever transformed the code — cased it, prefixed it, ran it through
 * `seededRuleCode` — a hand-written fixture would stay green while the panel
 * showed nothing. Routing through it means a change there breaks this test,
 * which is the coupling worth having.
 *
 * `alarm` is passed in rather than taken from the template so one caller can
 * point the rule at an entry the template does not declare — the "dropped in a
 * later version" case decision 4 rules on.
 */
async function insertTestAlarmSeededFromTemplate(
  db: BmsDb,
  args: {
    assetId: string;
    assetCode: string;
    organizationId: string;
    templateId: string;
    templateVersion: number;
    alarm: TemplateAlarm;
  },
): Promise<string> {
  const [rule] = await db
    .insert(automationRules)
    .values(
      seededRuleValues({
        alarm: args.alarm,
        assetId: args.assetId,
        assetCode: args.assetCode,
        organizationId: args.organizationId,
        template: { id: args.templateId, version: args.templateVersion },
        unit: null,
        now: new Date(),
      }),
    )
    .returning({ id: automationRules.id });
  if (!rule) {
    throw new Error(`failed to insert seeded test rule for ${args.assetCode}`);
  }
  const [alarm] = await db
    .insert(alarms)
    .values({
      organizationId: args.organizationId,
      assetId: args.assetId,
      ruleId: rule.id,
      severity: "warning",
      message: `E2.2 integration test alarm — ${args.assetCode}`,
    })
    .returning({ id: alarms.id });
  if (!alarm) {
    throw new Error(`failed to insert seeded test alarm for ${args.assetCode}`);
  }
  return alarm.id;
}

/**
 * The happy path: a rule seeded from a template alarm resolves that entry's
 * philosophy, with `skill` rendered as its `bms.alarm_skills` label rather than
 * its raw code (ADR 0059 decision 7).
 */
export async function assertDetailsReturnsClassPhilosophyForASeededRule(db: BmsDb): Promise<void> {
  await withRollback(db, async (tx) => {
    const location = await fixtureLocation(tx);
    const [assetId] = await createFixtureAssets(tx, 1, "E22", location);
    const { organizationId } = location;
    const alarmCode = "E22_TEST_HIGH_TEMP";
    const { templateId, version, templateName, alarm } = await seedTemplateWithPhilosophy(tx, {
      organizationId,
      code: "E22_TEST_TPL_HAPPY",
      alarmCode,
      skillCode: "mechanical",
    });
    const alarmId = await insertTestAlarmSeededFromTemplate(tx, {
      assetId,
      assetCode: syntheticAssetCode(),
      organizationId,
      templateId,
      templateVersion: version,
      alarm,
    });

    const details = await new AlarmDetailsService(tx).get(alarmId, null);
    const philosophy = details.classPhilosophy;
    assert(philosophy != null, "expected a classPhilosophy block for a template-seeded rule");
    assert(
      philosophy?.cause === "Lubrication starvation or a failing bearing race.",
      `expected the template's cause, got ${philosophy?.cause}`,
    );
    assert(
      philosophy?.impact === "Unplanned outage of the driven train within hours.",
      `expected the template's impact, got ${philosophy?.impact}`,
    );
    assert(
      philosophy?.action === "Reduce load, verify lubrication, schedule a bearing change.",
      `expected the template's action, got ${philosophy?.action}`,
    );
    assert(
      philosophy?.skillCode === "mechanical" && philosophy?.skillLabel === "Mechanical",
      `expected the skill code resolved to its label, got ${philosophy?.skillCode}/${philosophy?.skillLabel}`,
    );
    assert(
      philosophy?.templateId === templateId &&
        philosophy?.templateVersion === version &&
        philosophy?.templateName === templateName &&
        philosophy?.alarmCode === alarmCode,
      "the block must name the template, version and alarm entry it came from (ADR 0059 decision 6)",
    );

    tx.rollback();
  });
}

/**
 * The 290-row case measured in plan §2: a rule with no provenance resolves to
 * `null`, and nothing else about the response moves. There is deliberately no
 * fallback that matches on `point_key` — ADR 0059 decision 3 calls that a guess.
 */
export async function assertDetailsOmitsClassPhilosophyWhenProvenanceIsNull(
  db: BmsDb,
): Promise<void> {
  await withRollback(db, async (tx) => {
    const [assetId] = await createFixtureAssets(tx, 1, "E22");
    const alarmId = await insertPlainTestAlarm(tx, assetId, "E22_TEST_DETAILS_NO_PROVENANCE");

    const details = await new AlarmDetailsService(tx).get(alarmId, null);
    assert(
      details.classPhilosophy === null,
      "a rule with no source_template_id must yield classPhilosophy === null",
    );
    assert(
      details.thresholdValue === 999_999,
      "the rest of the details response must be unaffected by the absent philosophy",
    );

    tx.rollback();
  });
}

/**
 * ADR 0059 decision 4: the pinned version no longer declares the entry the rule
 * was seeded from. `null`, not a throw, and not another entry's philosophy.
 */
export async function assertDetailsOmitsClassPhilosophyWhenTheAlarmCodeIsAbsent(
  db: BmsDb,
): Promise<void> {
  await withRollback(db, async (tx) => {
    const location = await fixtureLocation(tx);
    const [assetId] = await createFixtureAssets(tx, 1, "E22", location);
    const { organizationId } = location;
    const { templateId, version, alarm } = await seedTemplateWithPhilosophy(tx, {
      organizationId,
      code: "E22_TEST_TPL_DROPPED",
      alarmCode: "E22_TEST_STILL_DECLARED",
      skillCode: "mechanical",
    });
    const alarmId = await insertTestAlarmSeededFromTemplate(tx, {
      assetId,
      assetCode: syntheticAssetCode(),
      organizationId,
      templateId,
      templateVersion: version,
      // Seeded from an entry the template's content does not declare — what a
      // later version dropping the row leaves behind on an already-seeded rule.
      alarm: { ...alarm, code: "E22_TEST_DROPPED_IN_A_LATER_VERSION" },
    });

    const details = await new AlarmDetailsService(tx).get(alarmId, null);
    assert(
      details.classPhilosophy === null,
      "an alarm code the pinned version does not declare must yield null, not another entry's philosophy",
    );

    tx.rollback();
  });
}

/**
 * ADR 0059 decision 9. `AlarmDetailsService` runs on `bms_fleet`, which is
 * `BYPASSRLS`, so the organization predicate is hand-written and RLS will not
 * catch its absence. **Delete the `eq(assetTemplates.organizationId, ...)` and
 * this test must fail** — that is the whole point of it.
 */
export async function assertDetailsRefusesATemplateFromAnotherOrganization(
  db: BmsDb,
): Promise<void> {
  await withRollback(db, async (tx) => {
    const location = await fixtureLocation(tx);
    const [assetId] = await createFixtureAssets(tx, 1, "E22", location);
    const { organizationId } = location;

    const [otherOrg] = await tx
      .insert(organizations)
      .values({ code: "E22_TEST_OTHER_ORG", name: "E2.2 integration — other tenant" })
      .returning({ id: organizations.id });
    if (!otherOrg) {
      throw new Error("failed to insert the other-tenant organization");
    }

    const alarmCode = "E22_TEST_CROSS_TENANT";
    const { templateId, version, alarm } = await seedTemplateWithPhilosophy(tx, {
      // The template belongs to the other tenant; the alarm does not.
      organizationId: otherOrg.id,
      code: "E22_TEST_TPL_OTHER_ORG",
      alarmCode,
      skillCode: "mechanical",
    });
    const alarmId = await insertTestAlarmSeededFromTemplate(tx, {
      assetId,
      assetCode: syntheticAssetCode(),
      organizationId,
      templateId,
      templateVersion: version,
      alarm,
    });

    const details = await new AlarmDetailsService(tx).get(alarmId, null);
    assert(
      details.classPhilosophy === null,
      "a template belonging to another organization must not be readable through an alarm id",
    );

    tx.rollback();
  });
}

/**
 * ADR 0059 decision 7: retiring a skill is `active = false`, never a delete, and
 * a historic philosophy stays readable. A label lookup that filtered on `active`
 * would blank the field for exactly the old alarms most likely to carry one.
 */
export async function assertDetailsResolvesAnInactiveSkillLabel(db: BmsDb): Promise<void> {
  await withRollback(db, async (tx) => {
    const location = await fixtureLocation(tx);
    const [assetId] = await createFixtureAssets(tx, 1, "E22", location);
    const { organizationId } = location;

    await tx
      .insert(alarmSkills)
      .values({ code: "e22_test_retired", label: "Retired trade", active: false });

    const alarmCode = "E22_TEST_RETIRED_SKILL";
    const { templateId, version, alarm } = await seedTemplateWithPhilosophy(tx, {
      organizationId,
      code: "E22_TEST_TPL_RETIRED_SKILL",
      alarmCode,
      skillCode: "e22_test_retired",
    });
    const alarmId = await insertTestAlarmSeededFromTemplate(tx, {
      assetId,
      assetCode: syntheticAssetCode(),
      organizationId,
      templateId,
      templateVersion: version,
      alarm,
    });

    const details = await new AlarmDetailsService(tx).get(alarmId, null);
    assert(
      details.classPhilosophy?.skillLabel === "Retired trade",
      `an inactive skill must still resolve its label, got ${details.classPhilosophy?.skillLabel}`,
    );

    tx.rollback();
  });
}

/**
 * Post-merge review finding 4, the panel's half. A philosophy whose only field
 * is a `skill` that no longer resolves in `bms.alarm_skills` used to produce a
 * non-null block with four null values — the panel drew the "Class philosophy"
 * heading and its "Authored on …" caption over an empty list.
 *
 * The gate has to be the text that will actually render, not the code that may
 * not resolve. Reachable because template content holds the skill inside jsonb,
 * so no foreign key stops a `bms.alarm_skills` row being re-coded after publish.
 */
export async function assertDetailsOmitsClassPhilosophyWhenOnlyAnUnresolvableSkillIsAuthored(
  db: BmsDb,
): Promise<void> {
  await withRollback(db, async (tx) => {
    const location = await fixtureLocation(tx);
    const [assetId] = await createFixtureAssets(tx, 1, "E22", location);
    const { organizationId } = location;
    const alarmCode = "E22_TEST_GHOST_SKILL_ONLY";
    const { templateId, version, alarm } = await seedTemplateWithPhilosophy(tx, {
      organizationId,
      code: "E22_TEST_TPL_GHOST_SKILL",
      alarmCode,
      skillCode: "e22_test_no_such_trade",
    });
    // Strip the three text fields, leaving only the unresolvable skill.
    const skillOnly = {
      ...alarm,
      philosophy: { skill: "e22_test_no_such_trade" },
    } as unknown as TemplateAlarm;
    await tx
      .update(assetTemplates)
      .set({ content: { alarms: [skillOnly] } })
      .where(eq(assetTemplates.id, templateId));

    const alarmId = await insertTestAlarmSeededFromTemplate(tx, {
      assetId,
      assetCode: syntheticAssetCode(),
      organizationId,
      templateId,
      templateVersion: version,
      alarm: skillOnly,
    });

    const details = await new AlarmDetailsService(tx).get(alarmId, null);
    assert(
      details.classPhilosophy === null,
      "a philosophy whose only field is an unresolvable skill renders nothing, so the block must be null",
    );

    tx.rollback();
  });
}

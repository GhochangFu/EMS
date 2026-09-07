import type pg from "pg";

import type { AdminAssetTemplateDto, TemplateContent } from "@bms/shared";

import {
  FIXTURE_DOMAIN,
  TEST_TEMPLATE_CODE,
  assert,
  cleanup2,
  type SeedFixtures,
} from "./asset-templates.seed-rules.integration.spec";
import {
  ASSET_A,
  expectRejection,
  rowFor,
  ruleRows,
  seed,
  snapshot,
  type DriftFixtures,
  type DriftServices,
  type RuleRow,
} from "./asset-templates.seeded-rules-drift.integration.spec";
import { seededRuleName } from "./template-alarm-rules";

/**
 * `E2.4` / ADR 0058 decision 8 — the four re-apply refusals the **PR 2 review
 * round** added, against a real database.
 *
 * Two are owner rulings of 2026-09-07 that ADR 0058 does not name (a removed
 * limit, a moved point); two are security findings (an archived rule must not
 * be armed, and re-apply must run the same live-vocabulary gate instantiate
 * runs). Each one is a trace nobody could see from the row afterwards, which
 * is why each case here asserts the refusal **and** that the rows are
 * byte-for-byte what they were, by independent SQL through the pool.
 *
 * **Every case carries its own anti-vacuity half.** A guard phrased slightly
 * too wide — "refuse every philosophy target", "refuse every archived-looking
 * rule", "refuse every batch" — would satisfy the refusal assertion on its
 * own. So each case also re-applies something the guard must *not* stop, and
 * checks the write landed.
 *
 * A third file rather than more of
 * `asset-templates.seeded-rules-drift.integration.spec.ts`, which stands at
 * 950-odd of AGENTS.md §4.5's 1000 lines. The drift suite's fixture is not
 * reused either: its v2 is shaped for the four verdicts and every one of its
 * cases counts on that shape, so this file publishes its own pair of versions
 * and imports only the row readers — `ruleRows` and `snapshot` above all, so
 * "independent SQL" stays one spelling rather than two that could drift.
 */

/** Swept by the seed suite's `cleanup` (`LIKE ${TEST_TEMPLATE_CODE}%`). */
export const GUARD_TEMPLATE_CODE = `${TEST_TEMPLATE_CODE}-GUARD`;

/** v1 arms it; v2 restates the same code as a philosophy row (owner ruling R1). */
export const ALARM_LIMIT_REMOVED = "GUARD_LIMIT_REMOVED";
/** v1 and v2 both arm it; v2 binds it to a different point (owner ruling R2). */
export const ALARM_POINT_MOVED = "GUARD_POINT_MOVED";
/** A philosophy row in both versions — R1's anti-vacuity half. */
export const ALARM_PHILOSOPHY_BOTH = "GUARD_PHILOSOPHY_BOTH";
/** A philosophy row v2 gives a limit: the one re-apply ARMS (S1's subject). */
export const ALARM_ARMED_BY_V2 = "GUARD_ARMED_BY_V2";
/** An ordinary alarm whose threshold moves — every case's control. */
export const ALARM_CONTROL = "GUARD_CONTROL";

export const V1_LIMIT_REMOVED_THRESHOLD = 5;
export const V1_POINT_MOVED_THRESHOLD = 10;
export const V2_POINT_MOVED_THRESHOLD = 42;
export const V2_ARMED_OPERATOR = "lt" as const;
export const V2_ARMED_THRESHOLD = 3;
export const V1_CONTROL_THRESHOLD = 20;
export const V2_CONTROL_THRESHOLD = 30;
export const V1_PHILOSOPHY_MESSAGE = "Rationalization record as v1 worded it";
export const V2_PHILOSOPHY_MESSAGE = "Rationalization record as v2 worded it";

/**
 * A rule category code that is **not** in `bms.rule_categories` at all.
 *
 * The hazard S2 names is a code retired with `active = false`: the row still
 * exists, so `automation_rules_category_fk` stays satisfied and the write
 * succeeds silently. `findAlarmVocabularyProblem` is asked a narrower question
 * than the foreign key — "is this code in the **live** set" — and a retired
 * code and an absent one are the same input to it, so this suite uses an
 * absent one and mutates no shared vocabulary table. Inserting a retired row
 * into `bms.rule_categories` would be the exact shape, and it would also be a
 * write to a fleet-wide table that every other suite in a parallel run reads.
 *
 * The mutation proof still holds either way: with the gate removed the UPDATE
 * fails on the foreign key, whose message does not match this case's regex.
 */
export const ABSENT_CATEGORY_CODE = "E24_GUARD_ABSENT_CATEGORY";

/** One `content.alarms[]` entry, as the shared content contract types it. */
type ContentAlarm = NonNullable<TemplateContent["alarms"]>[number];

/**
 * The five alarms, in the two versions the guards need.
 *
 * The array order is load-bearing for one case only: the vocabulary refusal
 * reports `content.alarms.<n>.category`, an index into the **stored** array.
 */
export function guardContent(fx: SeedFixtures, version: 1 | 2): TemplateContent {
  const v2 = version === 2;
  const alarms: ContentAlarm[] = [
    {
      code: ALARM_LIMIT_REMOVED,
      pointKey: fx.pointKeys[0].code,
      // v2 drops both, which `templateAlarmSchema` permits — ADR 0019
      // Amendment 2 makes an alarm with neither a philosophy row.
      ...(v2 ? {} : { operator: "gt" as const, thresholdValue: V1_LIMIT_REMOVED_THRESHOLD }),
      severity: fx.severityCodes[1],
      message: "Feed pressure above the class limit",
      category: fx.categoryCode,
    },
    {
      code: ALARM_POINT_MOVED,
      // The whole of the R2 trace: the same alarm code, a different point.
      pointKey: v2 ? fx.pointKeys[1].code : fx.pointKeys[0].code,
      operator: "gt",
      thresholdValue: v2 ? V2_POINT_MOVED_THRESHOLD : V1_POINT_MOVED_THRESHOLD,
      severity: fx.severityCodes[1],
      message: "Measured value above the class limit",
      category: fx.categoryCode,
    },
    {
      code: ALARM_PHILOSOPHY_BOTH,
      pointKey: fx.pointKeys[1].code,
      severity: fx.severityCodes[2],
      // Only the wording moves, so re-applying this one is provably a write
      // and provably not an arming.
      message: v2 ? V2_PHILOSOPHY_MESSAGE : V1_PHILOSOPHY_MESSAGE,
      category: fx.categoryCode,
    },
    {
      code: ALARM_ARMED_BY_V2,
      pointKey: fx.pointKeys[1].code,
      ...(v2 ? { operator: V2_ARMED_OPERATOR, thresholdValue: V2_ARMED_THRESHOLD } : {}),
      severity: fx.severityCodes[0],
      message: "Supply temperature outside the commissioned band",
      category: fx.categoryCode,
    },
    {
      code: ALARM_CONTROL,
      pointKey: fx.pointKeys[1].code,
      operator: "gte",
      thresholdValue: v2 ? V2_CONTROL_THRESHOLD : V1_CONTROL_THRESHOLD,
      severity: fx.severityCodes[1],
      message: "Control alarm, moved by v2",
      category: fx.categoryCode,
    },
  ];
  return { contentVersion: 1, alarms };
}

/**
 * Publishes v1 of the guard template — the two measured points every alarm
 * above binds to. No derived point: nothing here needs one, and the drift
 * suite already proves an alarm on a derived point seeds.
 */
export async function publishGuardFixture(
  svc: DriftServices,
  fx: SeedFixtures,
): Promise<AdminAssetTemplateDto> {
  const draft = await svc.templates.create(fx.adminJwt, {
    organizationId: fx.organizationId,
    code: GUARD_TEMPLATE_CODE,
    name: "Seeded Rule Guard Fixture",
    assetType: "test_skid",
    domain: FIXTURE_DOMAIN,
    points: [
      {
        pointKey: fx.pointKeys[0].code,
        kind: "measured",
        required: true,
        sortOrder: 0,
        sourceDataKeyPattern: "{asset_code}_FEED_P",
      },
      {
        pointKey: fx.pointKeys[1].code,
        kind: "measured",
        required: true,
        sortOrder: 1,
        unit: "degC",
        sourceDataKeyPattern: "CH{unit}_SUPPLY_T",
      },
    ],
    content: guardContent(fx, 1),
  });
  return svc.templates.publish(fx.adminJwt, draft.id);
}

/** Forks v1 to v2 and publishes it. */
export async function publishGuardV2(
  svc: DriftServices,
  fx: SeedFixtures,
  v1: AdminAssetTemplateDto,
): Promise<AdminAssetTemplateDto> {
  const draft = await svc.templates.createDraftFrom(fx.adminJwt, v1.id);
  await svc.templates.update(fx.adminJwt, draft.id, { content: guardContent(fx, 2) });
  const v2 = await svc.templates.publish(fx.adminJwt, draft.id);
  assert(v2.version === 2, `the guard fork must publish as v2, got v${v2.version}`);
  return v2;
}

/** One asset, five rules — nothing here needs a second asset. */
async function seedOne(
  svc: DriftServices,
  fx: DriftFixtures,
  v1: AdminAssetTemplateDto,
  pool: pg.Pool,
): Promise<RuleRow[]> {
  await cleanup2(pool);
  await seed(svc, fx.adminJwt, v1.id, { rtuId: fx.rtuId }, [{ code: ASSET_A, unit: "G1" }]);
  const rows = await ruleRows(pool);
  assert(rows.length === 5, `expected 5 seeded rules (1 asset x 5 alarms), got ${rows.length}`);
  return rows;
}

/**
 * Owner ruling R1 — re-apply refuses when the current version turned the
 * alarm into a philosophy row, and writes nothing.
 *
 * v1 seeded an **armed** rule. v2 restates the same alarm code with neither an
 * operator nor a threshold, which the content contract permits. Ungated, the
 * `.set()` writes `operator: null, threshold_value: null` while the `armed`
 * filter skips the enable-write, so the row keeps `enabled = true` with a null
 * operator: armed in every list, dropped by the alarm engine's own filter, and
 * reported `in_sync` because all three sides then agree. The toggle cannot
 * repair it — `assertArmable` refuses to re-enable a rule with no limit — so
 * the only exit is a full PATCH. The refusal keeps the rule watching at the
 * limit it was commissioned with.
 *
 * Anti-vacuity, two ways: a philosophy row re-applied from a philosophy row
 * still moves (so the guard is not "refuse every limitless target"), and the
 * control rule alone still moves (so it is not "refuse every batch").
 */
export async function assertReapplyRefusesARemovedLimit(
  svc: DriftServices,
  fx: DriftFixtures,
  pool: pg.Pool,
  v1: AdminAssetTemplateDto,
): Promise<void> {
  const rows = await seedOne(svc, fx, v1, pool);
  const losing = rowFor(rows, ASSET_A, ALARM_LIMIT_REMOVED);
  const philosophy = rowFor(rows, ASSET_A, ALARM_PHILOSOPHY_BOTH);
  const control = rowFor(rows, ASSET_A, ALARM_CONTROL);
  assert(
    losing.operator === "gt" &&
      losing.threshold_value === V1_LIMIT_REMOVED_THRESHOLD &&
      losing.enabled,
    `fixture: ${ALARM_LIMIT_REMOVED} must seed armed at v1's limit, got ${losing.operator} ` +
      `${losing.threshold_value} / enabled ${losing.enabled}`,
  );
  assert(
    philosophy.operator === null && philosophy.threshold_value === null && !philosophy.enabled,
    "fixture: the philosophy row must seed with no limit and disabled",
  );

  const before = await snapshot(pool);
  const refusal = await expectRejection(
    () => svc.seededRules.reapply(fx.adminJwt, v1.id, { ruleIds: [losing.id] }),
    new RegExp(`${losing.code}[\\s\\S]*philosophy row`),
    "re-applying a rule whose limit the current version removed",
  );
  assert(
    refusal.includes("v2") && refusal.includes(ALARM_LIMIT_REMOVED),
    `the 400 must name the version and the alarm it compared against, got "${refusal}"`,
  );
  assert((await snapshot(pool)) === before, "the removed-limit refusal must write nothing");

  // Mixed batch: all or nothing, the valid rule included.
  await expectRejection(
    () => svc.seededRules.reapply(fx.adminJwt, v1.id, { ruleIds: [control.id, losing.id] }),
    /philosophy row/,
    "a batch mixing a valid rule with one whose limit the current version removed",
  );
  assert((await snapshot(pool)) === before, "a mixed batch must write nothing, the valid rule included");

  // Anti-vacuity 1 — a philosophy row re-applied from a philosophy row moves,
  // stays limitless and stays OFF. The guard fires on the transition, not on
  // the shape of the target.
  const applied = await svc.seededRules.reapply(fx.adminJwt, v1.id, { ruleIds: [philosophy.id] });
  assert(applied.items.length === 1, `the philosophy re-apply must return one item, got ${applied.items.length}`);
  const movedPhilosophy = rowFor(await ruleRows(pool), ASSET_A, ALARM_PHILOSOPHY_BOTH);
  assert(
    movedPhilosophy.name === seededRuleName({
      code: ALARM_PHILOSOPHY_BOTH,
      message: V2_PHILOSOPHY_MESSAGE,
    } as Parameters<typeof seededRuleName>[0]),
    `the philosophy row must take v2's wording, got "${movedPhilosophy.name}"`,
  );
  assert(
    movedPhilosophy.operator === null &&
      movedPhilosophy.threshold_value === null &&
      movedPhilosophy.enabled === false &&
      movedPhilosophy.source_template_version === 2,
    "a philosophy row re-applied from a philosophy row must stay limitless, stay disabled, and " +
      `re-stamp to v2 — got ${movedPhilosophy.operator} / ${movedPhilosophy.threshold_value} / ` +
      `enabled ${movedPhilosophy.enabled} / v${movedPhilosophy.source_template_version}`,
  );

  // Anti-vacuity 2 — the control rule alone still applies.
  await svc.seededRules.reapply(fx.adminJwt, v1.id, { ruleIds: [control.id] });
  assert(
    rowFor(await ruleRows(pool), ASSET_A, ALARM_CONTROL).threshold_value === V2_CONTROL_THRESHOLD,
    `the control rule must move to v2's ${V2_CONTROL_THRESHOLD}`,
  );
  // The refused rule is still exactly as v1 seeded it.
  const stillV1 = rowFor(await ruleRows(pool), ASSET_A, ALARM_LIMIT_REMOVED);
  assert(
    stillV1.operator === "gt" &&
      stillV1.threshold_value === V1_LIMIT_REMOVED_THRESHOLD &&
      stillV1.enabled === true &&
      stillV1.source_template_version === 1,
    `${ALARM_LIMIT_REMOVED}: the refused rule must still watch at v1's limit, got ` +
      `${stillV1.operator} ${stillV1.threshold_value} / v${stillV1.source_template_version}`,
  );
}

/**
 * Owner ruling R2 — re-apply refuses when the current version moved the alarm
 * to a different point, and writes nothing.
 *
 * Re-apply moves decision 5's five fields and never `point_key`, so v2's
 * threshold on v1's point would raise the return-temperature limit against the
 * supply temperature — and the list would then report `in_sync`, because the
 * five compared fields really would agree. Writing v2's point instead was
 * considered and refused: the asset was instantiated from v1 and may hold no
 * `asset_points` row for the new key.
 */
export async function assertReapplyRefusesAMovedPoint(
  svc: DriftServices,
  fx: DriftFixtures,
  pool: pg.Pool,
  v1: AdminAssetTemplateDto,
): Promise<void> {
  const rows = await seedOne(svc, fx, v1, pool);
  const moved = rowFor(rows, ASSET_A, ALARM_POINT_MOVED);
  const control = rowFor(rows, ASSET_A, ALARM_CONTROL);
  assert(
    fx.pointKeys[0].code !== fx.pointKeys[1].code,
    "fixture: the two point keys must differ, or this case proves nothing",
  );
  assert(
    moved.point_key === fx.pointKeys[0].code,
    `fixture: ${ALARM_POINT_MOVED} must seed on ${fx.pointKeys[0].code}, got ${moved.point_key}`,
  );

  const before = await snapshot(pool);
  const refusal = await expectRejection(
    () => svc.seededRules.reapply(fx.adminJwt, v1.id, { ruleIds: [moved.id] }),
    new RegExp(`${moved.code}[\\s\\S]*${fx.pointKeys[0].code}[\\s\\S]*${fx.pointKeys[1].code}`),
    "re-applying a rule whose alarm the current version moved to another point",
  );
  assert(
    refusal.includes(ALARM_POINT_MOVED) && refusal.includes("v2"),
    `the 400 must name the alarm and the version, got "${refusal}"`,
  );
  assert((await snapshot(pool)) === before, "the moved-point refusal must write nothing");

  await expectRejection(
    () => svc.seededRules.reapply(fx.adminJwt, v1.id, { ruleIds: [control.id, moved.id] }),
    new RegExp(`${fx.pointKeys[1].code}`),
    "a batch mixing a valid rule with one whose alarm moved point",
  );
  assert((await snapshot(pool)) === before, "a mixed batch must write nothing, the valid rule included");

  // Named explicitly as well as by snapshot: the two columns the trace is about.
  const after = rowFor(await ruleRows(pool), ASSET_A, ALARM_POINT_MOVED);
  assert(
    after.point_key === fx.pointKeys[0].code &&
      after.threshold_value === V1_POINT_MOVED_THRESHOLD,
    `${ALARM_POINT_MOVED}: point_key and threshold_value must both be untouched, got ` +
      `${after.point_key} / ${after.threshold_value}`,
  );

  // Anti-vacuity — a rule whose alarm did NOT move still applies.
  await svc.seededRules.reapply(fx.adminJwt, v1.id, { ruleIds: [control.id] });
  const movedControl = rowFor(await ruleRows(pool), ASSET_A, ALARM_CONTROL);
  assert(
    movedControl.threshold_value === V2_CONTROL_THRESHOLD &&
      movedControl.point_key === fx.pointKeys[1].code,
    `the control rule must move to v2's ${V2_CONTROL_THRESHOLD} on its own unchanged point, got ` +
      `${movedControl.threshold_value} / ${movedControl.point_key}`,
  );
}

/**
 * Security finding S1 — re-apply must not arm an archived rule.
 *
 * `selectSeeded` filters on `source_template_id`, location and rule ids only,
 * and the arming write sets `enabled = true` directly. `archiveRule` archives
 * with `enabled = false` and `setEnabled` refuses a non-published rule;
 * re-apply goes through neither, so an archived philosophy row that v2 gives a
 * limit would come out `enabled = true, lifecycle_status = 'archived'` —
 * contradicting `archiveRule`'s postcondition and showing as enabled in the
 * Rule Engine list, which sorts on that column.
 *
 * The predicate deliberately stays **out** of `selectSeeded`: filtering it
 * there would fold an archived rule into the 404 branch, whose sentence says
 * it was never seeded from this template code, which is false.
 *
 * The anti-vacuity half is the same rule restored to `published` and armed by
 * the same call — which is what makes this a case about the archive status
 * rather than about that rule.
 */
export async function assertReapplyRefusesAnArchivedRule(
  svc: DriftServices,
  fx: DriftFixtures,
  pool: pg.Pool,
  v1: AdminAssetTemplateDto,
): Promise<void> {
  const rows = await seedOne(svc, fx, v1, pool);
  const armable = rowFor(rows, ASSET_A, ALARM_ARMED_BY_V2);
  const control = rowFor(rows, ASSET_A, ALARM_CONTROL);
  assert(
    armable.operator === null && armable.threshold_value === null && !armable.enabled,
    `fixture: ${ALARM_ARMED_BY_V2} must seed as a disabled philosophy row, got ` +
      `${armable.operator} / ${armable.threshold_value} / enabled ${armable.enabled}`,
  );
  assert(
    armable.lifecycle_status === "published",
    `fixture: a seeded rule must be published, got ${armable.lifecycle_status}`,
  );

  // `archiveRule`'s own postcondition, written by SQL so this case does not
  // depend on `RulesService` being constructed.
  await pool.query(
    `UPDATE bms.automation_rules
        SET lifecycle_status = 'archived', enabled = false, archived_at = now()
      WHERE id = $1`,
    [armable.id],
  );

  const before = await snapshot(pool);
  const refusal = await expectRejection(
    () => svc.seededRules.reapply(fx.adminJwt, v1.id, { ruleIds: [armable.id] }),
    new RegExp(`${armable.code}[\\s\\S]*archived`),
    "re-applying an archived rule",
  );
  assert(
    refusal.includes("published"),
    `the 400 must say what state it wanted, got "${refusal}"`,
  );
  assert((await snapshot(pool)) === before, "the archived-rule refusal must write nothing");

  await expectRejection(
    () => svc.seededRules.reapply(fx.adminJwt, v1.id, { ruleIds: [control.id, armable.id] }),
    /archived/,
    "a batch mixing a valid rule with an archived one",
  );
  assert((await snapshot(pool)) === before, "a mixed batch must write nothing, the valid rule included");

  // Named explicitly: the postcondition the finding is about.
  const stillArchived = rowFor(await ruleRows(pool), ASSET_A, ALARM_ARMED_BY_V2);
  assert(
    stillArchived.enabled === false && stillArchived.lifecycle_status === "archived",
    `${ALARM_ARMED_BY_V2}: an archived rule must stay archived and disabled, got ` +
      `enabled ${stillArchived.enabled} / ${stillArchived.lifecycle_status}`,
  );

  // Anti-vacuity — restored to published, the SAME call arms it. Without this
  // the refusal could be "re-apply never arms" and still pass.
  await pool.query(
    `UPDATE bms.automation_rules
        SET lifecycle_status = 'published', archived_at = NULL
      WHERE id = $1`,
    [armable.id],
  );
  await svc.seededRules.reapply(fx.adminJwt, v1.id, { ruleIds: [armable.id] });
  const armed = rowFor(await ruleRows(pool), ASSET_A, ALARM_ARMED_BY_V2);
  assert(
    armed.enabled === true &&
      armed.operator === V2_ARMED_OPERATOR &&
      armed.threshold_value === V2_ARMED_THRESHOLD,
    `${ALARM_ARMED_BY_V2}: published again, re-apply must complete and ARM it — got ` +
      `enabled ${armed.enabled} / ${armed.operator} ${armed.threshold_value}`,
  );
}

/**
 * Review nit N1 — the "no drift verdict" 409 names the *live* half as well as
 * the provenance half.
 *
 * `toDto` returns `null` on two different failures, and the message named only
 * one of them: the four `0067` provenance columns. It also returns `null` when
 * the rule's **own** columns fail `seededRuleValuesSchema`, and then the same
 * sentence sent a reader to inspect four columns that are all intact.
 *
 * `bms.automation_rules.operator` is a nullable `varchar` with no CHECK
 * constraint behind it — the enum lives in Zod — so a value outside
 * `automationRuleOperatorSchema` is a row Postgres accepts and the contract
 * does not. That is what makes this branch reachable at all, and it is the
 * reason the widened wording is load-bearing rather than decorative.
 */
export async function assertReapplyRefusesAnUnreadableLiveRow(
  svc: DriftServices,
  fx: DriftFixtures,
  pool: pg.Pool,
  v1: AdminAssetTemplateDto,
): Promise<void> {
  const rows = await seedOne(svc, fx, v1, pool);
  const control = rowFor(rows, ASSET_A, ALARM_CONTROL);
  assert(
    control.operator === "gte",
    `fixture: ${ALARM_CONTROL} must seed with a valid operator, got ${control.operator}`,
  );
  await pool.query(`UPDATE bms.automation_rules SET operator = 'between' WHERE id = $1`, [
    control.id,
  ]);

  // Independently: every provenance column is intact, so a message naming only
  // those four would be describing a state that does not hold.
  const { rows: provenance } = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM bms.automation_rules
      WHERE id = $1 AND source_template_id IS NOT NULL AND source_template_version IS NOT NULL
        AND source_alarm_code IS NOT NULL AND seeded_baseline IS NOT NULL`,
    [control.id],
  );
  assert(
    Number(provenance[0].n) === 1,
    "fixture: all four provenance columns must still be set — that is the whole of N1",
  );

  const list = await svc.seededRules.list(fx.adminJwt, v1.id);
  assert(
    list.items.length === 4 && !list.items.some((i) => i.ruleId === control.id),
    `a row whose own columns do not parse has no verdict and must be left out, got ` +
      `${list.items.length} items`,
  );

  const before = await snapshot(pool);
  const refusal = await expectRejection(
    () => svc.seededRules.reapply(fx.adminJwt, v1.id, { ruleIds: [control.id] }),
    new RegExp(`${control.code}[\\s\\S]*no drift verdict`),
    "re-applying a rule whose own columns do not read as the values contract",
  );
  assert(
    /or its own operator, threshold_value, severity, category and name/.test(refusal),
    "the 409 must name the live-columns half as well as the provenance half — the four " +
      `provenance columns are intact here, so the narrow wording is false. Got "${refusal}"`,
  );
  assert((await snapshot(pool)) === before, "the no-verdict refusal must write nothing");

  // Anti-vacuity — repaired, the same call applies.
  await pool.query(`UPDATE bms.automation_rules SET operator = 'gte' WHERE id = $1`, [control.id]);
  await svc.seededRules.reapply(fx.adminJwt, v1.id, { ruleIds: [control.id] });
  assert(
    rowFor(await ruleRows(pool), ASSET_A, ALARM_CONTROL).threshold_value === V2_CONTROL_THRESHOLD,
    `the repaired rule must move to v2's ${V2_CONTROL_THRESHOLD}`,
  );
}

/**
 * Security finding S2 — re-apply runs the same live-vocabulary gate the
 * publish and instantiate paths run.
 *
 * It writes `severity` and `category` onto **live** rules from stored template
 * content, and before this fix it was the only writer of either that skipped
 * `findAlarmVocabularyProblem`. Retirement in this estate is `active = false`,
 * so `automation_rules_category_fk` stays satisfied and a withdrawn code lands
 * on a live rule with nothing to say so — the hole
 * `template-alarm-vocabularies.ts` was extracted to close, reopened on a third
 * path.
 *
 * The case corrupts **this suite's own** published v2 content by SQL rather
 * than retiring a fleet-wide vocabulary row that every parallel suite reads;
 * see {@link ABSENT_CATEGORY_CODE} for why the two are the same input to the
 * gate. The restore is in a `finally`, because a published version's content
 * is otherwise immutable and a leaked corruption would redden every later
 * case in this file.
 *
 * Two assertions carry the security property: the refusal names the **path**
 * and the live codes and never the stored value, and it fires for a rule whose
 * own alarm is untouched — the gate is asked of the whole version, exactly as
 * instantiate asks it.
 */
export async function assertReapplyRefusesARetiredVocabulary(
  svc: DriftServices,
  fx: DriftFixtures,
  pool: pg.Pool,
  v1: AdminAssetTemplateDto,
  v2: AdminAssetTemplateDto,
): Promise<void> {
  const rows = await seedOne(svc, fx, v1, pool);
  const control = rowFor(rows, ASSET_A, ALARM_CONTROL);
  const philosophy = rowFor(rows, ASSET_A, ALARM_PHILOSOPHY_BOTH);

  const { rows: live } = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM bms.rule_categories WHERE code = $1`,
    [ABSENT_CATEGORY_CODE],
  );
  assert(
    Number(live[0].n) === 0,
    `fixture defect: ${ABSENT_CATEGORY_CODE} exists in bms.rule_categories, so this case cannot ` +
      "tell a gated write from an ungated one",
  );

  const { rows: stored } = await pool.query<{ content: TemplateContent }>(
    `SELECT content FROM bms.asset_templates WHERE id = $1`,
    [v2.id],
  );
  const original = stored[0].content;
  const corrupted = {
    ...original,
    alarms: (original.alarms ?? []).map((alarm) =>
      alarm.code === ALARM_CONTROL ? { ...alarm, category: ABSENT_CATEGORY_CODE } : alarm,
    ),
  };
  const before = await snapshot(pool);
  try {
    await pool.query(`UPDATE bms.asset_templates SET content = $2 WHERE id = $1`, [
      v2.id,
      JSON.stringify(corrupted),
    ]);

    const refusal = await expectRejection(
      () => svc.seededRules.reapply(fx.adminJwt, v1.id, { ruleIds: [control.id] }),
      /content\.alarms\.\d+\.category is not a live category/,
      "re-applying from a version whose alarm names a category that is no longer live",
    );
    assert(
      !refusal.includes(ABSENT_CATEGORY_CODE),
      `the refusal must name the path and the live codes, never the stored value — got "${refusal}"`,
    );
    assert(
      refusal.includes(GUARD_TEMPLATE_CODE) && refusal.includes(fx.categoryCode),
      `the refusal must name the version and list the live categories, got "${refusal}"`,
    );

    // Asked of the whole version: a rule whose own alarm is untouched is
    // refused too, because the reported path is an index into the stored array
    // and a filtered subset would point a reader at the wrong alarm.
    await expectRejection(
      () => svc.seededRules.reapply(fx.adminJwt, v1.id, { ruleIds: [philosophy.id] }),
      /is not a live category/,
      "re-applying a rule whose own alarm is fine, from a version carrying a dead code",
    );
    assert((await snapshot(pool)) === before, "the vocabulary refusal must write nothing");
  } finally {
    await pool.query(`UPDATE bms.asset_templates SET content = $2 WHERE id = $1`, [
      v2.id,
      JSON.stringify(original),
    ]);
  }

  // Anti-vacuity — with the content restored the same call applies.
  await svc.seededRules.reapply(fx.adminJwt, v1.id, { ruleIds: [control.id] });
  assert(
    rowFor(await ruleRows(pool), ASSET_A, ALARM_CONTROL).threshold_value === V2_CONTROL_THRESHOLD,
    `the control rule must move to v2's ${V2_CONTROL_THRESHOLD} once the content is live again`,
  );
}

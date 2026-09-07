import { randomUUID } from "node:crypto";

import type pg from "pg";

import type { TemplateContent } from "@bms/shared";

import {
  FIXTURE_DOMAIN,
  TEST_ASSET_PREFIX,
  TEST_TEMPLATE_CODE,
  assert,
  cleanup2,
  countTestAssets,
  countTestRules,
  type SeedFixtures,
  type Services,
} from "./asset-templates.seed-rules.integration.spec";

/**
 * `E2.4` — a vocabulary value retired **between publish and instantiate**.
 *
 * A published version is frozen; the vocabularies are not. `assertCatalogActive`
 * already re-validates point keys at instantiate time for exactly that reason
 * ("a template published six months ago can name a key deactivated last week"),
 * and until `E2.4` the alarm vocabularies needed no such gate because nothing
 * consumed a template alarm. The seed is what created the exposure: every alarm
 * now becomes a `bms.automation_rules` row that stamps `category` and
 * `severity` into columns closed by `automation_rules_category_fk` /
 * `automation_rules_severity_fk`.
 *
 * Split from `asset-templates.seed-rules.integration.spec.ts` rather than
 * appended to it — that file stands at 989 of AGENTS.md §4.5's 1000 lines. The
 * suite is one suite: `asset-templates.seed-rules.integration.test.ts` owns the
 * pools and drives both files, and the fixtures here are the same fixtures,
 * imported rather than rebuilt.
 *
 * Every expectation is computed with **independent SQL through the pool**, like
 * its sibling: a refusal that returned 409 while writing rows must fail here.
 */

/**
 * The two halves these cases drive, and no more.
 *
 * `Services` also carries `rules`, which exists so the sibling file can prove
 * the arming guard and the commissioning `PATCH`. Nothing here evaluates or
 * edits a rule, and narrowing the parameter is what lets this suite's wrapper
 * skip constructing `RulesService` with its two stand-in collaborators.
 */
export type VocabularyServices = Pick<Services, "templates" | "instantiate">;

/** The template these cases instantiate. Swept by the suite's `cleanup`. */
export const VOCAB_TEMPLATE_CODE = `${TEST_TEMPLATE_CODE}-VOCAB`;

/**
 * The two vocabulary rows these cases retire.
 *
 * **This suite adds its own severity and category rather than deactivating a
 * seeded one.** `info`, `warning`, `critical` and the four seeded rule
 * categories are referenced by every other suite on this database, and
 * `active = false` on one of them — even for the width of one instantiate call
 * — is a cross-suite failure with no relation to any defect. A row this run
 * inserted is referenced by nothing else in the estate, so retiring it is
 * observable only here.
 *
 * **The codes read like a leaked secret on purpose.** They are the sentinel for
 * the non-echo property: `bms.asset_templates.content` is `jsonb` with no
 * foreign key, so a stored severity is arbitrary text written by whoever, and
 * the refusal must name `content.alarms.0.severity` without repeating what it
 * found there. If the check is ever rewritten to echo, the assertion below
 * fails on the value instead of passing on a coincidence — the same probe
 * `asset-templates.lifecycle.integration.spec.ts` runs against the publish
 * path.
 *
 * Per-run and inline, like the two prefixes in the sibling file: two concurrent
 * instances of this suite must not retire each other's rows. A crashed run
 * leaves one inactive row behind, named for a run that is over and referenced
 * by nothing; `removeFixtureVocabulary` is what removes them on a clean exit.
 */
export const RETIRED_SEVERITY_CODE = `e24_sev_s3_internal_bucket_rotate_me_${randomUUID().replace(/-/g, "").slice(0, 8)}`;
export const RETIRED_CATEGORY_CODE = `e24_cat_s3_internal_bucket_rotate_me_${randomUUID().replace(/-/g, "").slice(0, 8)}`;

/**
 * `bms.alarm_severities.rank` is UNIQUE, so a fixed rank collides with a
 * concurrent instance of this file the way a fixed code prefix would. Drawn
 * from the same per-run randomness, and far above the seeded 10/20/30 so the
 * fixture sorts last in every `ORDER BY rank` and displaces nothing.
 */
const RETIRED_SEVERITY_RANK =
  100_000 + Number.parseInt(randomUUID().replace(/-/g, "").slice(0, 4), 16);

/** The single alarm on the fixture template, so the path is always index 0. */
const VOCAB_ALARM_CODE = "RETIRED_VOCAB_PROBE";

/**
 * Retire and restore, written out per table.
 *
 * A table name cannot be a bind parameter and this file will not interpolate
 * one: two fixed statements keyed by a union is the version a reader checks by
 * eye.
 */
const SET_ACTIVE = {
  alarm_severities: `UPDATE bms.alarm_severities SET active = $2 WHERE code = $1`,
  rule_categories: `UPDATE bms.rule_categories SET active = $2 WHERE code = $1`,
} as const;

type VocabularyTable = keyof typeof SET_ACTIVE;

/** What a refusal looked like, status included — the case asserts on the 409. */
type Refusal = { status: number | null; message: string };

async function refusalOf(run: () => Promise<unknown>): Promise<Refusal> {
  try {
    await run();
  } catch (err) {
    // `HttpException.getStatus()` without importing NestJS into a spec: the
    // status is the claim (409, not 400 and not a 500), so it is read rather
    // than inferred from the message.
    const getStatus = (err as { getStatus?: () => number }).getStatus;
    return {
      status: typeof getStatus === "function" ? getStatus.call(err) : null,
      message: err instanceof Error ? err.message : String(err),
    };
  }
  throw new Error(
    "instantiating a template whose vocabulary was retired must be refused, but the call " +
      "succeeded — every rule it wrote carries a code the organization has withdrawn",
  );
}

/**
 * Flips one fixture vocabulary row, and proves it flipped.
 *
 * The `rowCount` assertion is not decoration: if the code did not match a row,
 * the value would be "not live" for the wrong reason and every assertion below
 * would still pass. That is the shape of a case that tests nothing.
 */
async function setVocabularyActive(
  pool: pg.Pool,
  table: VocabularyTable,
  code: string,
  active: boolean,
): Promise<void> {
  const result = await pool.query(SET_ACTIVE[table], [code, active]);
  assert(
    result.rowCount === 1,
    `expected to ${active ? "restore" : "retire"} exactly one bms.${table} row for this run's ` +
      `fixture code, updated ${result.rowCount}`,
  );
}

/** The two assets each case builds, under the sibling file's swept prefix. */
function twoVocabAssets(): { code: string; name: string }[] {
  return [
    { code: `${TEST_ASSET_PREFIX}V1`, name: "Retired Vocabulary Skid 01" },
    { code: `${TEST_ASSET_PREFIX}V2`, name: "Retired Vocabulary Skid 02" },
  ];
}

/**
 * Adds this run's severity and category, then publishes a template that uses
 * both.
 *
 * **The publish is half the proof.** `assertTemplateAlarmVocabularies` runs on
 * create and on publish, so a template carrying these codes can only reach
 * `published` while both rows are live — which is what makes the refusal below
 * attributable to the retirement rather than to a code that was never valid.
 */
export async function publishRetiredVocabularyFixture(
  svc: VocabularyServices,
  fx: SeedFixtures,
  pool: pg.Pool,
): Promise<string> {
  await pool.query(
    `INSERT INTO bms.alarm_severities (code, label, tone, rank, active)
     VALUES ($1, 'E2.4 retired-vocabulary fixture', 'warning', $2, true)
     ON CONFLICT (code) DO NOTHING`,
    [RETIRED_SEVERITY_CODE, RETIRED_SEVERITY_RANK],
  );
  await pool.query(
    `INSERT INTO bms.rule_categories (code, label, tone, sort_order, active)
     VALUES ($1, 'E2.4 retired-vocabulary fixture', 'neutral', 9000, true)
     ON CONFLICT (code) DO NOTHING`,
    [RETIRED_CATEGORY_CODE],
  );

  const content: TemplateContent = {
    contentVersion: 1,
    alarms: [
      {
        code: VOCAB_ALARM_CODE,
        pointKey: fx.pointKeys[0].code,
        operator: "gt",
        thresholdValue: 5,
        severity: RETIRED_SEVERITY_CODE,
        message: "Feed pressure above the class limit",
        category: RETIRED_CATEGORY_CODE,
      },
    ],
  };
  const draft = await svc.templates.create(fx.adminJwt, {
    organizationId: fx.organizationId,
    code: VOCAB_TEMPLATE_CODE,
    name: "Retired Vocabulary Fixture",
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
    ],
    content,
  });
  const published = await svc.templates.publish(fx.adminJwt, draft.id);
  return published.id;
}

/**
 * Removes this run's vocabulary rows — after the suite's `cleanup`, never
 * before it: `automation_rules.category`/`.severity` are foreign keys, so a
 * seeded rule still holding one of these codes makes the delete fail with
 * `23503` rather than leaking a row.
 */
export async function removeFixtureVocabulary(pool: pg.Pool): Promise<void> {
  await pool.query(`DELETE FROM bms.alarm_severities WHERE code = $1`, [RETIRED_SEVERITY_CODE]);
  await pool.query(`DELETE FROM bms.rule_categories WHERE code = $1`, [RETIRED_CATEGORY_CODE]);
}

/**
 * The shared body of both cases: the same batch, once with the vocabulary live
 * and once with it retired.
 *
 * **The live half is what makes the retired half mean anything.** "0 assets and
 * 0 rules" is also what a template that cannot be instantiated for some
 * unrelated reason produces, so the case first proves this exact call writes 2
 * and 2, then removes them and changes exactly one thing.
 */
async function assertRetiredVocabularyRefuses(
  svc: VocabularyServices,
  fx: SeedFixtures,
  pool: pg.Pool,
  templateId: string,
  retired: { table: VocabularyTable; code: string; axis: "category" | "severity" },
): Promise<void> {
  await cleanup2(pool);
  await svc.instantiate(fx.adminJwt, templateId, { rtuId: fx.rtuId, assets: twoVocabAssets() });
  const liveAssets = await countTestAssets(pool);
  const liveRules = await countTestRules(pool);
  assert(
    liveAssets === 2 && liveRules === 2,
    `with the ${retired.axis} live this batch must write 2 assets and 2 rules, wrote ` +
      `${liveAssets} and ${liveRules} — without that the refusal below proves nothing`,
  );
  await cleanup2(pool);

  await setVocabularyActive(pool, retired.table, retired.code, false);
  try {
    const refusal = await refusalOf(() =>
      svc.instantiate(fx.adminJwt, templateId, { rtuId: fx.rtuId, assets: twoVocabAssets() }),
    );
    assert(
      refusal.status === 409,
      `a vocabulary retired after publish is a conflict with the state of the estate, not a bad ` +
        `request: expected 409, got ${refusal.status} — ${refusal.message}`,
    );
    assert(
      refusal.message.includes(`content.alarms.0.${retired.axis}`),
      `the refusal must name the offending path, got: ${refusal.message}`,
    );
    assert(
      refusal.message.includes(`is not a live ${retired.axis}`),
      `the refusal must name which vocabulary went inactive, got: ${refusal.message}`,
    );
    // The non-echo probe. `content` holds arbitrary stored text, so echoing the
    // rejected value turns a refusal into a disclosure channel — the property a
    // security review already forced onto the publish path.
    assert(
      !refusal.message.includes(retired.code),
      `the refusal must not echo the stored ${retired.axis} back to the caller, got: ` +
        refusal.message,
    );

    const assetsAfter = await countTestAssets(pool);
    const rulesAfter = await countTestRules(pool);
    assert(
      assetsAfter === 0 && rulesAfter === 0,
      `the refusal must land before anything is written, found ${assetsAfter} assets and ` +
        `${rulesAfter} rules`,
    );
  } finally {
    await setVocabularyActive(pool, retired.table, retired.code, true);
  }
}

/** A severity retired after the version was published. */
export async function assertRetiredSeverityRefusesToInstantiate(
  svc: VocabularyServices,
  fx: SeedFixtures,
  pool: pg.Pool,
  templateId: string,
): Promise<void> {
  await assertRetiredVocabularyRefuses(svc, fx, pool, templateId, {
    table: "alarm_severities",
    code: RETIRED_SEVERITY_CODE,
    axis: "severity",
  });
}

/** The same for a category — the axis checked first, and the other foreign key. */
export async function assertRetiredCategoryRefusesToInstantiate(
  svc: VocabularyServices,
  fx: SeedFixtures,
  pool: pg.Pool,
  templateId: string,
): Promise<void> {
  await assertRetiredVocabularyRefuses(svc, fx, pool, templateId, {
    table: "rule_categories",
    code: RETIRED_CATEGORY_CODE,
    axis: "category",
  });
}

import { randomUUID } from "node:crypto";

import type pg from "pg";

import { DEFAULT_RULE_CATEGORY_CODE } from "@bms/shared";
import type {
  AdminAssetTemplateDto,
  AssetInstantiationResultDto,
  JwtPayload,
  TemplateContent,
} from "@bms/shared";

import { pointKeysForAsset } from "../../rules/rule-points";
import type { RulesService } from "../../rules/rules.service";
import type { AssetTemplatesAdminService } from "./asset-templates.service";
import { seededRuleCode } from "./template-alarm-rules";

/**
 * `E2.4` / ADR 0058 — a template alarm becomes an automation rule, against a
 * real database.
 *
 * `template-alarm-rules.spec.ts` proves the derivation; this file proves the
 * *wiring*, and every expectation below is computed with **independent SQL
 * through the pool** rather than read back from the service's own DTO. A
 * service that reports `ruleCount: 8` while writing six rows must fail here.
 *
 * Three of these cases exist because nothing else in the repository can hold
 * their claim:
 *
 * - **The arming guard.** `assertArmable` is called from `setEnabled`, and no
 *   unit test anywhere drives `setEnabled` — removing the call from the service
 *   turned nothing red. This file is the only proof that guard is connected.
 * - **The `template_points ⋈ assets` join** `E2.4` Q1 added to
 *   `assertCompatiblePoint`. The unit-level fake ignores its arguments, so a
 *   wrong predicate passes every other gate. The fixture's point keys are
 *   deliberately ones `pointKeysForAsset` does **not** return, so the
 *   commissioning `PATCH` can only succeed through that join — and
 *   `assertJoinPredicateIsNotVacuous` fails the suite if that stops being true.
 * - **Zero `rule_notifications` rows** (decision 2). An absence is invisible to
 *   a type system and to every unit test; it is one `SELECT count(*)` here.
 *
 * These tests write. Everything they create carries `TEST_TEMPLATE_CODE` or the
 * `TEST_ASSET_PREFIX` and is deleted before and after the run, children first —
 * a crashed run must not poison the next one on a shared local database.
 */

/**
 * Both fixture prefixes carry a **per-run** suffix, and both declarations call
 * `randomUUID()` inline rather than sharing one constant.
 *
 * The suffix is what `tests/integration-fixture-isolation.test.ts` requires: a
 * constant prefix means two concurrent instances of this one file delete each
 * other's committed rows, which is the defect `F2.1` had. The *inline* call is
 * what that gate can actually read — it inspects the declaration of the name
 * used in the `LIKE` argument, so a shared `RUN_ID` constant would read as a
 * fixed prefix even though it is not.
 *
 * Nothing downstream assumes a length: every expected rule code is computed by
 * calling `seededRuleCode` with the same asset code that was submitted.
 */
export const TEST_TEMPLATE_CODE = `E24-SEED-TEST-${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;
export const TEST_ASSET_PREFIX = `E24-SEED-${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}-`;

/** The four fixture alarm codes. */
export const ALARM_PROTO = "FEED_PRESSURE_HIGH";
/** On the **derived** point — it has no `asset_points` row and must still seed. */
export const ALARM_DERIVED = "EFFICIENCY_LOW";
/** No operator, no threshold: an ADR 0019 Amendment 2 philosophy row. */
export const ALARM_PHILOSOPHY = "SUPPLY_TEMP_RATIONALIZATION";
/**
 * 60 characters. With an 11-character normalised asset code the join is 72,
 * over `varchar(64)`, so decision 7's truncate-and-hash branch is the only way
 * this row can be written at all.
 */
export const ALARM_LONG = `OVERFLOW_${"X".repeat(51)}`;

export const PHILOSOPHY_CAUSE = "Fouled plate pack, or a failed supply-side control valve.";

/**
 * `water`, so `pointKeysForAsset` falls through to its electrical default —
 * which is exactly the set the fixture's point keys are chosen to avoid.
 */
export const FIXTURE_DOMAIN = "water";

export type Services = {
  templates: AssetTemplatesAdminService;
  rules: RulesService;
  instantiate: (
    jwt: JwtPayload,
    templateId: string,
    body: unknown,
  ) => Promise<AssetInstantiationResultDto>;
};

/**
 * What this suite needs on top of `F2.2`'s fixtures.
 *
 * The vocabularies are **read from the live tables**, never hard-coded:
 * `automation_rules_category_fk` and `automation_rules_severity_fk` close both
 * sets, and a literal here would make the suite fail on any deployment whose
 * seed differs rather than on a real defect.
 */
export type SeedFixtures = {
  organizationId: string;
  rtuId: string;
  rtuLocationId: string;
  adminJwt: JwtPayload;
  /** Three active point keys, none of them in `pointKeysForAsset`'s map. */
  pointKeys: { code: string; unit: string | null }[];
  /** A live category that is **not** the default, so A2's default is visible. */
  categoryCode: string;
  /** Three live severity codes. */
  severityCodes: string[];
};

export function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** Fails unless `run` rejects with a message matching `match`; `what` names the case. */
export async function expectRejection(
  run: () => Promise<unknown>,
  match: RegExp,
  what: string,
): Promise<void> {
  let message: string | null = null;
  try {
    await run();
  } catch (err) {
    message = err instanceof Error ? err.message : String(err);
  }
  assert(message !== null, `${what}: expected a rejection, but the call succeeded`);
  assert(
    match.test(message ?? ""),
    `${what}: rejected with "${message}", which does not match ${match}`,
  );
}

async function count(pool: pg.Pool, sql: string, params: unknown[] = []): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(sql, params);
  return Number(rows[0].n);
}

/** This suite's asset rows, by independent SQL. */
export async function countTestAssets(pool: pg.Pool): Promise<number> {
  return count(pool, `SELECT COUNT(*)::text AS n FROM bms.assets WHERE code LIKE $1`, [
    `${TEST_ASSET_PREFIX}%`,
  ]);
}

/** This suite's seeded rules, by independent SQL. */
export async function countTestRules(pool: pg.Pool): Promise<number> {
  return count(
    pool,
    `SELECT COUNT(*)::text AS n FROM bms.automation_rules
      WHERE source_template_id IN (SELECT id FROM bms.asset_templates WHERE code LIKE $1)`,
    [`${TEST_TEMPLATE_CODE}%`],
  );
}

/**
 * Deletes only this suite's rows, children first — there is no cascade on any
 * of these foreign keys.
 *
 * **Not keyed on the rule code.** `seededRuleCode` normalises `-` to `_`, so
 * `LIKE 'E24-SEED-%'` matches no rule this suite writes. Rules are found two
 * ways instead, because either alone leaks: by `source_template_id` (catches a
 * rule whose asset a later case deleted) and by `asset_id` (catches a rule
 * seeded from a template row that is already gone).
 *
 * `alarms` and `notification_deliveries` are deleted defensively: nothing here
 * evaluates a rule, but another session's storm-control sweep is cross-org by
 * design (ADR 0033 decision 2) and can write `rule_executions` — and, given a
 * sample, an alarm — for any enabled rule in the database.
 */
export async function cleanup(pool: pg.Pool): Promise<void> {
  const ruleScope = `
    SELECT id FROM bms.automation_rules
     WHERE source_template_id IN (SELECT id FROM bms.asset_templates WHERE code LIKE $1)
        OR asset_id IN (SELECT id FROM bms.assets WHERE code LIKE $2)`;
  const params = [`${TEST_TEMPLATE_CODE}%`, `${TEST_ASSET_PREFIX}%`];

  await pool.query(
    `DELETE FROM bms.notification_deliveries WHERE rule_id IN (${ruleScope})`,
    params,
  );
  await pool.query(`DELETE FROM bms.alarms WHERE rule_id IN (${ruleScope})`, params);
  await pool.query(`DELETE FROM bms.rule_executions WHERE rule_id IN (${ruleScope})`, params);
  await pool.query(
    `DELETE FROM bms.automation_rules
      WHERE source_template_id IN (SELECT id FROM bms.asset_templates WHERE code LIKE $1)
         OR asset_id IN (SELECT id FROM bms.assets WHERE code LIKE $2)`,
    params,
  );
  await pool.query(
    `DELETE FROM bms.asset_points
      WHERE asset_id IN (SELECT id FROM bms.assets WHERE code LIKE $1)`,
    [`${TEST_ASSET_PREFIX}%`],
  );
  await pool.query(`DELETE FROM bms.assets WHERE code LIKE $1`, [`${TEST_ASSET_PREFIX}%`]);
  // `template_points` cascades on its own FK. LIKE, so the v2 fork below goes
  // with the v1 row it was forked from.
  await pool.query(`DELETE FROM bms.asset_templates WHERE code LIKE $1`, [
    `${TEST_TEMPLATE_CODE}%`,
  ]);
}

/**
 * Resolves the fixtures this suite adds to `F2.2`'s.
 *
 * The three point keys are chosen by **excluding** whatever
 * `pointKeysForAsset` answers for this fixture's domain and code prefix. That
 * exclusion is the whole point: it is what makes the commissioning `PATCH`
 * below a proof of the `E2.4` Q1 join rather than an accident of the hard-coded
 * map already containing the key.
 */
export async function loadSeedFixtures(
  pool: pg.Pool,
  base: { organizationId: string; rtuId: string; rtuLocationId: string; adminJwt: JwtPayload },
): Promise<SeedFixtures> {
  const excluded = [...pointKeysForAsset(FIXTURE_DOMAIN, `${TEST_ASSET_PREFIX}01`)];
  const { rows: keyRows } = await pool.query<{ code: string; unit: string | null }>(
    // `F3.39`: the catalog is fleet-wide, so no organization predicate.
    `SELECT code, unit FROM bms.point_keys
      WHERE active = true AND code <> ALL($1::text[])
      ORDER BY created_at, code LIMIT 3`,
    [excluded],
  );
  if (keyRows.length < 3) {
    throw new Error(
      `E2.4 fixtures missing — the catalog has ${keyRows.length} active point keys outside ` +
        `pointKeysForAsset's hard-coded map (${excluded.join(", ")}), needs 3. Run 'pnpm db:seed'.`,
    );
  }

  const { rows: categories } = await pool.query<{ code: string }>(
    `SELECT code FROM bms.rule_categories WHERE active = true ORDER BY sort_order, code`,
  );
  const { rows: severities } = await pool.query<{ code: string }>(
    // `rank`, not `sort_order` — `bms.alarm_severities` orders by severity rank
    // (ADR 0032) while `bms.rule_categories` carries a display `sort_order`.
    `SELECT code FROM bms.alarm_severities WHERE active = true ORDER BY rank, code`,
  );
  const category =
    categories.find((row) => row.code !== DEFAULT_RULE_CATEGORY_CODE)?.code ?? categories[0]?.code;
  if (!category || severities.length < 3) {
    throw new Error(
      "E2.4 fixtures missing — need at least one live rule category other than " +
        `${DEFAULT_RULE_CATEGORY_CODE} and three live alarm severities; found ` +
        `${categories.length} and ${severities.length}. Run 'pnpm db:seed'.`,
    );
  }

  return {
    ...base,
    pointKeys: keyRows,
    categoryCode: category,
    severityCodes: severities.slice(0, 3).map((row) => row.code),
  };
}

/**
 * The published template every case instantiates.
 *
 * Three points — a measured one with no unit override (the catalog fallback),
 * a measured one **with** an override, and a derived one — and four alarms
 * covering every branch of `seededRuleValues`: two proto rules (one of them on
 * the derived point), one philosophy row, and one whose code forces decision
 * 7's hash.
 */
export function fixtureContent(fx: SeedFixtures, protoThreshold = 5): TemplateContent {
  return {
    contentVersion: 1,
    alarms: [
      {
        code: ALARM_PROTO,
        pointKey: fx.pointKeys[0].code,
        operator: "gt",
        thresholdValue: protoThreshold,
        severity: fx.severityCodes[1],
        message: "Feed pressure above the class limit",
        category: fx.categoryCode,
      },
      {
        // No `category`: D2's resolved baseline must record the **defaulted**
        // one, not the absence.
        code: ALARM_DERIVED,
        pointKey: fx.pointKeys[2].code,
        operator: "lt",
        thresholdValue: 2,
        severity: fx.severityCodes[0],
        message: "Computed efficiency below the class floor",
      },
      {
        code: ALARM_PHILOSOPHY,
        pointKey: fx.pointKeys[1].code,
        severity: fx.severityCodes[2],
        message: "Supply temperature outside the commissioned band",
        category: fx.categoryCode,
        philosophy: {
          cause: PHILOSOPHY_CAUSE,
          impact: "Process outlet quality falls and the downstream skid trips.",
          action: "Check the supply valve position, then clean the plate pack.",
        },
      },
      {
        code: ALARM_LONG,
        pointKey: fx.pointKeys[1].code,
        operator: "gte",
        thresholdValue: 90,
        severity: fx.severityCodes[1],
        message: "Overflow imminent",
        category: fx.categoryCode,
      },
    ],
  };
}

export async function publishFixtureTemplate(
  svc: Services,
  fx: SeedFixtures,
): Promise<AdminAssetTemplateDto> {
  const draft = await svc.templates.create(fx.adminJwt, {
    organizationId: fx.organizationId,
    code: TEST_TEMPLATE_CODE,
    name: "Seeded Alarm Fixture",
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
      {
        pointKey: fx.pointKeys[2].code,
        kind: "derived",
        required: true,
        sortOrder: 2,
        sourceDataKeyPattern: "{asset_code}_EFFICIENCY",
        formula: `{${fx.pointKeys[0].code}}`,
        formulaDialect: "bms-calc-v1",
        calcTrigger: "streaming",
      },
    ],
    content: fixtureContent(fx),
  });
  return svc.templates.publish(fx.adminJwt, draft.id);
}

/** The two assets every "happy path" case builds. */
export function twoAssets(): { code: string; name: string; sourceDataKeyVars: { unit: string } }[] {
  return [
    { code: `${TEST_ASSET_PREFIX}01`, name: "Seed Skid 01", sourceDataKeyVars: { unit: "01" } },
    { code: `${TEST_ASSET_PREFIX}02`, name: "Seed Skid 02", sourceDataKeyVars: { unit: "02" } },
  ];
}

export type SeededRuleRow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  category: string;
  rule_type: string;
  source: string;
  enabled: boolean;
  point_key: string | null;
  operator: string | null;
  threshold_value: number | string | null;
  severity: string | null;
  clear_hold_seconds: number | null;
  condition: Record<string, unknown>;
  action: Record<string, unknown>;
  lifecycle_status: string;
  published_at: string | null;
  organization_id: string | null;
  source_template_id: string | null;
  source_template_version: number | null;
  source_alarm_code: string | null;
  seeded_baseline: Record<string, unknown> | null;
  asset_code: string;
};

/** Every rule this suite's template seeded, joined to its asset. */
export async function seededRules(pool: pg.Pool): Promise<SeededRuleRow[]> {
  const { rows } = await pool.query<SeededRuleRow>(
    `SELECT r.id, r.code, r.name, r.description, r.category, r.rule_type, r.source, r.enabled,
            r.point_key, r.operator, r.threshold_value, r.severity, r.clear_hold_seconds,
            r.condition, r.action, r.lifecycle_status, r.published_at, r.organization_id,
            r.source_template_id, r.source_template_version, r.source_alarm_code,
            r.seeded_baseline, a.code AS asset_code
       FROM bms.automation_rules r
       JOIN bms.assets a ON a.id = r.asset_id
      WHERE a.code LIKE $1
      ORDER BY a.code, r.source_alarm_code`,
    [`${TEST_ASSET_PREFIX}%`],
  );
  return rows;
}

/** The one seeded rule for this asset and template alarm; throws, listing what it found, if absent. */
export function ruleFor(rows: SeededRuleRow[], assetCode: string, alarmCode: string): SeededRuleRow {
  const row = rows.find((r) => r.asset_code === assetCode && r.source_alarm_code === alarmCode);
  if (!row) {
    throw new Error(
      `no seeded rule for asset ${assetCode} alarm ${alarmCode}; found ` +
        rows.map((r) => `${r.asset_code}/${r.source_alarm_code}`).join(", "),
    );
  }
  return row;
}

/**
 * The anti-vacuity guard for the `E2.4` Q1 join.
 *
 * If a fixture point key ever *is* in `pointKeysForAsset`'s answer, the
 * commissioning `PATCH` below succeeds without the join ever being consulted,
 * and the case that exists to prove that join goes green having tested nothing.
 * Failing loudly here is the difference between a proof and a decoration.
 */
export function assertJoinPredicateIsNotVacuous(fx: SeedFixtures): void {
  const mapped = pointKeysForAsset(FIXTURE_DOMAIN, `${TEST_ASSET_PREFIX}01`);
  for (const key of fx.pointKeys) {
    assert(
      !mapped.includes(key.code),
      `fixture point key "${key.code}" is in pointKeysForAsset(${FIXTURE_DOMAIN}, ` +
        `${TEST_ASSET_PREFIX}01) = [${mapped.join(", ")}]. The commissioning PATCH would then ` +
        "pass without exercising the template_points join E2.4 Q1 added, and this suite would " +
        "stop being that join's only database proof. Pick a different catalog key.",
    );
  }
}

/**
 * One rule per alarm per asset, with provenance, `review`, and no channel —
 * ADR 0058 decisions 1, 2, 3, 4, 5, 9 and 10 in one pass.
 */
export async function assertOneRulePerAlarmPerAsset(
  svc: Services,
  fx: SeedFixtures,
  pool: pg.Pool,
  templateId: string,
): Promise<void> {
  await cleanup2(pool);
  const result = await svc.instantiate(fx.adminJwt, templateId, {
    rtuId: fx.rtuId,
    assets: twoAssets(),
  });

  const rows = await seededRules(pool);
  assert(rows.length === 8, `expected 8 seeded rules (2 assets x 4 alarms), found ${rows.length}`);

  for (const row of rows) {
    assert(
      row.organization_id === fx.organizationId,
      `${row.code}: organization_id must be the template's org (${fx.organizationId}), got ${row.organization_id}`,
    );
    assert(row.rule_type === "threshold", `${row.code}: rule_type must be threshold, got ${row.rule_type}`);
    assert(row.source === "template_alarm", `${row.code}: source must be template_alarm, got ${row.source}`);
    assert(
      row.lifecycle_status === "published",
      `${row.code}: lifecycle_status must be published — setEnabled refuses anything else, ` +
        `so a draft seed would be uncommissionable. Got ${row.lifecycle_status}`,
    );
    assert(row.published_at !== null, `${row.code}: published_at must be stamped`);
    assert(row.clear_hold_seconds === null, `${row.code}: clear_hold_seconds must be null (D1)`);
    // Provenance, all four columns of migration 0067.
    assert(
      row.source_template_id === templateId,
      `${row.code}: source_template_id must pin the instantiated version`,
    );
    assert(
      row.source_template_version === 1,
      `${row.code}: source_template_version must be 1, got ${row.source_template_version}`,
    );
    assert(row.source_alarm_code !== null, `${row.code}: source_alarm_code must be stamped`);
    const baseline = row.seeded_baseline;
    assert(baseline !== null, `${row.code}: seeded_baseline must be stamped`);
    const keys = Object.keys(baseline ?? {}).sort().join(",");
    assert(
      keys === "category,message,operator,severity,thresholdValue",
      `${row.code}: seeded_baseline must carry exactly D2's five resolved fields, got [${keys}]`,
    );
    // Decision 2: `review`, targeting the rule's own resolved category.
    assert(
      (row.action as { type?: string; target?: string }).type === "review" &&
        (row.action as { target?: string }).target === row.category,
      `${row.code}: action must be {"type":"review","target":"${row.category}"}, got ${JSON.stringify(row.action)}`,
    );
    assert(
      (row.condition as { window?: string }).window === "latest",
      `${row.code}: condition.window must be "latest", got ${JSON.stringify(row.condition)}`,
    );
  }

  for (const assetCode of [`${TEST_ASSET_PREFIX}01`, `${TEST_ASSET_PREFIX}02`]) {
    // A proto rule: both fields, armed (decision 4).
    const proto = ruleFor(rows, assetCode, ALARM_PROTO);
    assert(proto.enabled === true, `${proto.code}: a proto-rule seeds enabled (decision 4)`);
    assert(proto.operator === "gt", `${proto.code}: operator must come from the alarm`);
    assert(Number(proto.threshold_value) === 5, `${proto.code}: threshold must come from the alarm`);
    assert(
      proto.category === fx.categoryCode,
      `${proto.code}: category must be the alarm's, got ${proto.category}`,
    );
    assert(
      proto.point_key === fx.pointKeys[0].code,
      `${proto.code}: point_key must be the alarm's, got ${proto.point_key}`,
    );
    assert(
      (proto.condition as { unit?: string }).unit === (fx.pointKeys[0].unit ?? undefined),
      `${proto.code}: condition.unit must fall back to the catalog unit ` +
        `(${fx.pointKeys[0].unit}), got ${JSON.stringify(proto.condition)}`,
    );
    assert(proto.description === null, `${proto.code}: no philosophy means a null description`);
    assert(
      seededRuleCode(assetCode, ALARM_PROTO) === proto.code,
      `${proto.code}: the stored code must equal seededRuleCode(${assetCode}, ${ALARM_PROTO})`,
    );

    // D8's class: an alarm on a **derived** point seeds, though that point has
    // no asset_points row at all.
    const derived = ruleFor(rows, assetCode, ALARM_DERIVED);
    assert(
      derived.point_key === fx.pointKeys[2].code,
      `${derived.code}: the derived point's rule must exist and name it`,
    );
    assert(derived.enabled === true, `${derived.code}: it carries both fields, so it arms`);
    assert(
      (derived.condition as { unit?: string }).unit === (fx.pointKeys[2].unit ?? undefined),
      `${derived.code}: condition.unit must resolve from the template point (no override here, ` +
        `so the catalog's ${fx.pointKeys[2].unit}), got ${JSON.stringify(derived.condition)}. ` +
        "A derived point writes no asset_points row, so sourcing the unit from the written " +
        "points would silently drop it.",
    );
    assert(
      derived.category === DEFAULT_RULE_CATEGORY_CODE,
      `${derived.code}: an alarm with no category resolves to ${DEFAULT_RULE_CATEGORY_CODE}, got ${derived.category}`,
    );
    assert(
      (derived.seeded_baseline as { category?: string } | null)?.category ===
        DEFAULT_RULE_CATEGORY_CODE,
      `${derived.code}: D2 stores the RESOLVED category in seeded_baseline, not the absence`,
    );

    // Decision 3: a philosophy row is disabled with both columns NULL.
    const philosophy = ruleFor(rows, assetCode, ALARM_PHILOSOPHY);
    assert(philosophy.enabled === false, `${philosophy.code}: a philosophy row seeds disabled`);
    assert(
      philosophy.operator === null && philosophy.threshold_value === null,
      `${philosophy.code}: operator and threshold_value must both be NULL, got ` +
        `${philosophy.operator} / ${philosophy.threshold_value}`,
    );
    assert(
      (philosophy.description ?? "").includes(PHILOSOPHY_CAUSE),
      `${philosophy.code}: the description must carry the philosophy's cause text, got ${philosophy.description}`,
    );
    assert(
      (philosophy.condition as { unit?: string }).unit === "degC",
      `${philosophy.code}: condition.unit must be the template point's override "degC", got ` +
        JSON.stringify(philosophy.condition),
    );
    assert(
      (philosophy.seeded_baseline as { operator?: unknown; thresholdValue?: unknown } | null)
        ?.operator === null,
      `${philosophy.code}: D2 stores null, not undefined, for an absent operator`,
    );
  }

  // Decision 2's absence, and the only place it is checkable.
  const notifications = await count(
    pool,
    `SELECT COUNT(*)::text AS n FROM bms.rule_notifications WHERE rule_id = ANY($1::uuid[])`,
    [rows.map((row) => row.id)],
  );
  assert(
    notifications === 0,
    `a seeded rule joins no notification channel (decision 2); found ${notifications} ` +
      "rule_notifications rows. 160 rules per press must page nobody until someone opts in.",
  );

  // Decision 10 — the DTO, checked against the SQL rather than trusted.
  assert(result.ruleCount === 8, `DTO ruleCount must be 8, got ${result.ruleCount}`);
  assert(
    result.disabledRuleCount === 2,
    `DTO disabledRuleCount must be 2 (one philosophy row per asset), got ${result.disabledRuleCount}`,
  );
  for (const dto of result.assets) {
    assert(
      dto.seededRules.length === 4,
      `${dto.code}: seededRules must list 4 codes, got ${dto.seededRules.length}`,
    );
    const stored = rows.filter((row) => row.asset_code === dto.code).map((row) => row.code).sort();
    assert(
      [...dto.seededRules].sort().join(",") === stored.join(","),
      `${dto.code}: the reported codes must be the stored ones — reported ` +
        `[${dto.seededRules.join(", ")}], stored [${stored.join(", ")}]`,
    );
  }

  // The audit row is the durable record; the DTO is not.
  const { rows: auditRows } = await pool.query<{ rule_count: string; disabled: string }>(
    `SELECT payload->>'ruleCount' AS rule_count, payload->>'disabledRuleCount' AS disabled
       FROM bms.audit_log
      WHERE action = 'master.asset.instantiate' AND entity_id = $1
      ORDER BY created_at DESC LIMIT 1`,
    [templateId],
  );
  assert(auditRows.length === 1, "the instantiate must have written one audit row");
  assert(
    auditRows[0].rule_count === "8" && auditRows[0].disabled === "2",
    `the audit payload must carry ruleCount 8 and disabledRuleCount 2, got ` +
      `${auditRows[0].rule_count} / ${auditRows[0].disabled}`,
  );
}

/** Decision 7's hash branch, end to end through the column. */
export async function assertOverflowingCodeIsHashed(
  svc: Services,
  fx: SeedFixtures,
  pool: pg.Pool,
  templateId: string,
): Promise<void> {
  await cleanup2(pool);
  await svc.instantiate(fx.adminJwt, templateId, { rtuId: fx.rtuId, assets: twoAssets() });

  const rows = await seededRules(pool);
  const codes = new Set<string>();
  for (const assetCode of [`${TEST_ASSET_PREFIX}01`, `${TEST_ASSET_PREFIX}02`]) {
    const row = ruleFor(rows, assetCode, ALARM_LONG);
    assert(
      row.code.length === 64,
      `${assetCode}: a 60-character alarm code must produce exactly 64 characters ` +
        `(55 + 1 + 8), got ${row.code.length} — "${row.code}"`,
    );
    assert(
      /^[A-Z0-9][A-Z0-9_-]*$/.test(row.code),
      `${row.code}: must satisfy ruleCodeSchema's own regex, or the rule editor can never PATCH it`,
    );
    assert(
      row.code === seededRuleCode(assetCode, ALARM_LONG),
      `${row.code}: the stored code must equal seededRuleCode(${assetCode}, <60 chars>) — U6's ` +
        "drift list re-derives it and would otherwise never find this row",
    );
    codes.add(row.code);
  }
  assert(
    codes.size === 2,
    "two assets sharing 55 leading characters must still get distinct codes; the hash is what " +
      `separates them, and it did not: ${[...codes].join(", ")}`,
  );
}

/**
 * The batch is all or nothing, on both new failure modes.
 *
 * The first is `F2.2`'s: a required point that cannot resolve. The claim `E2.4`
 * adds is that it now leaves no *rules* behind either.
 */
export async function assertUnresolvablePointWritesNoRules(
  svc: Services,
  fx: SeedFixtures,
  pool: pg.Pool,
  templateId: string,
): Promise<void> {
  await cleanup2(pool);
  await expectRejection(
    () =>
      svc.instantiate(fx.adminJwt, templateId, {
        rtuId: fx.rtuId,
        assets: [
          { code: `${TEST_ASSET_PREFIX}01`, name: "Seed Skid 01", sourceDataKeyVars: { unit: "01" } },
          // No `unit`, so `CH{unit}_SUPPLY_T` cannot resolve on a required point.
          { code: `${TEST_ASSET_PREFIX}02`, name: "Seed Skid 02" },
        ],
      }),
    /required point/i,
    "a required point with no resolvable source data key",
  );
  assert((await countTestAssets(pool)) === 0, "no asset may survive the abort");
  assert((await countTestRules(pool)) === 0, "no seeded rule may survive the abort");
}

/**
 * D4 — a rule code already taken refuses the batch by name, before anything is
 * written.
 *
 * The squatter is inserted **archived** deliberately.
 * `automation_rules_org_code_idx` is a *total* unique index, so an archived row
 * really does hold its code; `assertRuleCodeAvailable` excludes archived rows
 * and would have let this through. This case is what stops the seed's own
 * pre-check from inheriting that pre-existing mismatch.
 */
export async function assertTakenRuleCodeRefusesBatch(
  svc: Services,
  fx: SeedFixtures,
  pool: pg.Pool,
  templateId: string,
): Promise<void> {
  await cleanup2(pool);
  const squatted = seededRuleCode(`${TEST_ASSET_PREFIX}01`, ALARM_PROTO);
  const { rows: inserted } = await pool.query<{ id: string }>(
    `INSERT INTO bms.automation_rules
       (organization_id, code, name, category, rule_type, source, enabled, lifecycle_status,
        archived_at, condition, action)
     VALUES ($1, $2, 'E2.4 squatter', $3, 'time_window', 'operator_rule', false, 'archived',
             now(), '{}'::jsonb, '{"type":"trace_only","target":"none"}'::jsonb)
     RETURNING id`,
    [fx.organizationId, squatted, DEFAULT_RULE_CATEGORY_CODE],
  );
  try {
    await expectRejection(
      () => svc.instantiate(fx.adminJwt, templateId, { rtuId: fx.rtuId, assets: twoAssets() }),
      new RegExp(squatted),
      "a batch whose derived rule code an archived operator rule already holds",
    );
    assert((await countTestAssets(pool)) === 0, "nothing may be written when a rule code is taken");
    assert((await countTestRules(pool)) === 0, "nothing may be written when a rule code is taken");
  } finally {
    await pool.query(`DELETE FROM bms.automation_rules WHERE id = $1`, [inserted[0].id]);
  }
}

/**
 * D4's other half — two asset codes in one batch that derive the same rule
 * code.
 *
 * `E24-SEED-DUP-1` and `E24-SEED-DUP_1` are distinct asset codes (`assets.code`
 * is compared exactly) that `seededRuleCode` normalises to one string. Nothing
 * before this check would notice, and Postgres would report it as a
 * self-collision inside the transaction.
 */
export async function assertIntraBatchCodeCollisionRefused(
  svc: Services,
  fx: SeedFixtures,
  pool: pg.Pool,
  templateId: string,
): Promise<void> {
  await cleanup2(pool);
  const derived = seededRuleCode(`${TEST_ASSET_PREFIX}DUP-1`, ALARM_PROTO);
  await expectRejection(
    () =>
      svc.instantiate(fx.adminJwt, templateId, {
        rtuId: fx.rtuId,
        assets: [
          {
            code: `${TEST_ASSET_PREFIX}DUP-1`,
            name: "Dup A",
            sourceDataKeyVars: { unit: "A" },
          },
          {
            code: `${TEST_ASSET_PREFIX}DUP_1`,
            name: "Dup B",
            sourceDataKeyVars: { unit: "B" },
          },
        ],
      }),
    new RegExp(derived),
    "two asset codes that normalise to one rule code",
  );
  assert((await countTestAssets(pool)) === 0, "an intra-batch collision must write nothing");
  assert((await countTestRules(pool)) === 0, "an intra-batch collision must write nothing");
}

/**
 * ADR 0058 decision 3, and the **only** proof `assertArmable` is wired.
 *
 * The mutation that removed the `assertArmable` call from `setEnabled` turned
 * nothing else in the repository red. The assertion is on the *message text*,
 * including the rule's own code: `setEnabled` can refuse for three other
 * reasons before it ever reaches the guard, and a bare "it rejected" would go
 * green on any of them.
 *
 * The commissioning `PATCH` is the second proof: it is the only execution of
 * the `template_points ⋈ assets` predicate `E2.4` Q1 added to
 * `assertCompatiblePoint` against a real database, and the fixture's point keys
 * are outside `pointKeysForAsset`'s map precisely so that the join is the only
 * way it can pass.
 */
export async function assertPhilosophyRowCannotBeArmed(
  svc: Services,
  fx: SeedFixtures,
  pool: pg.Pool,
  templateId: string,
): Promise<void> {
  assertJoinPredicateIsNotVacuous(fx);
  await cleanup2(pool);
  await svc.instantiate(fx.adminJwt, templateId, { rtuId: fx.rtuId, assets: twoAssets() });

  const rows = await seededRules(pool);
  const assetCode = `${TEST_ASSET_PREFIX}01`;
  const philosophy = ruleFor(rows, assetCode, ALARM_PHILOSOPHY);
  const proto = ruleFor(rows, assetCode, ALARM_PROTO);
  const actor = { sub: fx.adminJwt.sub, email: fx.adminJwt.email };

  const isEnabled = async (id: string): Promise<boolean> => {
    const { rows: read } = await pool.query<{ enabled: boolean }>(
      `SELECT enabled FROM bms.automation_rules WHERE id = $1`,
      [id],
    );
    return read[0].enabled;
  };

  await expectRejection(
    () => svc.rules.setEnabled(philosophy.id, { enabled: true }, actor),
    new RegExp(`Rule ${philosophy.code} cannot be enabled`),
    "arming a philosophy row with no operator and no threshold",
  );
  assert(
    (await isEnabled(philosophy.id)) === false,
    `${philosophy.code}: the refusal must leave the row disabled in the database, not merely ` +
      "return an error after writing",
  );

  // The guard is on `dto.enabled`, not unconditional: a proto rule toggles both
  // ways. Without this the guard could be "refuse every toggle" and still pass.
  await svc.rules.setEnabled(proto.id, { enabled: false }, actor);
  assert((await isEnabled(proto.id)) === false, `${proto.code}: disabling a proto rule must work`);
  await svc.rules.setEnabled(proto.id, { enabled: true }, actor);
  assert((await isEnabled(proto.id)) === true, `${proto.code}: re-arming a proto rule must work`);

  // Commissioning: one PATCH carrying BOTH fields. This suite's only proof that
  // the E2.4 Q1 join returns the right rows — `philosophy.point_key` is not in
  // `pointKeysForAsset`'s answer, so `assertCompatiblePoint` can only pass by
  // reading the asset's pinned template. It stopped being that join's only
  // *execution* under `F3.49`, which runs it on every threshold validation
  // rather than only on a map miss.
  await svc.rules.updateRule(philosophy.id, { operator: "gt", thresholdValue: 3 }, actor);
  const { rows: patched } = await pool.query<{ operator: string | null; threshold_value: string }>(
    `SELECT operator, threshold_value::text FROM bms.automation_rules WHERE id = $1`,
    [philosophy.id],
  );
  assert(
    patched[0].operator === "gt" && Number(patched[0].threshold_value) === 3,
    `${philosophy.code}: the commissioning PATCH must store both fields, got ` +
      `${patched[0].operator} / ${patched[0].threshold_value}`,
  );
  await svc.rules.setEnabled(philosophy.id, { enabled: true }, actor);
  assert(
    (await isEnabled(philosophy.id)) === true,
    `${philosophy.code}: once both fields are set the row must arm — a guard that refused here ` +
      "would make every philosophy row permanently dead",
  );
}

/**
 * Decision 1 — republishing never moves a live rule.
 *
 * Both halves matter. The v1 rule keeping its threshold is the promise; the new
 * asset getting v2's value is what proves the republish actually changed
 * something, so the first half is not passing because nothing happened.
 */
export async function assertRepublishNeverMovesALiveRule(
  svc: Services,
  fx: SeedFixtures,
  pool: pg.Pool,
  templateId: string,
): Promise<void> {
  await cleanup2(pool);
  await svc.instantiate(fx.adminJwt, templateId, {
    rtuId: fx.rtuId,
    assets: [
      { code: `${TEST_ASSET_PREFIX}V1`, name: "Seed Skid V1", sourceDataKeyVars: { unit: "V1" } },
    ],
  });

  const draft = await svc.templates.createDraftFrom(fx.adminJwt, templateId);
  await svc.templates.update(fx.adminJwt, draft.id, { content: fixtureContent(fx, 7) });
  const v2 = await svc.templates.publish(fx.adminJwt, draft.id);
  assert(v2.version === 2, `the fork must publish as v2, got v${v2.version}`);

  await svc.instantiate(fx.adminJwt, v2.id, {
    rtuId: fx.rtuId,
    assets: [
      { code: `${TEST_ASSET_PREFIX}V2`, name: "Seed Skid V2", sourceDataKeyVars: { unit: "V2" } },
    ],
  });

  const rows = await seededRules(pool);
  const first = ruleFor(rows, `${TEST_ASSET_PREFIX}V1`, ALARM_PROTO);
  assert(
    Number(first.threshold_value) === 5 && first.source_template_version === 1,
    `${first.code}: republishing must not move a live rule — it reads ` +
      `${first.threshold_value} at v${first.source_template_version}, expected 5 at v1`,
  );
  assert(
    (first.seeded_baseline as { thresholdValue?: number } | null)?.thresholdValue === 5,
    `${first.code}: its baseline must still record what it was seeded with, not what v2 says`,
  );

  const second = ruleFor(rows, `${TEST_ASSET_PREFIX}V2`, ALARM_PROTO);
  assert(
    Number(second.threshold_value) === 7 && second.source_template_version === 2,
    `${second.code}: an asset built from v2 must get v2's value — reads ` +
      `${second.threshold_value} at v${second.source_template_version}, expected 7 at v2`,
  );
  assert(
    second.source_template_id === v2.id,
    `${second.code}: source_template_id must pin the v2 row, not the v1 one`,
  );
}

/**
 * D7 — stored content that no longer parses refuses to instantiate.
 *
 * A published version is immutable through the API, so the only way to reach
 * this state is a row written before the contract tightened. `optimisation` is
 * a *reserved* section (`E1.6`), which is the cheapest legal way to produce
 * exactly that failure without inventing a shape.
 *
 * Restored in a `finally`: leaving it would break every later case and every
 * re-run of this file.
 */
export async function assertUnparseableContentRefusesToInstantiate(
  svc: Services,
  fx: SeedFixtures,
  pool: pg.Pool,
  templateId: string,
): Promise<void> {
  await cleanup2(pool);
  const { rows: before } = await pool.query<{ content: unknown }>(
    `SELECT content FROM bms.asset_templates WHERE id = $1`,
    [templateId],
  );
  const broken = { ...(before[0].content as Record<string, unknown>), optimisation: { any: 1 } };
  await pool.query(`UPDATE bms.asset_templates SET content = $2::jsonb WHERE id = $1`, [
    templateId,
    JSON.stringify(broken),
  ]);
  try {
    await expectRejection(
      () => svc.instantiate(fx.adminJwt, templateId, { rtuId: fx.rtuId, assets: twoAssets() }),
      /optimisation/,
      "instantiating a version whose stored content no longer parses",
    );
    assert(
      (await countTestAssets(pool)) === 0,
      "D7 refuses before anything is written — a silent zero-rule seed is the outcome it exists " +
        "to prevent, and a zero-rule batch that created assets is that outcome",
    );
  } finally {
    await pool.query(`UPDATE bms.asset_templates SET content = $2::jsonb WHERE id = $1`, [
      templateId,
      JSON.stringify(before[0].content),
    ]);
  }
}

/**
 * Per-case reset: assets and rules only, never the template.
 *
 * Named apart from {@link cleanup} because the two have different scopes — the
 * suite-level one also drops the fixture template, and calling it here would
 * delete the row every remaining case instantiates.
 */
export async function cleanup2(pool: pg.Pool): Promise<void> {
  const ruleScope = `
    SELECT id FROM bms.automation_rules
     WHERE source_template_id IN (SELECT id FROM bms.asset_templates WHERE code LIKE $1)
        OR asset_id IN (SELECT id FROM bms.assets WHERE code LIKE $2)`;
  const params = [`${TEST_TEMPLATE_CODE}%`, `${TEST_ASSET_PREFIX}%`];
  await pool.query(
    `DELETE FROM bms.notification_deliveries WHERE rule_id IN (${ruleScope})`,
    params,
  );
  await pool.query(`DELETE FROM bms.alarms WHERE rule_id IN (${ruleScope})`, params);
  await pool.query(`DELETE FROM bms.rule_executions WHERE rule_id IN (${ruleScope})`, params);
  await pool.query(
    `DELETE FROM bms.automation_rules
      WHERE source_template_id IN (SELECT id FROM bms.asset_templates WHERE code LIKE $1)
         OR asset_id IN (SELECT id FROM bms.assets WHERE code LIKE $2)`,
    params,
  );
  await pool.query(
    `DELETE FROM bms.asset_points
      WHERE asset_id IN (SELECT id FROM bms.assets WHERE code LIKE $1)`,
    [`${TEST_ASSET_PREFIX}%`],
  );
  await pool.query(`DELETE FROM bms.assets WHERE code LIKE $1`, [`${TEST_ASSET_PREFIX}%`]);
}

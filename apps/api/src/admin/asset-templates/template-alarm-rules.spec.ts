import { DEFAULT_RULE_CATEGORY_CODE, seededRuleValuesSchema } from "@bms/shared";
import type { SeededRuleValues } from "@bms/shared";

import {
  driftVerdict,
  philosophyDescription,
  seededRuleCode,
  seededRuleValues,
  type TemplateAlarm,
} from "./template-alarm-rules";

/**
 * `E2.4` U3 — the pure half of ADR 0058: the derived rule code (decision 7),
 * the row a template alarm becomes (decisions 2, 3, 4, 5) and the drift
 * verdict (decision 8).
 *
 * Nothing here touches a database. The seed's transactional behaviour is U4's
 * integration suite; these cases pin the arithmetic that suite would only
 * observe indirectly — in particular that **every** code the derivation can
 * emit satisfies `ruleCodeSchema`'s `^[A-Z0-9][A-Z0-9_-]*$` and the
 * `varchar(64)` column, for every input the content contract permits.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function sameString(actual: string, expected: string, message: string): void {
  assert(actual === expected, `${message}\n  expected ${expected}\n  got      ${actual}`);
}

/** Key-order-independent structural equality for plain data. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v !== null && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
        )
      : v,
  );
}

function sameObject(actual: unknown, expected: unknown, message: string): void {
  assert(
    canonical(actual) === canonical(expected),
    `${message}\n  expected ${canonical(expected)}\n  got      ${canonical(actual)}`,
  );
}

/** `ruleCodeSchema`'s regex, restated here so the spec fails if either moves. */
const RULE_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]*$/;

const TEMPLATE = { id: "11111111-1111-4111-8111-111111111111", version: 3 };
const ASSET_ID = "22222222-2222-4222-8222-222222222222";
const ORG_ID = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-09-07T09:30:00.000Z");

function alarm(overrides: Partial<TemplateAlarm> = {}): TemplateAlarm {
  return {
    code: "HIGH_TEMP",
    pointKey: "temp_c",
    severity: "warning",
    message: "Battery temperature is high",
    ...overrides,
  };
}

function buildRow(overrides: Partial<TemplateAlarm> = {}, unit: string | null = null) {
  return seededRuleValues({
    alarm: alarm(overrides),
    assetId: ASSET_ID,
    assetCode: "CR-BATT-1",
    organizationId: ORG_ID,
    template: TEMPLATE,
    unit,
    now: NOW,
  });
}

// --------------------------------------------------------------------------
// Decision 7 — code derivation
// --------------------------------------------------------------------------

/**
 * The existing seed convention, which decision 7 names as the shape to match:
 * `packages/db/src/automation-rules-seed.ts` stores `CR_BATT_1_TEMP_WARNING`
 * for asset `CR-BATT-1`. If the derivation stops producing that string, a
 * seeded rule no longer looks like the ones already in the database.
 */
export function assertCodeMatchesTheExistingSeedConvention(): void {
  sameString(
    seededRuleCode("CR-BATT-1", "TEMP_WARNING"),
    "CR_BATT_1_TEMP_WARNING",
    "the seed convention's code",
  );
}

/** Step 1: uppercase, every run of non-`[A-Z0-9]` becomes one `_`, edges stripped. */
export function assertCodeNormalisesCaseSpacesAndPunctuation(): void {
  sameString(seededRuleCode("chiller 1", "high temp"), "CHILLER_1_HIGH_TEMP", "lower case and spaces");
  sameString(seededRuleCode("--x--", "a"), "X_A", "punctuation runs collapse and edges strip");
  sameString(seededRuleCode("cw.pump/2", "low..flow"), "CW_PUMP_2_LOW_FLOW", "a run collapses to one underscore");
}

/**
 * Step 2: a result not starting `[A-Z0-9]` is prefixed `R_`. A punctuation-only
 * asset code normalises to the empty string, so the join starts with `_`.
 */
export function assertCodeGetsTheRPrefixWhenItWouldNotStartAlphanumeric(): void {
  const code = seededRuleCode("///", "TEMP");
  assert(code.startsWith("R_"), `a punctuation-only asset code must be prefixed R_, got ${code}`);
  assert(RULE_CODE_PATTERN.test(code), `prefixed code must match the rule code regex, got ${code}`);
}

/**
 * Step 3 — the overflow branch. 60 + 1 + 30 = 91 characters, so the code is
 * `55 + 1 + 8 = 64` exactly: the `varchar(64)` column's whole width, and not
 * one character more.
 *
 * The two-alarm case is the reason the hash exists at all: both inputs share
 * their first 55 characters, so truncation alone would map them to the same
 * code and migration `0048`'s unique index would refuse the second asset.
 */
export function assertAnOverflowingCodeIsTruncatedAndHashed(): void {
  const assetCode = "A".repeat(60);
  const code = seededRuleCode(assetCode, "B".repeat(30));

  assert(code.length === 64, `an overflowing code must be exactly 64 characters, got ${code.length}`);
  assert(RULE_CODE_PATTERN.test(code), `an overflowing code must match the rule code regex, got ${code}`);
  sameString(seededRuleCode(assetCode, "B".repeat(30)), code, "the derivation must be deterministic");

  const sibling = seededRuleCode(assetCode, `${"B".repeat(29)}C`);
  sameString(sibling.slice(0, 55), code.slice(0, 55), "the two inputs share their truncated prefix");
  assert(
    sibling !== code,
    `two inputs sharing 55 characters must not collide, both produced ${code}`,
  );
  assert(sibling.length === 64, `the sibling code must also be 64 characters, got ${sibling.length}`);
}

/**
 * Ordering: the `R_` prefix is applied BEFORE the length is measured.
 *
 * An empty asset part with a 63-character alarm code joins to 64 characters —
 * inside the column — and `R_` then makes it 66. An implementation that
 * measured first would emit a code `varchar(64)` refuses at insert time, which
 * no other case here reaches.
 */
export function assertThePrefixIsCountedBeforeTheLengthCheck(): void {
  const code = seededRuleCode("-", "X".repeat(63));
  assert(code.startsWith("R_"), `expected the R_ prefix, got ${code}`);
  assert(code.length <= 64, `the prefixed code must still fit varchar(64), got ${code.length}`);
  assert(RULE_CODE_PATTERN.test(code), `the prefixed code must match the rule code regex, got ${code}`);
}

/**
 * The whole hostile table, asserted as a table: an asset code is
 * `z.string().min(1).max(64)` with **no** character restriction (decision 7),
 * so unicode, punctuation-only and 64-character inputs are all reachable from
 * a valid template. Every one of them must still produce a code the API's own
 * `ruleCodeSchema` would accept.
 */
export function assertEveryHostileInputStillProducesAValidCode(): void {
  const cases: Array<[string, string]> = [
    ["", ""],
    ["__", "__"],
    ["-".repeat(64), "-".repeat(64)],
    ["CR-BATT-1", "TEMP_WARNING"],
    ["1", "2"],
    ["-", "X".repeat(63)],
    ["A".repeat(64), "B".repeat(64)],
    ["  ", "ALARM"],
    ["ASSET", ""],
    ["", "ALARM"],
    ["温度センサー", "高温"],
    ["Ω".repeat(64), "é".repeat(64)],
    ["a b c", "d.e/f"],
    ["_LEADING", "TRAILING_"],
    ["9-lives", "0"],
  ];

  const failures: string[] = [];
  for (const [assetCode, alarmCode] of cases) {
    const code = seededRuleCode(assetCode, alarmCode);
    if (!RULE_CODE_PATTERN.test(code)) {
      failures.push(`[${assetCode}] + [${alarmCode}] -> ${code} does not match ${String(RULE_CODE_PATTERN)}`);
    }
    if (code.length > 64) {
      failures.push(`[${assetCode}] + [${alarmCode}] -> ${code.length} characters, over varchar(64)`);
    }
  }
  assert(failures.length === 0, `hostile inputs produced invalid codes:\n  ${failures.join("\n  ")}`);
}

/**
 * Two alarm codes the content contract accepts as distinct — its uniqueness
 * check is exact-match — derive the SAME rule code, because normalisation maps
 * `-` and `_` onto one character.
 *
 * Pinned deliberately rather than treated as a defect: it is the whole reason
 * the seed needs an intra-batch code pre-check (plan D4). Without one, a
 * template carrying both codes reaches migration `0048`'s unique index inside
 * the transaction and rolls the whole instantiation back with a raw 23505.
 */
export function assertTwoAlarmCodesCanDeriveTheSameRuleCode(): void {
  sameString(
    seededRuleCode("CHILLER-1", "high-temp"),
    seededRuleCode("CHILLER-1", "high_temp"),
    "`high-temp` and `high_temp` derive one code — U4's pre-check is what catches this",
  );
}

// --------------------------------------------------------------------------
// D1 — the philosophy rendering
// --------------------------------------------------------------------------

export function assertPhilosophyRendersPresentFieldsOnly(): void {
  sameString(
    philosophyDescription({
      cause: "The battery room's extract fan has stopped.",
      impact: "Cell life shortens and the string may go off-line.",
      action: "Check the fan and the room temperature.",
      skill: "hvac_tech",
    }) ?? "",
    [
      "Cause: The battery room's extract fan has stopped.",
      "Impact: Cell life shortens and the string may go off-line.",
      "Action: Check the fan and the room temperature.",
      "Skill: hvac_tech",
    ].join("\n"),
    "all four philosophy lines",
  );

  sameString(
    philosophyDescription({ impact: "Only the impact was written." }) ?? "",
    "Impact: Only the impact was written.",
    "a partial philosophy renders only what is present",
  );

  assert(philosophyDescription(undefined) === null, "an absent philosophy renders null");
  assert(philosophyDescription({}) === null, "an empty philosophy object renders null");
}

// --------------------------------------------------------------------------
// Decisions 2, 3, 4, 5 — the seeded row
// --------------------------------------------------------------------------

/** Decision 4: the class already knows the limit, so the asset is watched at once. */
export function assertAProtoAlarmSeedsAnArmedRule(): void {
  const row = buildRow({ code: "OVER_TEMP", operator: "gt", thresholdValue: 45 });

  assert(row.enabled === true, "a proto-rule seeds enabled");
  sameString(row.operator ?? "", "gt", "the alarm's operator");
  assert(row.thresholdValue === 45, `the alarm's threshold, got ${String(row.thresholdValue)}`);
  sameString(row.code ?? "", "CR_BATT_1_OVER_TEMP", "the derived code");
  sameString(row.ruleType ?? "", "threshold", "rule type");
  sameString(row.source ?? "", "template_alarm", "source (decision 6)");
  sameString(row.lifecycleStatus ?? "", "published", "lifecycle status — setEnabled refuses anything else");
  assert(row.publishedAt === NOW, "published_at is the caller's clock");
  sameString(row.sourceAlarmCode ?? "", "OVER_TEMP", "source_alarm_code");
  sameString(row.sourceTemplateId ?? "", TEMPLATE.id, "source_template_id");
  assert(row.sourceTemplateVersion === TEMPLATE.version, "source_template_version");
  assert(row.assetId === ASSET_ID, "the rule binds to the created asset");
  assert(row.organizationId === ORG_ID, "the rule carries the template's organization");
  sameString(row.pointKey ?? "", "temp_c", "the parameter the alarm watches (decision 3)");
  assert(row.clearHoldSeconds === null, "clear_hold_seconds is left at the default (D1)");
  assert(row.duplicatedFromRuleId === null, "a seeded rule is not a duplicate (D1)");
  assert(row.description === null, "a proto-rule with no philosophy has no description");
}

/** Decision 3: no limit, so no arming — and the philosophy is what the row carries instead. */
export function assertAPhilosophyAlarmSeedsADisabledRule(): void {
  const row = buildRow({
    code: "ROOM_TEMP_HIGH",
    philosophy: { cause: "Extract fan stopped.", impact: "Cell life shortens." },
  });

  assert(row.enabled === false, "a philosophy row seeds disabled");
  assert(row.operator === null, `operator must be NULL, got ${String(row.operator)}`);
  assert(row.thresholdValue === null, `threshold must be NULL, got ${String(row.thresholdValue)}`);
  const description = row.description ?? "";
  assert(description.includes("Cause: Extract fan stopped."), `description must carry the cause, got ${description}`);
  assert(description.includes("Impact: Cell life shortens."), `description must carry the impact, got ${description}`);
  sameString(row.ruleType ?? "", "threshold", "a philosophy row is still a threshold rule (decision 3)");
}

/**
 * Decision 2 — every seeded rule is `review` on its own category, and no
 * notification channel is joined. `review` is inert (ADR 0041 decision 9): the
 * rule raises its alarm and pages nobody.
 */
export function assertTheActionIsReviewOnTheResolvedCategory(): void {
  sameObject(
    buildRow({ category: "battery" }).action,
    { type: "review", target: "battery" },
    "the action of an alarm carrying a category",
  );
  sameObject(
    buildRow().action,
    { type: "review", target: DEFAULT_RULE_CATEGORY_CODE },
    "the action of an alarm carrying no category falls back to the default concern",
  );
}

/** D2: the baseline stores the RESOLVED values, including the defaulted category. */
export function assertTheBaselineCarriesTheResolvedValues(): void {
  sameObject(
    buildRow({ code: "OVER_TEMP", operator: "gte", thresholdValue: 45, category: "battery" }).seededBaseline,
    {
      operator: "gte",
      thresholdValue: 45,
      severity: "warning",
      category: "battery",
      message: "Battery temperature is high",
    },
    "a proto-rule's baseline",
  );
  sameObject(
    buildRow().seededBaseline,
    {
      operator: null,
      thresholdValue: null,
      severity: "warning",
      category: DEFAULT_RULE_CATEGORY_CODE,
      message: "Battery temperature is high",
    },
    "a philosophy row's baseline, with the DEFAULTED category (D2)",
  );

  // The baseline is read back by decision 8's list route through
  // `seededRuleValuesSchema`. A row it cannot parse is a drift verdict that
  // throws at read time, on a column nothing validates at write time.
  const parsed = seededRuleValuesSchema.safeParse(buildRow({ operator: "lt", thresholdValue: 2 }).seededBaseline);
  assert(parsed.success, `seededBaseline must satisfy the shared contract: ${JSON.stringify(parsed.error?.issues)}`);
}

/** D1: `name` is `varchar(255)`, and a template message may be 500. */
export function assertTheNameIsTruncatedToTheColumnWidth(): void {
  const message = "T".repeat(500);
  const row = buildRow({ message });
  assert(row.name.length === 255, `name must be truncated to 255, got ${row.name.length}`);
  sameString(row.name, message.slice(0, 255), "name is the message's first 255 characters");
  sameString(
    (row.seededBaseline as { message: string }).message,
    message,
    "the baseline keeps the whole message — it is compared against the template, not the column",
  );
}

/**
 * D1 — `condition.unit` is present only when a unit was resolved.
 * `latestConditionSchema` is `.strict()` with `unit` optional, and a key
 * holding `undefined` is a key: it survives into the jsonb column as
 * `"unit": null` and makes an in-sync rule look edited.
 */
export function assertTheConditionOmitsUnitWhenThereIsNone(): void {
  const withoutUnit = buildRow({}, null);
  assert(
    !Object.hasOwn(withoutUnit.condition as object, "unit"),
    `condition must not carry a unit key at all, got ${JSON.stringify(withoutUnit.condition)}`,
  );
  sameObject(withoutUnit.condition, { window: "latest" }, "the condition with no unit");
  sameObject(buildRow({}, "degC").condition, { window: "latest", unit: "degC" }, "the condition with a unit");
}

// --------------------------------------------------------------------------
// Decision 8 — the drift verdict
// --------------------------------------------------------------------------

const BASELINE: SeededRuleValues = {
  operator: "gt",
  thresholdValue: 45,
  severity: "warning",
  category: "battery",
  message: "Battery temperature is high",
};

function moved(overrides: Partial<SeededRuleValues>): SeededRuleValues {
  return { ...BASELINE, ...overrides };
}

export function assertTheFourDriftQuadrants(): void {
  sameString(
    driftVerdict(BASELINE, BASELINE, BASELINE),
    "in_sync",
    "live, baseline and current all agree",
  );
  sameString(
    driftVerdict(moved({ thresholdValue: 50 }), BASELINE, BASELINE),
    "local_override",
    "the engineer moved the rule and the template did not",
  );
  sameString(
    driftVerdict(BASELINE, BASELINE, moved({ thresholdValue: 40 })),
    "template_moved",
    "the template moved and the live rule did not",
  );
  sameString(
    driftVerdict(moved({ thresholdValue: 50 }), BASELINE, moved({ thresholdValue: 40 })),
    "both_moved",
    "both moved",
  );
  sameString(
    driftVerdict(moved({ severity: "critical" }), BASELINE, BASELINE),
    "local_override",
    "severity is one of the five compared fields",
  );
  sameString(
    driftVerdict(moved({ message: "Battery temperature is very high" }), BASELINE, BASELINE),
    "local_override",
    "the message — the rule's name — is one of the five compared fields",
  );
  sameString(
    driftVerdict(BASELINE, BASELINE, moved({ category: "safety" })),
    "template_moved",
    "category is one of the five compared fields",
  );
}

/**
 * D5 — `current === null` is the alarm code the currently published version no
 * longer carries. There is nothing to compare against, so the template has
 * moved by definition.
 */
export function assertARemovedAlarmReadsAsTemplateMoved(): void {
  sameString(driftVerdict(BASELINE, BASELINE, null), "template_moved", "the alarm was removed from the template");
  sameString(
    driftVerdict(moved({ thresholdValue: 50 }), BASELINE, null),
    "both_moved",
    "the alarm was removed and the engineer had also moved the rule",
  );
}

/** Numeric and null equality, since a jsonb read-back is not the same object. */
export function assertNumericAndNullEqualityInTheComparison(): void {
  sameString(
    driftVerdict(moved({ thresholdValue: 7 }), moved({ thresholdValue: 7.0 }), moved({ thresholdValue: 7 })),
    "in_sync",
    "7 and 7.0 are the same threshold",
  );
  const nulls = moved({ operator: null, thresholdValue: null });
  sameString(
    driftVerdict(nulls, nulls, nulls),
    "in_sync",
    "an un-commissioned philosophy row compares equal to itself",
  );
  sameString(
    driftVerdict(nulls, nulls, moved({ operator: "gt", thresholdValue: 45 })),
    "template_moved",
    "the template supplied the limit this philosophy row never had",
  );
}

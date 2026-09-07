import { createHash } from "node:crypto";

import type { automationRules } from "@bms/db";
import { DEFAULT_RULE_CATEGORY_CODE } from "@bms/shared";
import type { SeededRuleDriftVerdict, SeededRuleValues } from "@bms/shared";

import type { TemplateContentParsed } from "./asset-templates-content.schema";

/**
 * `E2.4` / ADR 0058 — the pure half of "a template alarm becomes a rule".
 *
 * Everything here is a function of its arguments: no database, no NestJS, no
 * service. The instantiate service (U4) calls `seededRuleValues` once per alarm
 * per asset inside its existing `withTenant` transaction, and the drift routes
 * (U6) call `driftVerdict`. Keeping the derivation out of both means the code
 * scheme is provable against every input the content contract permits rather
 * than only against whatever a fixture happens to hold — which matters, because
 * `bms.automation_rules.code` is `varchar(64)` and unique on
 * `(organization_id, code)`, so a bad derivation is a failed instantiation of
 * up to 200 assets rather than a cosmetic defect.
 *
 * It also keeps `asset-templates-instantiate.service.ts` (561 lines) and
 * `rules.service.ts` (977) clear of the AGENTS.md §4.5 cap.
 */

/**
 * Ceiling on `automation_rules` rows per instantiate call.
 *
 * The same arithmetic as `MAX_POINT_ROWS`, one table over: Postgres caps a
 * statement at 65,535 bind parameters and `seededRuleValues` below binds **26**
 * columns per row, so a single statement fails above 2,520 rows. The Zod
 * contracts permit 200 assets x 200 alarms = 40,000, so a bound is needed for a
 * legitimately large batch to return a named domain error instead of a raw
 * driver one.
 *
 * **The margin here is thin and the caller must know it.** 2,500 x 26 = 65,000
 * bind parameters, 535 under the ceiling — about twenty rows. The plan's "~22
 * columns" predates this file stamping `createdAt`, `updatedAt` and
 * `archivedAt` explicitly. **One more column on this insert takes the ceiling
 * below 2,500** and a full batch then fails with a driver error rather than the
 * 400 this constant exists to produce. Anything that widens the row must
 * re-measure this number in the same change.
 *
 * That demand is no longer only prose: `template-alarm-rules.spec.ts` counts the
 * keys of a real `seededRuleValues` row and multiplies, so a 27th column reddens
 * the suite here rather than in production on the first full batch.
 */
export const MAX_RULE_ROWS = 2_500;

/** `bms.automation_rules.code` is `varchar(64)`. */
const CODE_MAX_LENGTH = 64;

/** `ruleCodeSchema` is `.min(3)` as well as `.max(64)` — see {@link seededRuleCode}. */
const CODE_MIN_LENGTH = 3;

/** Decision 7 step 3: `55 + 1 + 8 = 64`, the column's whole width. */
const TRUNCATED_LENGTH = 55;
const HASH_LENGTH = 8;

/**
 * One `content.alarms[]` entry, derived from the content contract rather than
 * restated. `templateAlarmSchema` is private to that module and its optional
 * pairing rule (ADR 0019 Amendment 2) is enforced there; a second declaration
 * here would be a copy that drifts.
 */
export type TemplateAlarm = NonNullable<TemplateContentParsed["alarms"]>[number];

/** One `automation_rules` insert, as drizzle accepts it. */
export type SeededRuleInsert = typeof automationRules.$inferInsert;

/** Everything `seededRuleValues` needs that is not on the alarm itself. */
export interface SeededRuleInput {
  alarm: TemplateAlarm;
  /** The asset created by this instantiation — the rule's subject. */
  assetId: string;
  /** The asset's code, the first half of the derived rule code. */
  assetCode: string;
  /** The template's organization; ADR 0043's `WITH CHECK` needs it stamped. */
  organizationId: string;
  template: { id: string; version: number };
  /** The template point override's unit, else the catalog's, else `null` (D1). */
  unit: string | null;
  /** One clock for the whole batch, so every row of a call agrees. */
  now: Date;
}

/**
 * Decision 7 step 1 — uppercase, every run of characters outside `[A-Z0-9]`
 * becomes a single `_`, leading and trailing `_` stripped.
 *
 * `toUpperCase()` before the class filter and not after, so `a` and `A` reach
 * the same code. Anything unicode leaves no letter behind (`é` uppercases to
 * `É`, which is outside `[A-Z0-9]`), which is why a part can legitimately
 * normalise to the empty string and step 2 exists.
 */
function normalisePart(part: string): string {
  return part
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+/, "")
    .replace(/_+$/, "");
}

/**
 * The rule code for one alarm on one asset — ADR 0058 decision 7, matching the
 * existing seed convention (`CR-BATT-1` + `TEMP_WARNING` ->
 * `CR_BATT_1_TEMP_WARNING`).
 *
 * The output always satisfies `ruleCodeSchema` — `^[A-Z0-9][A-Z0-9_-]*$`,
 * `.min(3)` and `.max(64)` — and fits `varchar(64)`, for every input the content
 * contract permits. An asset code is `z.string().min(1).max(64)` with **no**
 * character restriction and an alarm code is up to 64 characters, so a naive
 * join overflows the column, can carry characters the regex refuses, and can
 * come out shorter than the schema's floor.
 *
 * Three orderings are load-bearing and none is obvious:
 *
 * - **The `R_` prefix is applied before the length is measured.** An empty
 *   asset part with a 63-character alarm code joins to exactly 64 and the
 *   prefix then makes it 66; measuring first would emit a code the column
 *   refuses at insert time.
 * - **The hash is taken over the prefixed, untruncated string** — the result of
 *   step 2, which is what decision 7 calls "the untruncated string". Pinned
 *   here so U4 and U6 do not re-derive it differently and compute a code that
 *   no longer matches the stored one.
 * - **The three-character floor is applied after the prefix, on the branch that
 *   did not overflow.** `A` + `-` normalises to `A_`: two characters, which
 *   `ruleCodeSchema` refuses, so the rule builder PATCHing a seeded rule's own
 *   code would 400 on a field the operator never typed — the same class of
 *   defect as the `name` and `description` bounds below. Only this branch can
 *   be short: two empty parts already reach three as `R__`, and the hash branch
 *   always lands on 64. A padded degenerate code can equal another degenerate
 *   sibling — asset `R` and asset `-` both give `R__` for a punctuation-only
 *   alarm code — which is the collision class plan D4's intra-batch pre-check
 *   already exists for, not a new one.
 *
 * The hex is **upper-cased**: `ruleCodeSchema` accepts `[A-Z0-9_-]` only, so a
 * lower-case digest would produce a code the API's own contract rejects. ADR
 * 0058's text omits this; the plan's §8 records it.
 */
export function seededRuleCode(assetCode: string, alarmCode: string): string {
  const joined = `${normalisePart(assetCode)}_${normalisePart(alarmCode)}`;
  const prefixed = /^[A-Z0-9]/.test(joined) ? joined : `R_${joined}`;
  if (prefixed.length <= CODE_MAX_LENGTH) {
    return prefixed.padEnd(CODE_MIN_LENGTH, "_");
  }
  const digest = createHash("sha256")
    .update(prefixed)
    .digest("hex")
    .slice(0, HASH_LENGTH)
    .toUpperCase();
  return `${prefixed.slice(0, TRUNCATED_LENGTH)}_${digest}`;
}

/** `ruleUpdateBodySchema`'s `description.max(2000)` — see {@link philosophyDescription}. */
const MAX_RULE_DESCRIPTION = 2000;

/** `ruleUpdateBodySchema`'s `name.min(3)` — see {@link seededRuleName}. */
const MIN_RULE_NAME = 3;

/**
 * The rule's human label, kept inside `ruleUpdateBodySchema`'s `name` bounds.
 *
 * A template alarm's `message` is `min(1)`, so a one- or two-character message
 * would produce a name the rule editor's own schema refuses — the row saves
 * (the column is `varchar(255)`) and can then never be edited. Falling back to
 * `code: message` is always at least four characters, because `code` is
 * `min(1)` too, and it reads as a label rather than as padding.
 */
export function seededRuleName(alarm: TemplateAlarm): string {
  const message = alarm.message.trim();
  const name = message.length >= MIN_RULE_NAME ? message : `${alarm.code}: ${message}`;
  return name.slice(0, 255);
}

/**
 * D1 — the alarm philosophy as the rule's `description`: `Cause:`, `Impact:`,
 * `Action:` and `Skill:` lines, present fields only, `null` when the alarm
 * carries no philosophy or an empty one.
 *
 * This is the ISA-18.2 rationalization record ADR 0058's Context names — the
 * same four fields `bms.alarm_enrichments` (ADR 0034) makes an operator type
 * per live alarm, carried onto the rule so the knowledge reaches the person
 * looking at it. `skill` renders as its code: it is a key into
 * `bms.alarm_skills` and this function does no IO to resolve a label.
 */
export function philosophyDescription(philosophy: TemplateAlarm["philosophy"]): string | null {
  if (!philosophy) {
    return null;
  }
  const lines: string[] = [];
  if (philosophy.cause !== undefined) {
    lines.push(`Cause: ${philosophy.cause}`);
  }
  if (philosophy.impact !== undefined) {
    lines.push(`Impact: ${philosophy.impact}`);
  }
  if (philosophy.action !== undefined) {
    lines.push(`Action: ${philosophy.action}`);
  }
  if (philosophy.skill !== undefined) {
    lines.push(`Skill: ${philosophy.skill}`);
  }
  if (lines.length === 0) {
    return null;
  }
  // Clamped to `ruleUpdateBodySchema`'s `description.max(2000)`, not to the
  // column, which is `text` and would take all of it. The four philosophy
  // fields are 2000 characters each, so a fully authored philosophy renders at
  // over 8000 and the row would then be un-PATCHable: the rule editor sends the
  // whole object, and the write would 400 on a field the operator never typed.
  // That is the same class of defect as the point-key refusal ruled on as Q1 —
  // a seeded rule the local override cannot reach. The full text stays on the
  // template, which is its home; the ellipsis says the rule's copy is short.
  const joined = lines.join("\n");
  return joined.length <= MAX_RULE_DESCRIPTION
    ? joined
    : `${joined.slice(0, MAX_RULE_DESCRIPTION - 1)}…`;
}

/**
 * The five fields decision 5 makes drift attributable on, as one template alarm
 * resolves them: the **defaulted** category, `null` rather than `undefined` for
 * an absent operator or threshold, and the **derived** name rather than
 * `alarm.message` verbatim.
 *
 * Exported and shared rather than inlined, because decision 8 compares three
 * `SeededRuleValues` and two of them are derived from a template alarm.
 * `seededRuleValues` builds both the row's own columns and its `seeded_baseline`
 * from this one call, and U6 must build its `current` by calling this on the
 * currently published version's alarm. **A second derivation is the hazard.**
 * `templateAlarmSchema.message` allows 1 to 500 characters while `seededRuleName`
 * trims, floors at three and slices to 255, so a `current` built from
 * `alarm.message` raw would differ from a baseline nobody has touched, and every
 * rule whose message is long, short or padded would read `template_moved`. The
 * rule table has no message column: `driftVerdict` compares this `message`
 * against the rule's `name`, which is what "as seeded" in decision 5 means.
 */
export function seededBaselineValues(alarm: TemplateAlarm): SeededRuleValues {
  return {
    operator: alarm.operator ?? null,
    thresholdValue: alarm.thresholdValue ?? null,
    severity: alarm.severity,
    category: alarm.category ?? DEFAULT_RULE_CATEGORY_CODE,
    message: seededRuleName(alarm),
  };
}

/**
 * The `automation_rules` row one template alarm becomes on one asset — ADR
 * 0058 decisions 2, 3, 4 and 5, and the plan's D1/D2.
 *
 * - `enabled` is decisions 3 and 4 in one expression: both of `operator` and
 *   `thresholdValue` present arms the rule (the class already knows the limit),
 *   both absent seeds a disabled philosophy row whose limit is set per site at
 *   commissioning. One without the other cannot occur — `templateAlarmSchema`'s
 *   `superRefine` already refuses half a rule.
 * - `action` is always `{type: "review", target: <category>}` (decision 2) and
 *   **no `rule_notifications` row is written by the caller**. `review` is inert
 *   (ADR 0041 decision 9): 160 seeded rules raise alarms onto the Active Alarms
 *   rail and page nobody until someone joins a channel deliberately.
 * - `lifecycleStatus: "published"` is not cosmetic: `setEnabled` refuses a
 *   non-published rule, so a `draft` seed would be uncommissionable.
 * - `seededBaseline` stores the **resolved** values (D2), and the row's own
 *   `category`, `operator`, `threshold_value`, `severity` and `name` are taken
 *   off that same object rather than re-derived beside it. One derivation, so
 *   the jsonb records what was written by construction instead of by two
 *   expressions that happen to agree today — see {@link seededBaselineValues}.
 * - `createdAt`/`updatedAt`/`publishedAt` all take the caller's `now` rather
 *   than the column default, matching `createDraft`, so every row of one batch
 *   carries one timestamp.
 */
export function seededRuleValues(input: SeededRuleInput): SeededRuleInsert {
  const { alarm, assetCode, assetId, now, organizationId, template, unit } = input;
  // The row's columns and the baseline it stores are ONE derivation. Destructured
  // from the baseline rather than computed again beside it, so `seeded_baseline`
  // cannot record a value the row does not carry.
  const baseline = seededBaselineValues(alarm);
  const { category, operator, thresholdValue } = baseline;

  // Built conditionally, never `unit: unit ?? undefined`: a key holding
  // `undefined` is still a key once it reaches jsonb, and
  // `latestConditionSchema` is `.strict()`.
  const condition: { window: "latest"; unit?: string } = { window: "latest" };
  if (unit !== null) {
    condition.unit = unit;
  }

  return {
    organizationId,
    code: seededRuleCode(assetCode, alarm.code),
    name: baseline.message,
    description: philosophyDescription(alarm.philosophy),
    category,
    ruleType: "threshold",
    source: "template_alarm",
    enabled: operator !== null && thresholdValue !== null,
    assetId,
    pointKey: alarm.pointKey,
    operator,
    thresholdValue,
    severity: baseline.severity,
    clearHoldSeconds: null,
    condition,
    action: { type: "review", target: category },
    lifecycleStatus: "published",
    publishedAt: now,
    archivedAt: null,
    duplicatedFromRuleId: null,
    sourceTemplateId: template.id,
    sourceTemplateVersion: template.version,
    sourceAlarmCode: alarm.code,
    seededBaseline: baseline,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * The five fields decision 5 makes drift attributable on.
 *
 * `===` and not a JSON comparison: a jsonb read-back gives a fresh object, and
 * `7` and `7.0` are the same `double precision` value on both sides of it.
 */
export function valuesEqual(a: SeededRuleValues, b: SeededRuleValues): boolean {
  return (
    a.operator === b.operator &&
    a.thresholdValue === b.thresholdValue &&
    a.severity === b.severity &&
    a.category === b.category &&
    a.message === b.message
  );
}

/**
 * ADR 0058 decision 8 — how one live seeded rule stands against the template's
 * currently published version.
 *
 * `live` is the rule's own columns (its `name` is what carries `message` — the
 * rule table has no message column), `baseline` is the `seeded_baseline` jsonb
 * it was written with, and `current` is what the presently published version
 * would seed today. Comparing live against current alone says only that the two
 * differ; the baseline is what says **who** moved.
 *
 * **All three sides must speak one dialect.** `baseline` and `current` must both
 * come from {@link seededBaselineValues} — the baseline does by construction,
 * and the caller building `current` must call it rather than read the alarm's
 * fields directly. `live` is the rule row, read through the columns that
 * derivation wrote (`name` for `message`), possibly edited since: that edit is
 * the signal this function exists to detect. A `current` assembled any other way
 * reports `template_moved` on every rule whose message is long, short or padded
 * — trading the false `local_override` this module already fixed for a false
 * `template_moved`, on the same inputs.
 *
 * `current === null` is D5's removed alarm: the published version no longer
 * carries this `source_alarm_code`, so there is nothing to compare against and
 * the template has moved by definition. Re-apply refuses such a rule (D6).
 */
export function driftVerdict(
  live: SeededRuleValues,
  baseline: SeededRuleValues,
  current: SeededRuleValues | null,
): SeededRuleDriftVerdict {
  const localMoved = !valuesEqual(live, baseline);
  const templateMoved = current === null || !valuesEqual(current, baseline);
  if (localMoved && templateMoved) {
    return "both_moved";
  }
  if (localMoved) {
    return "local_override";
  }
  if (templateMoved) {
    return "template_moved";
  }
  return "in_sync";
}

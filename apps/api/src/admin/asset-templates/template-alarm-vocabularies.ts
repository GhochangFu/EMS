import type { TemplateAlarm } from "./template-alarm-rules";

/**
 * `E2.4` — the one place that decides whether a stored template alarm still
 * names live vocabulary, and how that refusal is worded.
 *
 * It was `AssetTemplatesAdminService.assertTemplateAlarmVocabularies`'s private
 * body, checked on create/update/publish only. `E2.4` gave the alarms a
 * consumer: instantiate now writes one `bms.automation_rules` row per alarm per
 * asset, stamping `category` and `severity` straight into columns closed by
 * `automation_rules_category_fk` / `automation_rules_severity_fk`. A value that
 * was live when the version was published and retired before it was
 * instantiated therefore had no gate at all — the same case
 * `assertCatalogActive` already handles one level down for point keys, and for
 * the same stated reason: "a template published six months ago can name a key
 * deactivated last week".
 *
 * Extracted rather than copied. Two spellings of "is this code live" is how the
 * publish gate and the instantiate gate drift into disagreeing, and a template
 * that publishes but cannot be instantiated (or the reverse) is worse than
 * either rule alone.
 *
 * **Everything here is non-echoing, and that is a security property, not a
 * style.** It runs over *stored* content — pre-ADR rows hold arbitrary JSON
 * written by whoever, and `content` is `jsonb` with no foreign key, so the
 * offending value is attacker-influenced text. Echoing it back would turn a
 * refusal into a disclosure channel; a security review already forced this
 * property once on the publish path (the category branch was newly reachable
 * over stored content while only severity was written out non-echoing). The
 * problem below therefore carries the **path** and the **live codes**, and no
 * field that can hold a stored value. Do not add one.
 */

/**
 * Just the code column of each vocabulary this check reads.
 *
 * Structural rather than `VocabulariesResponse`, so the module stays pure — no
 * NestJS, no database, no service — and so a caller cannot accidentally pass a
 * list that includes retired rows: whoever calls this decides what "live"
 * means, and today both callers get it from `VocabulariesService.list()`, which
 * filters `active = true`.
 */
export interface LiveAlarmVocabularies {
  readonly ruleCategories: readonly { readonly code: string }[];
  readonly alarmSeverities: readonly { readonly code: string }[];
  readonly alarmSkills: readonly { readonly code: string }[];
}

/** A refusal, described without the value that caused it. */
export interface AlarmVocabularyProblem {
  /** `content.alarms.3.severity` — the path into the content, never a value. */
  readonly path: string;
  /** The noun the message uses: also the axis the caller must reactivate. */
  readonly axis: "category" | "severity" | "skill";
  /** The live codes, in the order the vocabulary returned them. */
  readonly expected: readonly string[];
}

/**
 * The first alarm whose vocabulary is no longer live, or `null`.
 *
 * **The check order is category, then severity, then skill, and it is
 * load-bearing** — each axis scans *every* alarm before the next axis is
 * considered, so alarm 0's bad severity is reported only when no alarm has a
 * bad category. That is exactly what the publish path did before this was
 * extracted, and `asset-templates.lifecycle.integration.spec.ts` probes the
 * three branches one at a time by restoring the earlier axes to live values —
 * a reorder here would make two of those three probes assert nothing.
 *
 * `category` and `philosophy.skill` are optional on a template alarm, so an
 * absent one is not a failure: absent means "unspecified", and the rule builder
 * default applies. `severity` is required by the content contract, so it is
 * checked unconditionally.
 */
export function findAlarmVocabularyProblem(
  alarms: readonly TemplateAlarm[],
  live: LiveAlarmVocabularies,
): AlarmVocabularyProblem | null {
  if (alarms.length === 0) {
    return null;
  }

  const liveCategoryCodes = new Set(live.ruleCategories.map((row) => row.code));
  const badCategory = alarms.findIndex(
    (alarm) => typeof alarm.category === "string" && !liveCategoryCodes.has(alarm.category),
  );
  if (badCategory >= 0) {
    return {
      path: `content.alarms.${badCategory}.category`,
      axis: "category",
      expected: [...liveCategoryCodes],
    };
  }

  const liveSeverityCodes = new Set(live.alarmSeverities.map((row) => row.code));
  const badSeverity = alarms.findIndex((alarm) => !liveSeverityCodes.has(alarm.severity));
  if (badSeverity >= 0) {
    return {
      path: `content.alarms.${badSeverity}.severity`,
      axis: "severity",
      expected: [...liveSeverityCodes],
    };
  }

  const liveSkillCodes = new Set(live.alarmSkills.map((row) => row.code));
  const badSkill = alarms.findIndex(
    (alarm) =>
      typeof alarm.philosophy?.skill === "string" && !liveSkillCodes.has(alarm.philosophy.skill),
  );
  if (badSkill >= 0) {
    return {
      path: `content.alarms.${badSkill}.philosophy.skill`,
      axis: "skill",
      expected: [...liveSkillCodes],
    };
  }

  return null;
}

/**
 * The sentence both callers use, byte for byte what the publish path has
 * emitted since ADR 0031 Amendment 1 / ADR 0032 / ADR 0034 — the three axes
 * only ever differed by the noun, which is why one template works for all of
 * them.
 */
export function alarmVocabularyMessage(problem: AlarmVocabularyProblem): string {
  return (
    `${problem.path} is not a live ${problem.axis}. ` +
    `Expected one of: ${problem.expected.join(", ")}.`
  );
}

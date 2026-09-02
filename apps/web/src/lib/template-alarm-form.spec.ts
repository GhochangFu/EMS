/**
 * The Alarms tab's form rules (`F2.5`, ADR 0038 Unit 9e).
 */
import { automationRuleOperatorSchema } from "@bms/shared/contracts";
import type { TemplateAlarm } from "@bms/shared";

import {
  ALARM_OPERATORS,
  MAX_ALARM_ENTRIES,
  OPERATOR_LABELS,
  alarmFormErrors,
  alarmRowsFrom,
  alarmsHaveChanged,
  blankAlarmRow,
  buildAlarmPayload,
  parseThreshold,
  type TemplateAlarmRow,
} from "./template-alarm-form";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const DECLARED = ["CHW_SUPPLY_T", "FLOW"];
const VOCAB = {
  severities: ["info", "warning", "critical"],
  categories: ["cooling", "power"],
  skills: ["mechanical", "electrical"],
};

function row(overrides: Partial<TemplateAlarmRow> = {}): TemplateAlarmRow {
  return {
    code: "SUPPLY_HIGH",
    pointKey: "CHW_SUPPLY_T",
    operator: "gt",
    thresholdValue: "12",
    severity: "warning",
    message: "Chilled water supply is above target.",
    category: "",
    cause: "",
    impact: "",
    action: "",
    skill: "",
    ...overrides,
  };
}

/**
 * **Zero and empty are different, and this is the field where confusing them
 * arms an alarm nobody asked for.**
 *
 * `thresholdValue` is `z.number().finite()` and required. `Number("")` is `0`,
 * and `0` is a perfectly good threshold.
 */
export function runThresholdZeroVersusEmptyTests(): void {
  assert(parseThreshold("0") === 0, "zero is a real threshold");
  assert(parseThreshold("") === null, "an empty box is not a threshold");
  assert(parseThreshold("   ") === null, "a whitespace box is not a threshold");
  assert(parseThreshold("") !== 0, "an empty box must never read as zero");
  assert(parseThreshold("-4.5") === -4.5, "a negative fraction parses");
  // `.finite()` refuses both of these.
  assert(parseThreshold("Infinity") === null, "infinity is not finite");
  assert(parseThreshold("abc") === null, "a non-number is not a threshold");

  // ADR 0019 Amendment 2: `operator` and `thresholdValue` are a paired
  // optional group. An empty threshold used to be refused unconditionally —
  // it is now refused only when the operator is NOT also empty.
  const pairAbsent = alarmFormErrors(
    [row({ thresholdValue: "", operator: "" })],
    DECLARED,
    VOCAB,
  );
  assert(
    pairAbsent.length === 0,
    `an empty threshold and an empty operator together are accepted — got ${JSON.stringify(pairAbsent)}`,
  );

  const thresholdMissing = alarmFormErrors([row({ thresholdValue: "" })], DECLARED, VOCAB);
  assert(
    thresholdMissing.length === 1 && thresholdMissing[0].field === "thresholdValue",
    "an empty threshold with an operator set is refused",
  );
  assert(
    thresholdMissing[0].message.includes("half a rule"),
    `the refusal names both-or-neither in words, matching the server — got ${thresholdMissing[0].message}`,
  );

  // The mirror: an operator cleared while a threshold is set is refused too.
  const operatorMissing = alarmFormErrors([row({ operator: "" })], DECLARED, VOCAB);
  assert(
    operatorMissing.length === 1 && operatorMissing[0].field === "thresholdValue",
    "a threshold with no operator is refused, mirroring the threshold-missing case",
  );
  assert(
    operatorMissing[0].message.includes("half a rule"),
    `the refusal names both-or-neither in words, matching the server — got ${operatorMissing[0].message}`,
  );

  const junk = alarmFormErrors([row({ thresholdValue: "abc" })], DECLARED, VOCAB);
  assert(
    junk[0].message.includes("must be a number"),
    `a malformed box says so — got ${junk[0].message}`,
  );

  // Zero survives all the way to the wire.
  assert(alarmFormErrors([row({ thresholdValue: "0" })], DECLARED, VOCAB).length === 0, "zero is valid");
  assert(buildAlarmPayload([row({ thresholdValue: "0" })])[0].thresholdValue === 0, "zero is sent as 0");

  // **The builder must not paper over a missing threshold with a number.**
  //
  // This is unreachable behind the disabled Save, and it is asserted anyway:
  // the entire reason the builder sends `NaN` rather than `?? 0` is that the
  // schema is `.finite()`, so a payload that somehow escaped the gate is
  // *refused* instead of arming an alarm at zero. Without this the `?? 0`
  // version passes every other assertion in this file — it did, as a surviving
  // mutation, until this was written.
  for (const unusable of ["", "   ", "abc", "Infinity"]) {
    const [sent] = buildAlarmPayload([row({ thresholdValue: unusable })]);
    assert(
      !Number.isFinite(sent.thresholdValue),
      `a threshold of ${JSON.stringify(unusable)} must not become a usable number — got ${sent.thresholdValue}`,
    );
    assert(
      sent.thresholdValue !== 0,
      `…and must never become zero, which is a threshold an author may have meant — got ${sent.thresholdValue}`,
    );
  }
}

/**
 * Optional keys are absent, not null — the Unit 9d trap, one level deeper.
 *
 * `templateAlarmSchema` and `alarmPhilosophySchema` are both `.strict()`, and
 * every optional field is `.optional()`, which rejects `null`.
 */
export function runOptionalKeysAreOmittedTests(): void {
  const [bare] = buildAlarmPayload([row()]);
  // `in`, not `=== undefined`: a present-but-undefined key passes the second
  // check and `JSON.stringify` then drops it, so the wire would be right by
  // accident while the assertion proved nothing.
  assert(!("category" in bare), `an unset category is absent — got ${JSON.stringify(bare)}`);
  assert(
    !("philosophy" in bare),
    `an entirely empty philosophy is omitted, not sent as {} — got ${JSON.stringify(bare)}`,
  );

  const [some] = buildAlarmPayload([row({ cause: "Fouled condenser.", skill: "mechanical" })]);
  assert("philosophy" in some, "a philosophy with any field set is sent");
  assert(some.philosophy?.cause === "Fouled condenser.", "the set field survives");
  assert(some.philosophy?.skill === "mechanical", "…and so does the skill");
  assert(
    !("impact" in (some.philosophy ?? {})),
    `an unset philosophy field is absent — got ${JSON.stringify(some.philosophy)}`,
  );

  const [withCategory] = buildAlarmPayload([row({ category: "cooling" })]);
  assert(withCategory.category === "cooling", "a set category is sent");

  // Whitespace is an absence in every one of them.
  const [padded] = buildAlarmPayload([row({ category: "  ", cause: "   ", skill: " " })]);
  assert(!("category" in padded), "a whitespace category is absent");
  assert(!("philosophy" in padded), "a philosophy of only whitespace is omitted entirely");
}

/** The five operators are the contract's, and each has a label. */
export function runOperatorVocabularyTests(): void {
  assert(
    ALARM_OPERATORS.join(",") === automationRuleOperatorSchema.options.join(","),
    "the operator list is the contract's, not a copy",
  );
  assert(ALARM_OPERATORS.length === 5, `five operators — got ${ALARM_OPERATORS.length}`);
  for (const operator of ALARM_OPERATORS) {
    assert(
      (OPERATOR_LABELS[operator] ?? "").length > 0,
      `${operator} has no label, and would render as a blank option`,
    );
  }
  // The wording is `rule-builder-panel.tsx`'s, so one comparison does not get
  // two names in one product. `neq` is deliberately absent — the rule engine
  // has no such operator, and a template must not author what it cannot run.
  assert(OPERATOR_LABELS.gte === "at least", "the shared wording for gte");
  assert(!(ALARM_OPERATORS as readonly string[]).includes("neq"), "there is no not-equals");
}

/** Seeding survives a stored row this UI predates. */
export function runSeedTests(): void {
  const stored: TemplateAlarm[] = [
    {
      code: "A",
      pointKey: "FLOW",
      operator: "lt",
      thresholdValue: 0,
      severity: "critical",
      message: "No flow.",
      philosophy: { cause: "Pump stopped." },
    },
  ];
  const [seeded] = alarmRowsFrom(stored);
  assert(seeded.operator === "lt", "the stored operator is kept");
  // The reason `String(...)` and not `?? ""`: `0 ?? ""` is `0`, a number
  // reaching a text input, and the round trip would then depend on React's
  // coercion rather than on this function.
  assert(seeded.thresholdValue === "0", `a stored zero seeds as "0" — got ${JSON.stringify(seeded.thresholdValue)}`);
  assert(seeded.cause === "Pump stopped.", "philosophy is flattened into the row");
  assert(seeded.impact === "", "an absent philosophy field seeds as empty text");
  assert(seeded.category === "", "an absent category seeds as empty text");

  assert(alarmRowsFrom(undefined).length === 0, "a template with no alarms section seeds no rows");

  const fresh = blankAlarmRow();
  assert(fresh.operator === "gt", "a new alarm defaults to above, as the rule builder does");
  assert(fresh.thresholdValue === "", "…with no threshold, which is a problem until set");
}

/**
 * A malformed stored entry renders instead of throwing.
 *
 * `content` is `z.record(z.unknown())` on the read side. Unit 9d found this
 * class as a live crash; the same guard is here for the same reason.
 */
export function runMalformedStoredEntryTests(): void {
  const junk = [
    {},
    { code: "A", philosophy: "not-an-object" },
    { code: "B", operator: "sideways", thresholdValue: "12", severity: 7 },
  ] as unknown as TemplateAlarm[];

  const rows = alarmRowsFrom(junk);
  assert(rows.length === 3, "every stored entry produces a row");
  assert(rows.every((entry) => typeof entry.thresholdValue === "string"), "the threshold is always text");
  assert(rows.every((entry) => typeof entry.cause === "string"), "philosophy fields are always text");
  // Rows 0 and 1 carry no `operator` key at all — ADR 0019 Amendment 2 made
  // that a legitimate authored state (a pair-absent alarm philosophy row), so
  // it now seeds as "" rather than a guessed default.
  assert(
    rows[0].operator === "" && rows[1].operator === "",
    `an absent operator seeds as empty, not a guessed default — got ${JSON.stringify([rows[0].operator, rows[1].operator])}`,
  );
  // Row 2's operator is DEFINED but garbled ("sideways" is not one of the
  // five) — that still falls back to a real one rather than binding the
  // <select> to a value it does not offer.
  assert(
    (ALARM_OPERATORS as readonly string[]).includes(rows[2].operator),
    "a garbled but present operator falls back to a real one rather than leaving the select unset",
  );
  // A string threshold in storage is not a number, so it does not survive — and
  // that is right: it would otherwise reach `.finite()` as a string.
  assert(rows[2].thresholdValue === "", "a non-number stored threshold reads as empty, then reports");
  assert(rows[2].severity === "", "a non-string severity reads as empty");

  assert(alarmFormErrors(rows, DECLARED, VOCAB).length > 0, "a malformed row is reported");
}

/** Codes, points, messages and the section cap. */
export function runFormErrorTests(): void {
  assert(alarmFormErrors([row()], DECLARED, VOCAB).length === 0, "a valid alarm has no problems");

  const blank = alarmFormErrors([row({ code: "", message: "  ", pointKey: "" })], DECLARED, VOCAB);
  assert(blank.some((problem) => problem.field === "code"), "a blank code is refused");
  assert(blank.some((problem) => problem.field === "message"), "a blank message is refused");
  assert(blank.some((problem) => problem.field === "pointKey"), "an unchosen point is refused");

  const duplicated = alarmFormErrors([row(), row({ message: "Other." })], DECLARED, VOCAB);
  assert(duplicated.length === 1, `one duplicate code is one problem — got ${duplicated.length}`);
  assert(duplicated[0].row === 1, "reported against the second occurrence");
  assert(
    duplicated[0].message.includes("alarm 1"),
    `the message names the alarm it collided with — got ${duplicated[0].message}`,
  );

  const stale = alarmFormErrors([row({ pointKey: "GONE" })], DECLARED, VOCAB);
  assert(
    stale.length === 1 && stale[0].message.includes("GONE"),
    `an undeclared point is named — got ${JSON.stringify(stale)}`,
  );

  const tooLong = alarmFormErrors(
    [row({ code: "c".repeat(65), message: "m".repeat(501), cause: "x".repeat(2001) })],
    DECLARED,
    VOCAB,
  );
  assert(tooLong.some((problem) => problem.field === "code"), "64 is the code cap");
  assert(tooLong.some((problem) => problem.field === "message"), "500 is the message cap");
  assert(tooLong.some((problem) => problem.field === "cause"), "2000 is the philosophy cap");

  const atCap = alarmFormErrors(
    [row({ code: "c".repeat(64), message: "m".repeat(500), cause: "x".repeat(2000) })],
    DECLARED,
    VOCAB,
  );
  assert(atCap.length === 0, `the caps are inclusive — got ${JSON.stringify(atCap)}`);

  const tooMany = alarmFormErrors(
    Array.from({ length: MAX_ALARM_ENTRIES + 1 }, (_, index) => row({ code: `A${index}` })),
    DECLARED,
    VOCAB,
  );
  assert(
    tooMany.some((problem) => problem.row === null && problem.field === "alarms"),
    "the section cap is reported against the section",
  );
}

/**
 * The three vocabularies, which are rows and not enums.
 *
 * ADR 0032 moved severity, ADR 0031 Amendment 1 moved category, ADR 0034 moved
 * skill. `templateAlarmSchema` checks shape only; the service closes each set.
 */
export function runVocabularyTests(): void {
  const badSeverity = alarmFormErrors([row({ severity: "urgent" })], DECLARED, VOCAB);
  assert(
    badSeverity.length === 1 && badSeverity[0].field === "severity",
    `a retired severity is refused — got ${JSON.stringify(badSeverity)}`,
  );

  const noSeverity = alarmFormErrors([row({ severity: "" })], DECLARED, VOCAB);
  assert(
    noSeverity.length === 1 && noSeverity[0].message.includes("Choose"),
    "severity is required, and an unchosen one says so rather than naming an empty code",
  );

  // Category and skill are optional — empty is valid, a wrong value is not.
  assert(alarmFormErrors([row({ category: "" })], DECLARED, VOCAB).length === 0, "no category is fine");
  assert(alarmFormErrors([row({ skill: "" })], DECLARED, VOCAB).length === 0, "no skill is fine");
  assert(
    alarmFormErrors([row({ category: "nonsense" })], DECLARED, VOCAB).length === 1,
    "a category outside the vocabulary is refused",
  );
  assert(
    alarmFormErrors([row({ skill: "nonsense" })], DECLARED, VOCAB).length === 1,
    "a skill outside the vocabulary is refused",
  );
  assert(
    alarmFormErrors([row({ category: "cooling", skill: "mechanical" })], DECLARED, VOCAB).length === 0,
    "live codes are accepted",
  );
}

/** A change is what would be sent. */
export function runChangeDetectionTests(): void {
  const stored: TemplateAlarm[] = [
    {
      code: "SUPPLY_HIGH",
      pointKey: "CHW_SUPPLY_T",
      operator: "gt",
      thresholdValue: 12,
      severity: "warning",
      message: "Chilled water supply is above target.",
    },
  ];
  const rows = alarmRowsFrom(stored);

  assert(!alarmsHaveChanged(rows, stored), "an untouched form has no changes");
  assert(
    !alarmsHaveChanged([{ ...rows[0], message: "Chilled water supply is above target. " }], stored),
    "a trailing space is trimmed before sending, so it is not a change",
  );
  assert(alarmsHaveChanged([{ ...rows[0], thresholdValue: "13" }], stored), "a new threshold is a change");
  assert(
    alarmsHaveChanged([{ ...rows[0], cause: "Fouled condenser." }], stored),
    "adding philosophy is a change — it creates the object that was omitted",
  );
  assert(alarmsHaveChanged([], stored), "removing the last alarm is a change");
  assert(!alarmsHaveChanged([], undefined), "no rows and no stored section is no change");
}

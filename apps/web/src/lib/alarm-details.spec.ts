import type { AlarmSkillDto } from "@bms/shared";

import {
  alarmSkillLabel,
  formatThresholdPairing,
  operatorSymbol,
  toLocalDateTimeInputValue,
} from "./alarm-details";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * `automationRuleOperatorSchema` is a real `z.enum(["gt","gte","lt","lte","eq"])`
 * — closed, unlike `severity`/`skill` — so `operatorSymbol` is the AGENTS.md
 * §4.8 exhaustive-`switch` case, not the open-vocabulary one.
 */
export function runOperatorSymbolTests(): void {
  assert(operatorSymbol("gt") === ">", "gt must render as >");
  assert(operatorSymbol("gte") === "≥", "gte must render as ≥");
  assert(operatorSymbol("lt") === "<", "lt must render as <");
  assert(operatorSymbol("lte") === "≤", "lte must render as ≤");
  assert(operatorSymbol("eq") === "=", "eq must render as =");
}

export function runFormatThresholdPairingTests(): void {
  const pairing = formatThresholdPairing({
    currentValue: 112,
    currentValueUnit: "%",
    thresholdOperator: "gt",
    thresholdValue: 100,
  });
  assert(pairing !== null, "a complete threshold block must produce a pairing");
  assert(pairing?.current === "112%", `expected "112%", got "${pairing?.current}"`);
  assert(pairing?.threshold === ">100%", `expected ">100%", got "${pairing?.threshold}"`);

  // ADR 0034 decision 5: the three fields are null together when the alarm
  // has no linked rule. A null block must not render "undefinedundefined".
  const noRule = formatThresholdPairing({
    currentValue: null,
    currentValueUnit: null,
    thresholdOperator: null,
    thresholdValue: null,
  });
  assert(noRule === null, `a null threshold block must yield no pairing, got ${JSON.stringify(noRule)}`);

  const noUnit = formatThresholdPairing({
    currentValue: 42,
    currentValueUnit: null,
    thresholdOperator: "lte",
    thresholdValue: 50,
  });
  assert(
    noUnit?.current === "42" && noUnit.threshold === "≤50",
    `a missing unit must not render as the literal string "null", got ${JSON.stringify(noUnit)}`,
  );
}

/**
 * Code review finding: the panel used to slice a UTC ISO string directly
 * (`etrAt.slice(0, 16)`) into a `datetime-local` input, which renders the
 * given digits as LOCAL time — reading UTC wall-clock digits as if they were
 * local. Round-tripped through a real local `Date` rather than asserted
 * against a fixed string, so this test does not itself depend on the
 * machine's timezone: whatever zone it runs in, converting a local moment to
 * UTC and back must recover the same local digits.
 */
export function runToLocalDateTimeInputValueTests(): void {
  const local = new Date(2026, 7, 19, 20, 30); // 19 Aug 2026, 20:30, local time
  const iso = local.toISOString();
  const result = toLocalDateTimeInputValue(iso);
  assert(
    result === "2026-08-19T20:30",
    `expected the local wall-clock time back ("2026-08-19T20:30"), got "${result}" (iso was ${iso})`,
  );
}

const SKILLS: AlarmSkillDto[] = [
  { code: "electrical", label: "Electrical", sortOrder: 10, active: true },
  { code: "hvac", label: "HVAC", sortOrder: 30, active: true },
];

export function runAlarmSkillLabelTests(): void {
  assert(alarmSkillLabel("hvac", SKILLS) === "HVAC", "a known code must resolve to its label");
  assert(alarmSkillLabel(null, SKILLS) === null, "a null code must resolve to null, not a placeholder string");
  // Never a hardcoded skill list: an unrecognised code (retired, or a client
  // holding a stale vocabulary) falls back to the raw code rather than
  // vanishing — the same posture `alarmSeverityTone` takes for an unknown tone.
  assert(
    alarmSkillLabel("plumbing", SKILLS) === "plumbing",
    "an unrecognised code must fall back to itself, not silently disappear",
  );
}

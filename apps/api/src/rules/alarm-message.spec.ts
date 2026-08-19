import { composeAlarmMessage, type AlarmMessageRule } from "./alarm-message";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function rule(overrides: Partial<AlarmMessageRule> = {}): AlarmMessageRule {
  return {
    name: "Feeder overload",
    pointKey: "kw",
    alarmMessage: null,
    unit: null,
    ...overrides,
  };
}

/**
 * The three `0022` markers, asserted against their exact current strings.
 * `F3.6` moved this logic out of `AlarmThresholdService` (renamed `AlarmEngineService`); these are the
 * regression guard proving the move changed nothing an operator sees.
 */
function testMigration0022Markers(): void {
  assert(
    composeAlarmMessage(
      rule({ alarmMessage: "voltage_l1_critical", pointKey: "voltage_l1_v", unit: "V" }),
      241.2,
    ) === "L1 voltage critically high (241.2 V)",
    "voltage_l1_critical must render the exact pre-merge string",
  );

  assert(
    composeAlarmMessage(
      rule({ alarmMessage: "voltage_l1_high", pointKey: "voltage_l1_v", unit: "V" }),
      238.4,
    ) === "L1 voltage above nominal envelope (238.4 V)",
    "voltage_l1_high must render the exact pre-merge string",
  );

  // breaker_main_open carries no unit and never renders a value — the message
  // is a fixed string regardless of `value` or `rule.unit`.
  assert(
    composeAlarmMessage(
      rule({ alarmMessage: "breaker_main_open", pointKey: "breaker_main", unit: null }),
      0,
    ) === "Main breaker reported OPEN",
    "breaker_main_open must render the exact pre-merge string",
  );
}

/**
 * The unit comes from `rule.unit` (`condition.unit`), never from guessing at
 * `pointKey`. A rule on `kw` with no `condition.unit` at all must not invent
 * "kW" — that guess is exactly what this function replaces.
 */
function testUnitFromCondition(): void {
  assert(
    composeAlarmMessage(rule({ pointKey: "kw", unit: "kW" }), 118) ===
      "Asset demand high (118 kW)",
    "kw with condition.unit='kW' must render the unit",
  );

  assert(
    composeAlarmMessage(rule({ pointKey: "kw", unit: null }), 118) === "Asset demand high (118)",
    "kw with no condition.unit must render no unit, not a guessed 'kW'",
  );

  // A differently-unitted point on the same pointKey pattern must render
  // whatever the condition actually says, not a hardcoded string.
  assert(
    composeAlarmMessage(rule({ pointKey: "kw", unit: "MW" }), 3) === "Asset demand high (3 MW)",
    "the unit must come from the condition, not a hardcoded guess",
  );
}

function testPowerFactorAndFallback(): void {
  assert(
    composeAlarmMessage(rule({ pointKey: "pf", unit: null }), 0.79) === "Power factor low (0.79)",
    "pf renders without a unit, matching pre-merge behaviour (dimensionless)",
  );

  // An unrecognised marker AND an unrecognised pointKey — the generic
  // fallback, never empty and never a misleading fixed string.
  assert(
    composeAlarmMessage(
      rule({ name: "Chiller supply temp high", pointKey: "supply_temp_c", alarmMessage: null }),
      31.5,
    ) === "Chiller supply temp high matched at 31.5",
    "an unrecognised rule falls through to a generic, non-empty message",
  );
}

/**
 * `F3.6` task 4 deleted `AlarmThresholdService.evaluateEskomLegacyRules` — the
 * hardcoded ladder migration `0033` reseeds as data. These five strings are
 * copied verbatim from that function's own template literals *before* its
 * deletion, at the exact boundary values it used, so this test pins what an
 * operator actually saw rather than re-deriving the expectation from
 * `composeAlarmMessage` itself (which would only prove the function agrees
 * with itself). The rule shapes on the right are what migration `0033`
 * actually seeds — `alarmMessage`/`unit`/`pointKey` — not a description of
 * them.
 */
function testEskomLegacyLadderParity(): void {
  assert(
    composeAlarmMessage(
      rule({ alarmMessage: "voltage_l1_critical", pointKey: "voltage_l1_v", unit: "V" }),
      239.5,
    ) === "L1 voltage critically high (239.5 V)",
    "seeded voltage-critical rule must match evaluateEskomLegacyRules' exact " +
      "`L1 voltage critically high (${value.toFixed(1)} V)` at its own boundary, 239.5",
  );

  assert(
    composeAlarmMessage(
      rule({ alarmMessage: "voltage_l1_high", pointKey: "voltage_l1_v", unit: "V" }),
      237,
    ) === "L1 voltage above nominal envelope (237.0 V)",
    "seeded voltage-warning rule must match evaluateEskomLegacyRules' exact " +
      "`L1 voltage above nominal envelope (${value.toFixed(1)} V)` at its own boundary, 237",
  );

  assert(
    composeAlarmMessage(
      rule({ alarmMessage: "breaker_main_open", pointKey: "breaker_main", unit: null }),
      0.4,
    ) === "Main breaker reported OPEN",
    "seeded breaker rule must match evaluateEskomLegacyRules' exact fixed string",
  );

  // Migration 0033 carries no alarmMessage marker for kw/pf — same as the
  // pre-existing demand_ceiling_notify rule — so these two exercise the
  // pointKey fallback branches, not the marker branches.
  assert(
    composeAlarmMessage(rule({ alarmMessage: null, pointKey: "kw", unit: "kW" }), 115) ===
      "Asset demand high (115 kW)",
    "seeded demand-high rule must match evaluateEskomLegacyRules' exact " +
      "`Asset demand high (${value.toFixed(0)} kW)` at its own boundary, 115",
  );

  assert(
    composeAlarmMessage(rule({ alarmMessage: null, pointKey: "pf", unit: null }), 0.81) ===
      "Power factor low (0.81)",
    "seeded power-factor rule must match evaluateEskomLegacyRules' exact " +
      "`Power factor low (${value.toFixed(2)})` just under its own boundary, 0.81",
  );
}

/** Assertions for `composeAlarmMessage` (F3.6, extracted from `AlarmThresholdService`, renamed `AlarmEngineService`). */
export function runAlarmMessageTests(): void {
  testMigration0022Markers();
  testUnitFromCondition();
  testPowerFactorAndFallback();
  testEskomLegacyLadderParity();
}

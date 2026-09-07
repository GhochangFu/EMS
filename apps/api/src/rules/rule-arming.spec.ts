import { BadRequestException } from "@nestjs/common";

import { ruleRow } from "./rule-mapping.spec";
import { assertArmable } from "./rule-arming";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** Runs `assertArmable` and hands back the message, or `null` when it allowed. */
function refusal(row: Parameters<typeof assertArmable>[0]): string | null {
  try {
    assertArmable(row);
    return null;
  } catch (err) {
    if (!(err instanceof BadRequestException)) {
      throw new Error(`expected a BadRequestException, got ${String(err)}`);
    }
    return err.message;
  }
}

/**
 * Assertions for the arming guard (ADR 0058 decision 3, ADR 0014 §4.6).
 *
 * `E2.4` seeds a philosophy row as `rule_type = 'threshold'` with a NULL
 * operator and a NULL threshold, so the row is armable *in principle* and the
 * toggle is the one place that has to say no. The four cases below are the
 * whole truth table the guard implements; the fifth pins the code into the
 * message, because an operator looking at a Rule Engine list of philosophy rows
 * needs the 400 to say which one it refused.
 *
 * `setEnabled`'s wiring — that the guard is actually called, on a real row,
 * behind a real 400 — is **not** provable here: `setEnabled` needs
 * `fleetDb.transaction` plus `withTenant`, which no fake in this module carries.
 * That proof lives in `U4`'s instantiate integration suite, which commissions a
 * seeded philosophy row with one PATCH.
 */
export function runRuleArmingTests(): void {
  const nullOperator = refusal(ruleRow({ operator: null }));
  assert(
    nullOperator !== null,
    "a threshold rule with a null operator must be refused (ADR 0058 decision 3)",
  );

  const nullThreshold = refusal(ruleRow({ thresholdValue: null }));
  assert(
    nullThreshold !== null,
    "a threshold rule with a null threshold value must be refused (ADR 0058 decision 3)",
  );

  // A seeded philosophy row is BOTH null, which is the shape the guard exists
  // for; the two single-null cases above are the halves it must also catch.
  const bothNull = refusal(ruleRow({ operator: null, thresholdValue: null }));
  assert(bothNull !== null, "a threshold rule with neither operator nor threshold must be refused");

  assert(
    refusal(ruleRow()) === null,
    "a threshold rule carrying both an operator and a threshold must be armable",
  );

  // Not a blanket "any null operator is refused": a time-window rule legitimately
  // has neither, and `validateRuleDraft` stores both as null for it
  // (`rules.service.ts`, the non-threshold branch). Refusing to enable one would
  // break every existing time-window rule, which is why the guard keys on
  // `ruleType` rather than on the two columns alone.
  assert(
    refusal(ruleRow({ ruleType: "time_window", operator: null, thresholdValue: null })) === null,
    "a time-window rule with no operator or threshold must still be enableable",
  );

  const named = refusal(ruleRow({ code: "CR_BATT_1_TEMP_WARNING", operator: null }));
  assert(
    named !== null && named.includes("CR_BATT_1_TEMP_WARNING"),
    `the refusal must name the rule's code, got ${String(named)}`,
  );
}

import { describe, it } from "vitest";

import {
  assertAcceptsEmptyWaterBalanceRoles,
  assertAcceptsWaterBalanceRoleRow,
  assertAlarmSeverityCountAllowsZero,
  assertAlarmSeverityCountRefusesNegative,
  assertRefusesResponseWithoutWaterBalanceRoles,
  assertRequiresSwitchingStates,
} from "./operations.spec";

/**
 * `E4.3` — vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014).
 */
describe("vocabulariesResponseSchema — waterBalanceRoles (ADR 0073 decision 1)", () => {
  it("refuses a response with no waterBalanceRoles field", () => {
    assertRefusesResponseWithoutWaterBalanceRoles();
  });

  it("accepts an empty waterBalanceRoles array", () => {
    assertAcceptsEmptyWaterBalanceRoles();
  });

  it("accepts a well-formed waterBalanceRoles row", () => {
    assertAcceptsWaterBalanceRoleRow();
  });
});

describe("vocabulariesResponseSchema — switchingStates (F4.309, ADR 0088 Amendment 3 decision 5)", () => {
  it("requires switchingStates and parses a well-formed row", () => {
    assertRequiresSwitchingStates();
  });
});

describe("alarmSeverityCountSchema (F3.28, ADR 0074 decision 3)", () => {
  it("allows a zero count — every active severity is represented", () => {
    assertAlarmSeverityCountAllowsZero();
  });

  it("refuses a negative count", () => {
    assertAlarmSeverityCountRefusesNegative();
  });
});

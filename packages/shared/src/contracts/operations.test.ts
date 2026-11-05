import { describe, it } from "vitest";

import {
  assertAcceptsEmptyWaterBalanceRoles,
  assertAcceptsWaterBalanceRoleRow,
  assertAlarmSeverityCountAllowsZero,
  assertAlarmSeverityCountRefusesNegative,
  assertRefusesResponseWithoutWaterBalanceRoles,
  assertRequiresSwitchingStates,
} from "./operations.spec";
import * as spec from "./operations.spec";

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

describe("alarm schemas name the asset's RTU and location (F4.316 PR 2, ADR 0111)", () => {
  it("alarmListItemSchema refuses a row with no assetRtuName", () => spec.assertAlarmListItemRequiresAssetRtuName());
  it("alarmListItemSchema refuses a row with no assetLocationName", () => spec.assertAlarmListItemRequiresAssetLocationName());
  it("alarmListItemSchema accepts null RTU and location names", () => spec.assertAlarmListItemAcceptsNullParts());
  it("alarmSocketEventSchema refuses an alarm with no assetRtuName", () => spec.assertAlarmSocketEventRequiresAssetRtuName());
  it("alarmDetailsResponseSchema refuses a response with no assetRtuName", () => spec.assertAlarmDetailsRequiresAssetRtuName());
  it("alarmDetailsResponseSchema refuses a response with no assetLocationName", () => spec.assertAlarmDetailsRequiresAssetLocationName());
  it("alarmDetailsResponseSchema accepts null RTU and location names", () => spec.assertAlarmDetailsAcceptsNullParts());
  it("alarmAffectedAssetDtoSchema refuses a row with no assetRtuName", () => spec.assertAffectedAssetRequiresAssetRtuName());
  it("alarmAffectedAssetDtoSchema refuses a row with no assetLocationName", () => spec.assertAffectedAssetRequiresAssetLocationName());
  it("alarmAffectedAssetDtoSchema accepts null RTU and location names", () => spec.assertAffectedAssetAcceptsNullParts());
});

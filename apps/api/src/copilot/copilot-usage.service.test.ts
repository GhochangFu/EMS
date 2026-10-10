import { describe, it } from "vitest";

import {
  aNonUtcMidnightSplitsTheOrganizationDay,
  anUnknownStoredZoneCountsInUtc,
  crossOrganizationTurnTouchesTheUserCounterOnly,
  dayKeysAndMidnights,
  globalAdminCountsInUtcAgainstABoundKolkataOrganization,
  limitsFallBackToTheDefaultNeverZero,
  oneUserTwoOrganizationsShareTheUserLimit,
  organizationRefusalRollsBackTheUserIncrement,
  theModuleProvidesAndExportsTheService,
  turn150AllowedAnd151Refused,
  userDayAndOrganizationDayDifferInOneTurn,
} from "./copilot-usage.service.spec";

describe("F3.85 — CopilotUsageService.consumeTurn (ADR 0099 decision 11, Amendment 1 A1, A2)", () => {
  it("turn150AllowedAnd151Refused", async () => {
    await turn150AllowedAnd151Refused();
  });
  it("oneUserTwoOrganizationsShareTheUserLimit", async () => {
    await oneUserTwoOrganizationsShareTheUserLimit();
  });
  it("crossOrganizationTurnTouchesTheUserCounterOnly", async () => {
    await crossOrganizationTurnTouchesTheUserCounterOnly();
  });
  it("organizationRefusalRollsBackTheUserIncrement", async () => {
    await organizationRefusalRollsBackTheUserIncrement();
  });
  it("aNonUtcMidnightSplitsTheOrganizationDay", async () => {
    await aNonUtcMidnightSplitsTheOrganizationDay();
  });
  it("userDayAndOrganizationDayDifferInOneTurn", async () => {
    await userDayAndOrganizationDayDifferInOneTurn();
  });
  it("globalAdminCountsInUtcAgainstABoundKolkataOrganization", async () => {
    await globalAdminCountsInUtcAgainstABoundKolkataOrganization();
  });
  it("anUnknownStoredZoneCountsInUtc", async () => {
    await anUnknownStoredZoneCountsInUtc();
  });
  it("dayKeysAndMidnights", () => {
    dayKeysAndMidnights();
  });
  it("limitsFallBackToTheDefaultNeverZero", () => {
    limitsFallBackToTheDefaultNeverZero();
  });
  it("theModuleProvidesAndExportsTheService", () => {
    theModuleProvidesAndExportsTheService();
  });
});

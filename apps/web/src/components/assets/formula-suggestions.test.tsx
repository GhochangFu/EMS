// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  a403OnTheListStillListsStock,
  aDisabledListGivesItsReason,
  anEnabledListGivesNoReason,
  disabledDisablesUse,
  everyReadFailingRendersNothing,
  listsTheStockFormula,
  listsThePublishedVersionsFormula,
  marksTheMissingInput,
  noKeyReadsNoVersionFromAWarmList,
  noOrganizationReadsNoList,
  readsNoDraftVersion,
  theListIsReadWithoutAnOrganization,
  useHandsFormulaDialectAndTiming,
} from "./formula-suggestions.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 * `@vitest-environment jsdom` is on this file because Vitest reads it from
 * the file it collects (ADR 0042 decision 2).
 */
describe("F4.314 PR 2 — Suggested formulas", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("lists the stock catalog's formula for the key", async () => {
    await listsTheStockFormula();
  });

  it("lists the organization's published version's formula", async () => {
    await listsThePublishedVersionsFormula();
  });

  it("never reads a draft version", async () => {
    await readsNoDraftVersion();
  });

  it("names the input the asset does not have", async () => {
    await marksTheMissingInput();
  });

  it("Use this formula hands the formula, dialect and timing to onTake", async () => {
    await useHandsFormulaDialectAndTiming();
  });

  it("a 403 on the published list still lists the stock entries", async () => {
    await a403OnTheListStillListsStock();
  });

  it("reads the published list without an organizationId", async () => {
    await theListIsReadWithoutAnOrganization();
  });

  it("reads no list without an organization", async () => {
    await noOrganizationReadsNoList();
  });

  it("renders nothing when every read fails", async () => {
    await everyReadFailingRendersNothing();
  });

  it("disabled disables Use this formula", async () => {
    await disabledDisablesUse();
  });

  it("a disabled list gives its reason", async () => {
    await aDisabledListGivesItsReason();
  });

  it("an enabled list gives no reason", async () => {
    await anEnabledListGivesNoReason();
  });

  it("reads no version without a key, even from a warm published-list cache", async () => {
    await noKeyReadsNoVersionFromAWarmList();
  });
});

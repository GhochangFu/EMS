import { describe, it } from "vitest";

import {
  assertACsvLabelLedByAFormulaLeaderIsGuarded,
  assertASheetLabelLedByAFormulaLeaderIsVerbatim,
  assertChangeReadsTheUnroundedValues,
  assertConsumerHeaderAddsAssetAfterAssetCode,
  assertConsumerRowCarriesTheRtuLabel,
  assertConsumerWithNoRtuIsLabelledByItsLocation,
  assertCsvDocumentTakesOneParameter,
  assertHeadBlockGainsThePreviousPeriodRow,
  assertMetricBlockGainsPreviousAndChange,
  assertNullCostRendersTheDash,
  assertNullCurrentPueIsTheDash,
  assertNullPreviousPueIsTheDash,
  assertSheetRowsCarryThePreviousPeriod,
  assertSourceBlockGainsPreviousAndChange,
  assertTableWithoutPreviousIsToday,
  assertTopConsumersBlockIsUnchanged,
  assertZeroPreviousIsNoData,
  runReportsSerialiseTests,
  runReportsSheetTests,
} from "./reports.serialise.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("energy report serialise (ADR 0026)", () => {
  it("guards the three untrusted cells without touching numbers or benign data", () => {
    runReportsSerialiseTests();
  });

  it("shapes the xlsx rows unguarded, keeps numbers numeric, and mirrors the CSV layout", () => {
    runReportsSheetTests();
  });

  it("E4.1c — writes the em dash and an empty unit for a null cost, the currency code otherwise", () => {
    assertNullCostRendersTheDash();
  });

  describe("F4.303 — compare on the energy report (ADR 0108 Amendment 6 item 8)", () => {
    it("T1 — energyTable(preview) with no previous period is today's array", () => {
      assertTableWithoutPreviousIsToday();
    });

    it("T2 — the head block gains the Previous period row after End date", () => {
      assertHeadBlockGainsThePreviousPeriodRow();
    });

    it("T2 — the metric block gains Previous and Change on every row", () => {
      assertMetricBlockGainsPreviousAndChange();
    });

    it("T2 — the change reads the unrounded values (120.4 against 100 is 20.4)", () => {
      assertChangeReadsTheUnroundedValues();
    });

    it("T2 — the source block gains Previous and Change", () => {
      assertSourceBlockGainsPreviousAndChange();
    });

    it("T2 — the top-consumers block is unchanged by a previous period", () => {
      assertTopConsumersBlockIsUnchanged();
    });

    it("T3 — a previous of 0 reads no data for the previous period", () => {
      assertZeroPreviousIsNoData();
    });

    it("T4 — a null previous PUE writes the em dash in both new cells", () => {
      assertNullPreviousPueIsTheDash();
    });

    it("T4 — a null current PUE writes the em dash as the value and the change", () => {
      assertNullCurrentPueIsTheDash();
    });

    it("T5 — energySheetRows(preview, previous) is energyTable's rows", () => {
      assertSheetRowsCarryThePreviousPeriod();
    });

    it("T6 — energyCsvDocument takes the preview only", () => {
      assertCsvDocumentTakesOneParameter();
    });
  });

  describe("F4.316 PR 6 — the top consumers carry the asset label (ADR 0111 decision 4)", () => {
    it("L1 — the header keeps Asset code and adds Asset after it", () => {
      assertConsumerHeaderAddsAssetAfterAssetCode();
    });

    it("L2 — a consumer under an RTU is labelled <code> · <RTU>", () => {
      assertConsumerRowCarriesTheRtuLabel();
    });

    it("L3 — a consumer with no RTU is labelled <code> · <location>", () => {
      assertConsumerWithNoRtuIsLabelledByItsLocation();
    });

    it("L4 — a CSV label led by = is apostrophe-guarded", () => {
      assertACsvLabelLedByAFormulaLeaderIsGuarded();
    });

    it("L5 — a sheet label led by = arrives verbatim (no <f> is written)", () => {
      assertASheetLabelLedByAFormulaLeaderIsVerbatim();
    });
  });
});

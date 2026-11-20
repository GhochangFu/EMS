// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  aControlledMonthIsReadAndDrawsNoSelector,
  aTitleNamesTheCard,
  aBilledMonthShowsUnitsSlabLinesChargesAndTotal,
  aCompleteMonthDoesNotSayMonthToDate,
  aFailedMonthKeepsTheSelector,
  aFailedReadIsAFixedSentence,
  aKvahBillNamesItsUnitType,
  aMissingMeterSaysHowManyReported,
  aNonHttpSourceUrlIsNotALink,
  aNonOfficialTariffShowsTheVerifyBadge,
  allMetersReportedSaysNoMissing,
  anEstimatedBillSaysEstimated,
  anIncompleteMonthSaysMonthToDate,
  anOfficialTariffShowsNoVerifyBadge,
  choosingAMonthRefetchesThatMonth,
  eachOtherReasonShowsItsOwnSentence,
  noMappingRendersNothing,
  noOverflowShowsNoWarning,
  oneMeterSaysNoCount,
  overflowUnitsShowTheLastSlabWarning,
  severalMetersSayHowMany,
  theSelectorOffersTheCurrentMonthAnd24Back,
  theSelectorStaysWhileTheNextMonthLoads,
  theTariffNameStateDateAndSafeSourceLinkShow,
} from "./monthly-bill-card.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, ADR 0042 decision 2). */
describe("F4.365 the monthly bill card", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows units, slab lines, energy, fixed, wheeling and the total, with the footnote", async () => {
    await aBilledMonthShowsUnitsSlabLinesChargesAndTotal();
  });

  it("names kVAh when the bill is in kVAh", async () => {
    await aKvahBillNamesItsUnitType();
  });

  it("shows the tariff name, state, effective date and a noopener source link", async () => {
    await theTariffNameStateDateAndSafeSourceLinkShow();
  });

  it("does not link a non-http source URL", async () => {
    await aNonHttpSourceUrlIsNotALink();
  });

  it("says Month to date for an incomplete month", async () => {
    await anIncompleteMonthSaysMonthToDate();
  });

  it("does not say Month to date for a complete month", async () => {
    await aCompleteMonthDoesNotSayMonthToDate();
  });

  it("shows the Verify badge for a non-official tariff", async () => {
    await aNonOfficialTariffShowsTheVerifyBadge();
  });

  it("shows no Verify badge for an official tariff", async () => {
    await anOfficialTariffShowsNoVerifyBadge();
  });

  it("says Estimated for an estimated bill", async () => {
    await anEstimatedBillSaysEstimated();
  });

  it("warns when units overflow the last slab", async () => {
    await overflowUnitsShowTheLastSlabWarning();
  });

  it("shows no overflow warning without overflow", async () => {
    await noOverflowShowsNoWarning();
  });

  it("renders nothing for no_mapping", async () => {
    await noMappingRendersNothing();
  });

  it("gives each other reason its own sentence and no figures", async () => {
    await eachOtherReasonShowsItsOwnSentence();
  });

  it("offers the current month and 24 back, never a future one", async () => {
    await theSelectorOffersTheCurrentMonthAnd24Back();
  });

  it("refetches the chosen month", async () => {
    await choosingAMonthRefetchesThatMonth();
  });

  it("shows a fixed sentence when the read fails", async () => {
    await aFailedReadIsAFixedSentence();
  });

  it("keeps the previous bill and the selector while the next month loads", async () => {
    await theSelectorStaysWhileTheNextMonthLoads();
  });

  it("keeps the selector when a chosen month fails, so the reader can go back", async () => {
    await aFailedMonthKeepsTheSelector();
  });

  it("F4.373: says N meters when several meters make the bill", async () => {
    await severalMetersSayHowMany();
  });

  it("F4.373: says no meter count for a one-meter bill", async () => {
    await oneMeterSaysNoCount();
  });

  it("F4.374: says 1 of 2 meters reported when a meter is left out", async () => {
    await aMissingMeterSaysHowManyReported();
  });

  it("F4.374: says N meters, not 'reported', when every meter reported", async () => {
    await allMetersReportedSaysNoMissing();
  });

  it("F4.240 MB-C1 a controlled month is read and draws no selector", async () => {
    await aControlledMonthIsReadAndDrawsNoSelector();
  });

  it("F4.240 MB-C2 a title names the card", async () => {
    await aTitleNamesTheCard();
  });
});

import { describe, it } from "vitest";

import * as spec from "./report-render-compare.spec";

/** `F4.303` — compare on a scheduled energy render. Assertions live in the sibling `.spec.ts` (§4.6). */
describe("F4.303 ReportRenderService — compare on the energy report (ADR 0108 Amendment 6 item 8)", () => {
  it("compare passes the previous cadence period to energyPdf", spec.assertComparePassesThePreviousPeriodToThePdf);
  it("compare passes the previous cadence period to energyXlsx", spec.assertComparePassesThePreviousPeriodToTheXlsx);
  it("params NULL renders with no third argument", spec.assertNullParamsRendersWithoutAThirdArgument);
  it("compare false renders with no third argument", spec.assertCompareFalseRendersWithoutAThirdArgument);
  it("the outcome carries the template, the params and the previous period", spec.assertTheOutcomeCarriesTheCompare);
  it("an unknown stored template_id throws before any put or row", spec.assertUnknownTemplateThrowsBeforeAnyPut);
  it("stored params outside the contract throw before any put or row", spec.assertMalformedParamsThrowBeforeAnyPut);
  it("the default stored row puts both files (the positive control)", spec.assertTheDefaultRowPutsBothFiles);
  it("with compare the mail carries Previous period: N kWh after the summary", spec.assertCompareMailCarriesThePreviousPeriodLine);
  it("with compare the mail reads the period's and the previous period's previews", spec.assertCompareMailReadsTwoPreviews);
  it("without compare the mail reads one preview and has no previous-period line", spec.assertNoCompareMailIsToday);
});

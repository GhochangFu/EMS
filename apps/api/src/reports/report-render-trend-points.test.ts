import { describe, it } from "vitest";

import * as spec from "./report-render-trend-points.spec";

/** `F4.303` U13 — the render's `trend_points` branch. Assertions live in the sibling `.spec.ts` (§4.6). */
describe("F4.303 ReportRenderService — the trend_points render (ADR 0108 Amendment 6 item 8)", () => {
  it("the plan receives the schedule's zone, period, params and asset ids", spec.assertThePlanReceivesTheSchedule);
  it("the energy renderers are never called", spec.assertTheEnergyRenderersAreNeverCalled);
  it("one read serves both formats", spec.assertOneReadServesBothFormats);
  it("a retry with both files stored reads no telemetry", spec.assertARetryWithBothFilesReadsNoTelemetry);
  it("the filenames name the template", spec.assertTheFilenamesNameTheTemplate);
  it("the rows carry template_id trend_points", spec.assertTheRowsCarryTheTemplate);
  it("the outcome carries the summary for the mail", spec.assertTheOutcomeCarriesTheSummary);
  it("an energy schedule never plans points (positive control)", spec.assertAnEnergyScheduleNeverPlansPoints);
  it("a trend row without points throws before any put", spec.assertATrendRowWithoutPointsThrowsBeforeAnyPut);
  it("the trend mail body is the points, the level and the history line", spec.assertTheTrendMailBody);
});

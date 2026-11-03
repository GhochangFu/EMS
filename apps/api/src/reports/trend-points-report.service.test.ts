import { describe, it } from "vitest";

import * as spec from "./trend-points-report.service.spec";

/** `F4.303` U13 — `TrendPointsReportService`. Assertions live in the sibling `.spec.ts` (§4.6). */
describe("F4.303 TrendPointsReportService (ADR 0108 Amendment 6 item 8)", () => {
  it("a daily period reads the local day, 1440 minutes", spec.assertADailyPeriodReadsTheLocalDay);
  it("a daily period prints 1m", spec.assertADailyPeriodPrintsOneMinute);
  it("a weekly period prints 1h", spec.assertAWeeklyPeriodPrintsOneHour);
  it("a 30-day monthly period prints 1h", spec.assertAMonthlyPeriodPrintsOneHour);
  it("now reaches every read", spec.assertNowReachesEveryRead);
  it("compare true reaches every read", spec.assertCompareReachesEveryRead);
  it("compare false reaches every read", spec.assertNoCompareReachesEveryRead);
  it("an asset outside the schedule is dropped and named by code", spec.assertAnAssetOutsideTheScheduleIsDroppedByCode);
  it("a retired registration is dropped", spec.assertARetiredRegistrationIsDropped);
  it("an invisible asset is a deleted asset", spec.assertAnInvisibleAssetIsADeletedAsset);
  it("every point dropped still gives both files", spec.assertEveryPointDroppedStillGivesBothFiles);
  it("each select runs once per plan", spec.assertEachSelectRunsOncePerPlan);
  it("every read asks for avg buckets with stats", spec.assertEveryReadAsksForAverageBucketsWithStats);
  it("the kept points become tables", spec.assertTheKeptPointsBecomeTables);
  it("the workbook's one sheet is Points", spec.assertTheWorkbookSheetIsPoints);
  it("the workbook is deflated", spec.assertTheWorkbookIsDeflated);
});

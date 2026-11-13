import { describe, it } from "vitest";

import * as spec from "./alarm-bar.spec";

/** `F4.357` U3 — Vitest entry point. Assertions live in `alarm-bar.spec.ts` (ADR 0014). */
describe("alarm bar rules (F4.357, ADR 0130)", () => {
  it("the scope follows the page (decisions 5, 20)", () => spec.scopeFollowsThePage());
  it("each scope has its own key and read argument", () => spec.scopeKeysAndReadArguments());
  it("the list header names the scope; /control-room is the Estate (plan Q4)", () => spec.scopeLabels());
  it("the newest unacknowledged alarm prefers rank, then time (decision 2)", () => spec.newestUnacknowledgedPrefersRankThenTime());
  it("the counts sort by rank descending, an unseeded rank included", () => spec.countsSortByRankDescending());
  it("the location label is the alarm's own location (decision 17)", () => spec.locationLabelPrefersTheAlarmsOwnLocation());
  it("the popup rows: unacknowledged, rank >= 20, unseen, rank then newest, at most 50 (U6)", () =>
    spec.popupRowsFollowRankThenTimeAndSkipSeen());
  it("'and N more' is exact and never negative (U6, Q1)", () => spec.moreActiveCountIsExactAndNeverNegative());
  it("only unseen, unacknowledged alarms of rank >= 30 blink (U7)", () => spec.blinkingSeverityCodesAreUnseenCriticalOnly());
});

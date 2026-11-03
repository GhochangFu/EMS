// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import { useAuthStore } from "../../stores/auth-store";
import {
  aSegmentWithNoPointsSaysWhereToAddThem,
  aTrimmedChartNamesTheCap,
  anAssetGroupAdminSeesNoSchedule,
  scheduleOpensWithTheDrawnSeriesOnly,
  scheduleSitsAfterPinInTheSubTabsControlRow,
  anOperatorSeesNoPinOnASubTab,
  pinSendsTheDrawnSeriesAndTheUrlsPreset,
  pinSitsInTheSubTabsControlRow,
  thePointSelectorListsThePointsAndEmitsAChoice,
  theRollupLineNamesTheZone,
} from "./segment-view.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, ADR 0042 decision 2). */
describe("F4.302 one segment sub-tab", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    useAuthStore.setState({ user: null });
  });

  it("lists the segment's points and emits a choice", () => {
    thePointSelectorListsThePointsAndEmitsAChoice();
  });

  it("names the rollup level, the bucket and the site zone", () => {
    theRollupLineNamesTheZone();
  });

  it("points a segment with no listed point at Reference Data → Trend Points", () => {
    aSegmentWithNoPointsSaysWhereToAddThem();
  });

  it("names the chart cap when trimmed", () => {
    aTrimmedChartNamesTheCap();
  });

  it("F4.303 U15: puts Pin in the sub-tab's control row for an author", () => {
    pinSitsInTheSubTabsControlRow();
  });

  it("F4.303 U16: puts Schedule after Pin in the control row", () => {
    scheduleSitsAfterPinInTheSubTabsControlRow();
  });

  it("F4.303 U16: draws no Schedule for an asset-group admin", () => {
    anAssetGroupAdminSeesNoSchedule();
  });

  it("F4.303 U16: Schedule opens with the drawn series only", async () => {
    await scheduleOpensWithTheDrawnSeriesOnly();
  });

  it("F4.303 U15: draws no Pin for an operator", () => {
    anOperatorSeesNoPinOnASubTab();
  });

  it("F4.303 U15: Pin sends the drawn series, avg and the URL's preset length", async () => {
    await pinSendsTheDrawnSeriesAndTheUrlsPreset();
  });
});

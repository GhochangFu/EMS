import { describe, it } from "vitest";

import {
  runAggregateRequestListTests,
  runBucketedChartSeriesTests,
  runBucketedChartStalenessTests,
  runFooterOnlyChartAgesByItsSeriesTests,
  runTileCompareValueTests,
  runTileReadsItsOwnStatisticTests,
  runUnresolvedAggregateStaysReadableTests,
} from "./dashboard-widget-data-aggregate.spec";

/** `F3.35` Stage A — Vitest wrapper for the second data path (ADR 0014). */
describe("F3.35 Stage A — a bucketed chart's staleness", () => {
  it("ages by the point's last reading, not by a bucket start 55 s old", () => {
    runBucketedChartStalenessTests();
  });

  it("leaves a footer-only chart aging by its own raw series", () => {
    runFooterOnlyChartAgesByItsSeriesTests();
  });
});

describe("F3.35 Stage A — the second data path", () => {
  it("plots the endpoint's buckets, and leaves the raw path reading history", () => {
    runBucketedChartSeriesTests();
  });

  it("keeps a widget readable while its aggregate is still in flight", () => {
    runUnresolvedAggregateStaysReadableTests();
  });

  it("reads one statistic out of the four, and finds the mean under `average`", () => {
    runTileReadsItsOwnStatisticTests();
  });

  it("carries the preceding window's number, and null when none was asked for", () => {
    runTileCompareValueTests();
  });
});

describe("F3.35 Stage A — the aggregate request list", () => {
  it("deduplicates by request, not by widget, and asks for nothing when nothing aggregates", () => {
    runAggregateRequestListTests();
  });
});

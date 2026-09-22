import { describe, it } from "vitest";

import {
  aNullBesideACurrencyIsNull,
  allStaleIsNullNotZero,
  avgSkipsTheStaleRowButCountsIt,
  capRowsAtTheCapIsNotTruncated,
  capRowsFlagsThe201stRow,
  derivedWithoutIntervalUsesTheConstant,
  measuredBoundIsTheConstant,
  oneCurrencyIsTheCurrency,
  rollupOfNothingIsNullWithZeroCoverage,
  scheduledDerivedBoundIsThreeIntervals,
  sumCountsAFreshZero,
  twoCurrenciesAreNull,
} from "./sustainability-rollup.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E4.2 U4 — the sustainability roll-up's pure half", () => {
  it("rolls up nothing to null with 0/0 coverage", () => {
    rollupOfNothingIsNullWithZeroCoverage();
  });

  it("averages the fresh values and counts the stale row in carrying", () => {
    avgSkipsTheStaleRowButCountsIt();
  });

  it("sums a fresh zero as a value", () => {
    sumCountsAFreshZero();
  });

  it("answers null, never zero, when every carrying asset is stale", () => {
    allStaleIsNullNotZero();
  });

  it("returns the one currency", () => {
    oneCurrencyIsTheCurrency();
  });

  it("returns null for two currencies", () => {
    twoCurrenciesAreNull();
  });

  it("returns null when a null sits beside a currency", () => {
    aNullBesideACurrencyIsNull();
  });

  it("bounds a scheduled derived point at three intervals", () => {
    scheduledDerivedBoundIsThreeIntervals();
  });

  it("bounds a measured point at the exported 15-minute constant", () => {
    measuredBoundIsTheConstant();
  });

  it("bounds a derived point with no scheduled interval at the constant too", () => {
    derivedWithoutIntervalUsesTheConstant();
  });

  it("caps a dataset at MAX_DATASET_ROWS and flags the row past it", () => {
    capRowsFlagsThe201stRow();
  });

  it("does not flag a dataset of exactly MAX_DATASET_ROWS", () => {
    capRowsAtTheCapIsNotTruncated();
  });
});

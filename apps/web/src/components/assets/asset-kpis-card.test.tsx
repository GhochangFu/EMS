// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it } from "vitest";

import * as spec from "./asset-kpis-card.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and
 * the jsdom docblock is here because this is the file Vitest collects
 * (ADR 0042 decision 2).
 */
describe("F2.33 asset KPI card", () => {
  afterEach(() => {
    cleanup();
  });

  it("an ok item shows its value and no state sentence", () => spec.anOkItemShowsItsValueAndNoStateSentence());
  it("a stale item shows the dash, the stale sentence and the input time", () =>
    spec.aStaleItemShowsTheDashTheSentenceAndTheTime());
  it("a refused aggregate shows the excluded count", () => spec.aRefusedAggregateShowsTheExcludedCount());
  it("an unvalidated item shows its sentence and no member count", () => spec.anUnvalidatedItemShowsItsSentenceAndNoCount());
  it("no items says so under the KPIs heading", () => spec.noItemsSaysSo());
  it("items keep the template's declared order", () => spec.itemsKeepTheirOrder());
});

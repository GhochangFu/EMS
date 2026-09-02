// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  fullPairRendersAnEditableThresholdBox,
  pairAbsentRowRendersCommissioningCopyAndAnEmptyOperator,
} from "./alarms-tab.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 * `@vitest-environment jsdom` is on this file because Vitest reads it from
 * the file it collects (ADR 0042 decision 2).
 */
describe("F2.13 alarms tab — ADR 0019 Amendment 2", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders the commissioning copy and an unselected operator for a pair-absent row", async () => {
    await pairAbsentRowRendersCommissioningCopyAndAnEmptyOperator();
  });

  it("still renders an editable threshold box for a full pair", async () => {
    await fullPairRendersAnEditableThresholdBox();
  });
});

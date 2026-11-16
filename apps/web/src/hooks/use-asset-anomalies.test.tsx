// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it } from "vitest";

import {
  aFailedReadIsNoMarks,
  aFailedRefetchDropsTheMarks,
  cachedMarksAreHiddenOnceDisabled,
  disabledOrNoWindowAsksNothing,
  oneReadOverTheWholeHourWindow,
} from "./use-asset-anomalies.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
afterEach(() => {
  cleanup();
});

describe("E1.2b — useAssetAnomalies", () => {
  it("one read over the window in whole hours, re-polled every 15 minutes until a 403", () =>
    oneReadOverTheWholeHourWindow());
  it("disabled, or no window yet, asks nothing", () => disabledOrNoWindowAsksNothing());
  it("cached marks are hidden once the gate turns off", () => cachedMarksAreHiddenOnceDisabled());
  it("a failed first read, settled, is no marks", () => aFailedReadIsNoMarks());
  it("a failed refetch drops the marks", () => aFailedRefetchDropsTheMarks());
});

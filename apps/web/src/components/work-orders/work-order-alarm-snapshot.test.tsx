// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  aNullSnapshotRendersNothing,
  aNullValueReadsNotRecorded,
  noFormControlIsRendered,
  theFourValuesAreShown,
} from "./work-order-alarm-snapshot.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E3.1 the From the alarm snapshot (ADR 0122 decision 5a)", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows the four recorded values", () => {
    theFourValuesAreShown();
  });

  it("reads Not recorded for a null value", () => {
    aNullValueReadsNotRecorded();
  });

  it("renders no form control", () => {
    noFormControlIsRendered();
  });

  it("renders nothing without a snapshot", () => {
    aNullSnapshotRendersNothing();
  });
});

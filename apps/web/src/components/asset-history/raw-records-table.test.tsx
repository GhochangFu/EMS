// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import { aNullDeviceTimeIsADash, theLastPageOffersNoLoadOlder } from "./raw-records-table.spec";

/** Vitest entry point (ADR 0014, ADR 0042 decision 2). */
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("F4.297 raw records table", () => {
  it("shows a dash for a null device time", async () => {
    await aNullDeviceTimeIsADash();
  });

  it("offers no Load older on the last page", async () => {
    await theLastPageOffersNoLoadOlder();
  });
});

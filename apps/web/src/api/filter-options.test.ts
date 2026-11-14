import { afterEach, describe, it, vi } from "vitest";

import { aDriftedPayloadThrows, aRefusedReadThrows, readsTheOptionsPath } from "./filter-options.spec";

/** `F4.361` U6 — the filter-options web client. `node` environment, like `alarms.test.ts`. */
describe("F4.361 filter-options web client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  it("reads GET /api/v1/filter-options", () => readsTheOptionsPath());
  it("throws on a refused read", () => aRefusedReadThrows());
  it("throws on a payload that breaks the contract", () => aDriftedPayloadThrows());
});

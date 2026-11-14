import { afterEach, describe, it, vi } from "vitest";

import {
  aDriftedPayloadThrows,
  aNotFoundIsAnApiErrorWithItsStatus,
  aRefusedReadThrows,
  readsTheOptionsPath,
} from "./filter-options.spec";

/** `F4.361` U6 — the filter-options web client. `node` environment, like `alarms.test.ts`. */
describe("F4.361 filter-options web client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  it("reads GET /api/v1/filter-options", () => readsTheOptionsPath());
  it("throws on a refused read", () => aRefusedReadThrows());
  it("throws a 404 as an ApiError with its status, so it is not retried", () => aNotFoundIsAnApiErrorWithItsStatus());
  it("throws on a payload that breaks the contract", () => aDriftedPayloadThrows());
});

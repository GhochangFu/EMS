// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  aVersionWithoutBandsIsMarkedAndABandedOneIsNot,
  noVersionIsMarkedWhenEveryOneIsBanded,
} from "./asset-templates-page-health.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 * `@vitest-environment jsdom` is on this file because Vitest reads it from the
 * file it collects (ADR 0042 decision 2).
 */
describe("F4.355 B6 — the template list marks versions without health bands", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("marks a version with no health bands, and only that one", async () => {
    await aVersionWithoutBandsIsMarkedAndABandedOneIsNot();
  });

  it("marks nothing when every version is banded", async () => {
    await noVersionIsMarkedWhenEveryOneIsBanded();
  });
});

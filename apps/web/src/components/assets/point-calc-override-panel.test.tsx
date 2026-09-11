// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  busyDisablesEveryControl,
  grammarShowsInheritAndChoosingV2DisablesStreaming,
  saveIsDisabledWhileAProblemIsListed,
  theCoverageLineIsTheTemplatesAndReadOnly,
} from "./point-calc-override-panel.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 * `@vitest-environment jsdom` is on this file because Vitest reads it from
 * the file it collects (ADR 0042 decision 2).
 */
describe("F2.22 override panel — Grammar, the v2 trigger rule, the template's coverage ratio and the editor mirrors", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("opens Grammar on inherit, and choosing bms-calc-v2 disables streaming and teaches the reference forms", async () => {
    await grammarShowsInheritAndChoosingV2DisablesStreaming();
  });

  it("shows the template's coverage ratio read-only, with null as fail closed", async () => {
    await theCoverageLineIsTheTemplatesAndReadOnly();
  });

  it("disables Save while a problem is listed and enables it once the grammar clears it", async () => {
    await saveIsDisabledWhileAProblemIsListed();
  });

  it("disables every control, new and old, while a request is in flight", async () => {
    await busyDisablesEveryControl();
  });
});

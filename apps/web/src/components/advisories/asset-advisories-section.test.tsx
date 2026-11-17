// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import { aFailedReadDrawsNothing, noAdvisoryDrawsNothing, oneAdvisoryShowsItsCard } from "./asset-advisories-section.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("E1.6b — the asset history advisories section", () => {
  it("one advisory shows its card under the heading, without the asset link", () => oneAdvisoryShowsItsCard());
  it("no advisory draws nothing", () => noAdvisoryDrawsNothing());
  it("a failed read draws nothing, once its retries are spent", () => aFailedReadDrawsNothing(), 10_000);
});

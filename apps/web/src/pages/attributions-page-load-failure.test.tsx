// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import { aFailedCreditsLoadShowsTheAlert } from "./attributions-page-load-failure.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014); jsdom opts in here (ADR 0042). */
describe("F3.32h the attributions page when a lazy chunk does not load", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("T17 a failed credits load shows the alert", async () => {
    await aFailedCreditsLoadShowsTheAlert();
  });
});

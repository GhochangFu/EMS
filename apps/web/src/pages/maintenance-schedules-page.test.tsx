// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import { anAdminSeesTheDock, anOperatorGetsTheStepperAndNoDock } from "./maintenance-schedules-page.spec";

/** `F4.281` — Vitest entry point; assertions live in the sibling `.spec` (ADR 0014, ADR 0042 decision 2). */
describe("F4.281 — the Schedule Centre's steppers and the copilot dock by role (Amendment 8 Q16)", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("an operator opens the create stepper and sees no copilot dock", () => anOperatorGetsTheStepperAndNoDock());
  it("an admin sees the copilot dock", () => anAdminSeesTheDock());
});

// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  anActiveScheduleDeactivatesWithItsReason,
  anInactiveScheduleActivates,
  aRefusedUpdateShowsTheSentence,
  aTwoCharacterReasonStaysOnTheReasonStep,
  theDeactivateReviewSaysWhatItDoes,
} from "./maintenance-schedule-toggle-wizard.spec";

/** `F4.281` — Vitest entry point; assertions live in the sibling `.spec` (ADR 0014, ADR 0042 decision 2). */
describe("F4.281 — the maintenance schedule activate and deactivate steppers (Amendment 8 D3, DC1)", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("an active schedule deactivates with its reason", () => anActiveScheduleDeactivatesWithItsReason());
  it("the deactivate Review says what the change does", () => theDeactivateReviewSaysWhatItDoes());
  it("an inactive schedule activates", () => anInactiveScheduleActivates());
  it("MS3 a refused update shows the server's sentence", () => aRefusedUpdateShowsTheSentence());
  it("a two-character reason stays on the Reason step", () => aTwoCharacterReasonStaysOnTheReasonStep());
});

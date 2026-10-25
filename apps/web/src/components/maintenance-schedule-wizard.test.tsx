// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  aRefusedCreateShowsTheSentence,
  submitSendsTheRoutesBody,
  theReviewNamesSafetyAndCompliance,
  theStepsAreTheEntrys,
} from "./maintenance-schedule-wizard.spec";

/** `F4.281` — Vitest entry point; assertions live in the sibling `.spec` (ADR 0014, ADR 0042 decision 2). */
describe("F4.281 — the maintenance schedule create stepper (Amendment 8 Q16)", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("the steps are Schedule, Cycle, Details, Review", () => theStepsAreTheEntrys());
  it("submit sends the route's body", () => submitSendsTheRoutesBody());
  it("the Review names safety-critical and the compliance ref", () => theReviewNamesSafetyAndCompliance());
  it("MS1 a refused create shows the server's sentence", () => aRefusedCreateShowsTheSentence());
});

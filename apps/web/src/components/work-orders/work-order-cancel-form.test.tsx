// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  aRefusedCancelShowsTheSentence,
  cancelIsAbsentForAnOperatorAndAViewer,
  cancelIsAbsentOnClosedAndCancelledAndPresentOnLiveStatuses,
  cancelIsDisabledUnderThreeCharacters,
  submitSendsTheTrimmedReasonAndCallsOnDone,
} from "./work-order-cancel-form.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E3.1 the work-order cancel form (ADR 0122 decision 6.8)", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("disables the button under three characters", async () => {
    await cancelIsDisabledUnderThreeCharacters();
  });

  it("is absent for an operator and a viewer", () => {
    cancelIsAbsentForAnOperatorAndAViewer();
  });

  it("is absent on closed and cancelled, present on the four live statuses", () => {
    cancelIsAbsentOnClosedAndCancelledAndPresentOnLiveStatuses();
  });

  it("sends the trimmed reason and calls onDone", async () => {
    await submitSendsTheTrimmedReasonAndCallsOnDone();
  });

  it("shows the server's sentence on a refusal", async () => {
    await aRefusedCancelShowsTheSentence();
  });
});

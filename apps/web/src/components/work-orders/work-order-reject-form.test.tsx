// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  aRefusedRejectShowsTheSentence,
  rejectIsAbsentForAnOperatorAndAViewer,
  rejectIsAbsentUnlessResolved,
  rejectIsDisabledUnderThreeCharacters,
  submitSendsTheTrimmedReasonAndCallsOnDone,
} from "./work-order-reject-form.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E3.1 the work-order reject form (ADR 0122 decision 6)", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("disables the button under three characters", async () => {
    await rejectIsDisabledUnderThreeCharacters();
  });

  it("is absent for an operator and a viewer", () => {
    rejectIsAbsentForAnOperatorAndAViewer();
  });

  it("is absent unless the ticket is resolved", () => {
    rejectIsAbsentUnlessResolved();
  });

  it("sends the trimmed reason and calls onDone", async () => {
    await submitSendsTheTrimmedReasonAndCallsOnDone();
  });

  it("shows the server's sentence on a refusal", async () => {
    await aRefusedRejectShowsTheSentence();
  });
});

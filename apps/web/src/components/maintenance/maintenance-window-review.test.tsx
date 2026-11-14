// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, it, vi } from "vitest";

import { resetWizardStore } from "../../stores/wizard-store";
import {
  theCancelReviewSaysLocalTimeAndTheReason,
  theCreateReviewSaysLocalTimesAndNames,
  theEndReviewShowsTheTypedReason,
  theExtendReviewSaysLocalTimes,
  theRadiosAndCheckboxesHaveNames,
} from "./maintenance-window-review.spec";

beforeAll(() => {
  vi.stubEnv("TZ", "Asia/Kolkata");
});
afterAll(() => {
  vi.unstubAllEnvs();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  resetWizardStore();
});

/** `F4.360` defects 4–6 — Vitest entry point; assertions live in the sibling `.spec` (§4.6). TZ is Asia/Kolkata. */
describe("F4.360 — the maintenance-window wizards' Review and labels", () => {
  it("R1 the create Review says local times and target names", theCreateReviewSaysLocalTimesAndNames);
  it("R2 the extend Review says local times", theExtendReviewSaysLocalTimes);
  it("R3 the End Review shows the typed reason", theEndReviewShowsTheTypedReason);
  it("R4 the Cancel Review says the start in local time and the reason", theCancelReviewSaysLocalTimeAndTheReason);
  it("R5 every radio and checkbox has its own name and value", theRadiosAndCheckboxesHaveNames);
});

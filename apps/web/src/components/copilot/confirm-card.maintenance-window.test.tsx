// @vitest-environment jsdom
import { focusManager } from "@tanstack/react-query";
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, it, vi } from "vitest";

import { resetCopilotStore } from "../../stores/copilot-store";
import { resetWizardStore } from "../../stores/wizard-store";
import {
  aCreateCardNamesTheTargetsAndSaysLocalTimes,
  aCreateWithoutStoredNamesKeepsTheRawRow,
  anExtendCardSaysBothEndsInLocalTime,
} from "./confirm-card.maintenance-window.spec";

beforeAll(() => {
  vi.stubEnv("TZ", "Asia/Kolkata");
});
afterAll(() => {
  vi.unstubAllEnvs();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  resetCopilotStore();
  resetWizardStore();
  focusManager.setFocused(undefined);
});

/** `F4.362` leftover 1 — Vitest entry point; assertions live in the sibling `.spec` (§4.6). TZ is Asia/Kolkata. */
describe("F4.362 — a maintenance-window card names targets and says local times", () => {
  it("a create card names the targets and says local times", aCreateCardNamesTheTargetsAndSaysLocalTimes);
  it("an extend card says both ends in local time", anExtendCardSaysBothEndsInLocalTime);
  it("a create without stored names keeps the raw Targets row", aCreateWithoutStoredNamesKeepsTheRawRow);
});

// @vitest-environment jsdom
import { focusManager } from "@tanstack/react-query";
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import { resetCopilotStore } from "../../stores/copilot-store";
import { resetWizardStore } from "../../stores/wizard-store";
import {
  anUploadCardDrawsTheSymbolFromADataUrl,
  anUploadCardHasNoInlineSvgFromTheBody,
  anUploadCardHasNoSvgTextRow,
  anUploadCardMakesNoBlobUrl,
} from "./confirm-card.upload.spec";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetCopilotStore();
  resetWizardStore();
  focusManager.setFocused(undefined);
  window.localStorage.clear();
});

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, ADR 0042). */
describe("F3.87 PR 6b — the symbol upload Confirm card (Amendment 3 A3, D14)", () => {
  it("draws the symbol as an img from a data URL of the stored SVG", () => anUploadCardDrawsTheSymbolFromADataUrl(), 15_000);
  it("puts no inline SVG from the body in the document", () => anUploadCardHasNoInlineSvgFromTheBody(), 15_000);
  it("shows no svgText row beside the stored fields", () => anUploadCardHasNoSvgTextRow(), 15_000);
  it("makes no blob URL", () => anUploadCardMakesNoBlobUrl(), 15_000);
});

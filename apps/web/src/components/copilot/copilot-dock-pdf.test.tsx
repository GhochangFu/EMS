// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import { useAuthStore } from "../../stores/auth-store";
import { resetCopilotStore } from "../../stores/copilot-store";
import {
  bannersAPdfThatCannotBeRead,
  dropsARenderInFlightOnAPickOfAnotherOrganization,
  saysPageOneOfNOnTheChip,
  sendsAPickedPdfAsOnePngPart,
} from "./copilot-dock-pdf.spec";

// ADR 0105 verification: `pdfjs-dist` stubbed at the module seam.
vi.mock("pdfjs-dist", async () => (await import("./copilot-dock-pdf.spec")).PDFJS_FAKE);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useAuthStore.setState({ scope: null });
  resetCopilotStore();
  window.localStorage.clear();
});

describe("F4.269 copilot dock — a PDF goes as its first page (ADR 0105)", () => {
  it("sends a picked PDF as one PNG part and no PDF", sendsAPickedPdfAsOnePngPart);
  it("says page 1 of N on the chip", saysPageOneOfNOnTheChip);
  it("banners a PDF that cannot be read", bannersAPdfThatCannotBeRead);
  it("drops a render in flight on a pick of another organization", dropsARenderInFlightOnAPickOfAnotherOrganization);
});

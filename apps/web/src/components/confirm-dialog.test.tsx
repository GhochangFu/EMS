// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  cancelCallsOnCloseAndNeverOnConfirm,
  confirmCallsOnConfirmOnce,
  rendersTheTitleAndTheBody,
} from "./confirm-dialog.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). The jsdom docblock is on
 * THIS file because Vitest reads it from the file it collects (ADR 0042 decision 2).
 */
describe("F4.202 ConfirmDialog", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders its title as the dialog's name, and its body", () => {
    rendersTheTitleAndTheBody();
  });

  it("Cancel calls onClose once and never onConfirm", async () => {
    await cancelCallsOnCloseAndNeverOnConfirm();
  });

  it("the confirm button calls onConfirm once and never onClose", async () => {
    await confirmCallsOnConfirmOnce();
  });
});

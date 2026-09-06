// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  aSelectionOverTheCapIsRefusedWithItsSize,
  aZeroMultiplierIsRefusedBeforeItIsSent,
  anEntryThatIsNotANumberIsRefusedAsTyped,
  anUntouchedPanelCannotBeApplied,
  applyingSendsExactlyTheTickedField,
} from "./asset-point-bulk-edit-panel.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 * `@vitest-environment jsdom` is on this file because Vitest reads it from the
 * file it collects (ADR 0042 decision 2).
 */
describe("F2.7 asset-point bulk edit panel (ADR 0056 decision 8)", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("cannot be applied until a field is ticked", () => {
    anUntouchedPanelCannotBeApplied();
  });

  it("sends exactly the ticked field, for exactly the selected ids", async () => {
    await applyingSendsExactlyTheTickedField();
  });

  it("refuses a zero scale multiplier before it is sent", async () => {
    await aZeroMultiplierIsRefusedBeforeItIsSent();
  });

  it("refuses an entry that is not a number instead of clearing the column", async () => {
    await anEntryThatIsNotANumberIsRefusedAsTyped();
  });

  it("refuses a selection over the shared cap and names the cap", async () => {
    await aSelectionOverTheCapIsRefusedWithItsSize();
  });
});

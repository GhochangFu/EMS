// @vitest-environment jsdom
import { afterEach, describe, it } from "vitest";
import { cleanup } from "@testing-library/react";

import { aTurnInFlightSaysWait, enabledHasNoReason, noHashSaysUnavailable, undoingHasNoReason } from "./undo-picker.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.339 — Undo says why it is disabled (plan T8.2)", () => {
  afterEach(() => cleanup());
  it("says to wait while a turn is in flight", aTurnInFlightSaysWait);
  it("says the draft cannot be hashed", noHashSaysUnavailable);
  it("says nothing when enabled", enabledHasNoReason);
  it("says nothing while undoing", undoingHasNoReason);
});

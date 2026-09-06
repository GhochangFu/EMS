// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  hidesTheFieldForATimeWindowRule,
  refusesANonNumericClearHold,
  sendsNullForABlankClearHold,
  sendsTheParsedIntegerForANonBlankClearHold,
  showsAStoredValueWhenOpeningARule,
  showsThePlaceholderOnANewDraft,
} from "./rule-builder-panel.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 *
 * The `@vitest-environment jsdom` docblock is on THIS file because Vitest reads
 * it from the file it collects (ADR 0042 decision 2).
 */
describe("F3.10 rule builder clear-hold field", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows the placeholder on a new threshold draft", async () => {
    await showsThePlaceholderOnANewDraft();
  });

  it("sends null when the field is left blank", async () => {
    await sendsNullForABlankClearHold();
  });

  it("sends the parsed integer when a value is entered", async () => {
    await sendsTheParsedIntegerForANonBlankClearHold();
  });

  it("refuses a non-numeric clear hold at the field and does not submit", async () => {
    await refusesANonNumericClearHold();
  });

  it("shows a stored value when opening a rule that has one", async () => {
    await showsAStoredValueWhenOpeningARule();
  });

  it("hides the field for a time-window rule", async () => {
    await hidesTheFieldForATimeWindowRule();
  });
});

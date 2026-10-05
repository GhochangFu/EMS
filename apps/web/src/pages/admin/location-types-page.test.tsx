// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  createPostsCodeLabelAndSortOrder,
  deactivateCallsDeactivateWithTheCode,
  editSendsNoCodeInTheBody,
  failsClosedForAnOrganizationAdmin,
  rendersOneRowPerItemWithItsCount,
  saveInvalidatesTheDropdownKey,
  showsARetiredRowAsInactiveWithReactivate,
  aRefusedSaveShowsTheSentence,
  aRefusedToggleShowsTheSentence,
} from "./location-types-page.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and
 * the jsdom docblock is here because this is the file Vitest collects
 * (ADR 0042 decision 2).
 */
describe("F4.162 Location Types admin page", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("W1 renders one row per item with its label, code and locationCount", async () => {
    await rendersOneRowPerItemWithItsCount();
  });

  it("W2 shows a retired row as Inactive with a Reactivate button", async () => {
    await showsARetiredRowAsInactiveWithReactivate();
  });

  it("W3 the create form posts { code, label, sortOrder }", async () => {
    await createPostsCodeLabelAndSortOrder();
  });

  it("W4 the edit form sends { label, sortOrder } and no code in the body", async () => {
    await editSendsNoCodeInTheBody();
  });

  it("W5 Deactivate on an active row calls deactivateLocationType(code)", async () => {
    await deactivateCallsDeactivateWithTheCode();
  });

  it("W6 a save invalidates [\"admin\", \"location-types\"]", async () => {
    await saveInvalidatesTheDropdownKey();
  });

  it("W7 fails closed for an organization_admin: status line, no table, no catalog read", async () => {
    await failsClosedForAnOrganizationAdmin();
  });

  it("F4.204 a refused save shows the sentence, not the envelope", async () => {
    await aRefusedSaveShowsTheSentence();
  });

  it("F4.204 a refused deactivate shows the sentence, not the envelope", async () => {
    await aRefusedToggleShowsTheSentence();
  });
});

// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  addOpensTheCreateWizard,
  aRefusedWriteShowsTheSentence,
  aSortOrderFillShowsInTheEditInput,
  deactivateSendsActiveFalse,
  editSendsLabelAndSortOrderOnly,
  failsClosedForAnOrganizationAdmin,
  reactivateSendsActiveTrue,
  rendersOneRowPerRole,
} from "./unit-roles-page.spec";
import { resetWizardStore } from "../../stores/wizard-store";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and
 * the jsdom docblock is here because this is the file Vitest collects
 * (ADR 0042 decision 2).
 */
describe("F4.282 Unit Roles admin page", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    resetWizardStore();
  });

  it("renders one row per role with its label, sort order and status", () => rendersOneRowPerRole());
  it("sends label and sort order, and no active key, from the edit wizard", () => editSendsLabelAndSortOrderOnly());
  it("shows a copilot sort-order fill in the edit wizard's input", () => aSortOrderFillShowsInTheEditInput());
  it("sends { active: false } from the Review-only deactivate", () => deactivateSendsActiveFalse());
  it("sends { active: true } from the Review-only reactivate", () => reactivateSendsActiveTrue());
  it("opens the create wizard from Add a unit role", () => addOpensTheCreateWizard());
  it("F4.204 shows a refused write's sentence, not the envelope", () => aRefusedWriteShowsTheSentence());
  it("fails closed for an organization_admin: status line, no table, no catalog read", () =>
    failsClosedForAnOrganizationAdmin());
});

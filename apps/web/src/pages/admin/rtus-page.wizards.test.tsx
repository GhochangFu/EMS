// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import { resetWizardStore } from "../../stores/wizard-store";
import {
  aFillFillsItsStepOnly,
  aSelectPickedFirstStays,
  deactivateIsARedReviewThatPosts,
  reactivateIsAPlainReviewThatPosts,
  theCreateBodyIsTheWizardsValues,
  theCreateSendsNoCopilotHeader,
  theCreateStepsAreTheEntrys,
  theEditReviewShowsNowBesideAfter,
  theEditSendsThePatchWithoutAHeader,
} from "./rtus-page.wizards.spec";

/** userEvent types every key; a full create walk takes seconds under jsdom. */
const SLOW = 20_000;

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, ADR 0042 decision 2). */
describe("F3.86 PR 3a — the RTUs page's wizards (ADR 0099 decision 6)", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    resetWizardStore();
  });

  it("orders the create steps as the entry does", () => theCreateStepsAreTheEntrys(), SLOW);
  it("keeps a select picked first in a fresh wizard", () => aSelectPickedFirstStays(), SLOW);
  it("sends the wizard's values as the create body", () => theCreateBodyIsTheWizardsValues(), SLOW);
  it("sends no X-Copilot-Change header on a create", () => theCreateSendsNoCopilotHeader(), SLOW);
  it("fills only the named step from a fill_step", () => aFillFillsItsStepOnly(), SLOW);
  it("shows Now beside After on the edit's Review", () => theEditReviewShowsNowBesideAfter(), SLOW);
  it("sends the edit's PATCH without the header", () => theEditSendsThePatchWithoutAHeader(), SLOW);
  it("makes deactivate a red Review that posts", () => deactivateIsARedReviewThatPosts(), SLOW);
  it("makes reactivate a plain Review that posts", () => reactivateIsAPlainReviewThatPosts(), SLOW);
});

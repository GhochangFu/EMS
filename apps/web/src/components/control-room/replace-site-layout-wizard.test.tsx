// @vitest-environment jsdom
import { afterEach, describe, it } from "vitest";

import {
  aPendingSubmitIsDisabledAndBusy,
  anAmbiguousAnswerRetriesWithTheChoice,
  cleanupReplaceWizard,
  closeDoesNotRefetchTheDeletedDashboard,
  submitCallsTheReplaceClient,
  openingTheWizardRefreshesTheEditFlag,
  theButtonShowsOnlyForATemplateCopy,
  theConfirmStepShowsNoRecordedEdit,
  theConfirmStepShowsTheFlagWithoutTheActor,
  theConfirmStepShowsTheFlagWithTheActor,
} from "./replace-site-layout-wizard.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and the jsdom docblock
 * is here because this is the file Vitest collects (ADR 0042 decision 2).
 */
describe("F4.320 PR 2 Replace with this version (the site page's wizard)", () => {
  afterEach(() => {
    cleanupReplaceWizard();
  });

  it("B1 shows the button only for a template copy Replace would rebuild", async () => {
    await theButtonShowsOnlyForATemplateCopy();
  }, 20_000);

  it("B2 shows what is lost and the edit flag with the actor on the confirm step", async () => {
    await theConfirmStepShowsTheFlagWithTheActor();
  });

  it("B3b reads the preview again when the wizard opens, so the edit flag is fresh", async () => {
    await openingTheWizardRefreshesTheEditFlag();
  });

  it("B3 shows the edit flag without 'by' when the actor is absent", async () => {
    await theConfirmStepShowsTheFlagWithoutTheActor();
  });

  it("B4 shows 'No recorded edit since the copy' for an untouched copy", async () => {
    await theConfirmStepShowsNoRecordedEdit();
  });

  it("B5 Submit calls the replace client with the body, and Close re-reads the site view and the slug reads", async () => {
    await submitCallsTheReplaceClient();
  });

  it("B6 a pending Submit is disabled and aria-busy", async () => {
    await aPendingSubmitIsDisabledAndBusy();
  });

  it("B7 an ambiguous answer re-opens Groups and the retry carries the choice", async () => {
    await anAmbiguousAnswerRetriesWithTheChoice();
  }, 20_000);

  it("B8 Close does not re-read the deleted dashboard's id-keyed reads (F4.320 follow-up)", async () => {
    await closeDoesNotRefetchTheDeletedDashboard();
  }, 20_000);
});

// @vitest-environment jsdom
// Pinned to a non-UTC zone BEFORE anything reads the clock: in UTC the
// wall-clock-as-UTC bug and the correct local-zone conversion are
// observationally identical, so the ISO-offset case would pass in CI for
// the implementation it exists to forbid (PR 2 code review; the F4.40 shape).
// (`process` is reached through `globalThis`: the web tsconfig carries no Node types.)
(globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env.TZ = "Asia/Kolkata";
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  adminHasTheOrganizationRadio,
  aChangedEndDateTravelsBesideTheValue,
  anEmptiedStartDateHoldsTheDatesStep,
  anUnpickedLocationHoldsTheScopeStep,
  aValueOnlyEditSendsTheValueAlone,
  createStepsAreBasicsScopeDatesReview,
  editHasNoKeyOrScopeControl,
  editStepsAreValueDatesReview,
  theCreateWizardSendsNoCopilotHeader,
  theEditReviewShowsNowBesideAfter,
  theEditWizardSendsNoCopilotHeader,
  theLocationPickerListsTheTree,
  deleteAsksBeforeSending,
  deletingRowAnnouncesDeleting,
  siblingRowsAreNotBusy,
  siblingRowsKeepTheirDeleteName,
  keySelectOffersExactlyTheFetchedKeys,
  locationAdminDefaultsToLocationScope,
  locationAdminHasNoOrganizationRadio,
  rendersRowsWithAllThreeScopeLabels,
  rendersTheServerConflictSentenceVerbatim,
  submitsTheChosenScopeAndIsoDates,
} from "./calc-parameters-page.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 *
 * The `@vitest-environment jsdom` docblock is on THIS file because Vitest
 * reads it from the file it collects (ADR 0042 decision 2). The project
 * default stays `node`.
 */
describe("E4.1a calc parameters page", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders the mocked rows with all three scope labels", async () => {
    await rendersRowsWithAllThreeScopeLabels();
  });

  it("as location_admin the form has no Organization radio", async () => {
    await locationAdminHasNoOrganizationRadio();
  });

  it("as location_admin the Location radio is the checked default", async () => {
    await locationAdminDefaultsToLocationScope();
  });

  it("as admin the Organization radio is present and the default", async () => {
    await adminHasTheOrganizationRadio();
  });

  it("offers exactly the fetched keys in the key select", async () => {
    await keySelectOffersExactlyTheFetchedKeys();
  });

  it("creates with the chosen scope and ISO dates with an offset", async () => {
    await submitsTheChosenScopeAndIsoDates();
  });

  it("renders the server's 409 sentence verbatim on the Review step", async () => {
    await rendersTheServerConflictSentenceVerbatim();
  });

  it("edit is a wizard of Value, Effective dates, Review", async () => {
    await editStepsAreValueDatesReview();
  });

  it("edit restates key and scope as text and offers no control for them", async () => {
    await editHasNoKeyOrScopeControl();
  });

  it("a value-only edit sends the value alone", async () => {
    await aValueOnlyEditSendsTheValueAlone();
  });

  it("an edited end date travels beside the value; the untouched start does not", async () => {
    await aChangedEndDateTravelsBesideTheValue();
  });

  it("delete asks with confirm() before sending", async () => {
    await deleteAsksBeforeSending();
  });

  it("B2 the deleting row announces Deleting… with aria-busy", async () => {
    await deletingRowAnnouncesDeleting();
  });

  it("B2 sibling rows keep the name Delete", async () => {
    await siblingRowsKeepTheirDeleteName();
  });

  it("B2 sibling rows' Delete buttons are not busy", async () => {
    await siblingRowsAreNotBusy();
  });
});

describe("F2.10 calc parameters — the Location picker lists the tree (B11)", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("lists a child after its parent with the code inside the dashes", async () => {
    await theLocationPickerListsTheTree();
  });
});

describe("F3.85 PR 11b calc parameters — the create and edit wizards", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("create is a wizard of Basics, Scope, Effective dates, Review", async () => {
    await createStepsAreBasicsScopeDatesReview();
  });

  it("a chosen Location scope with no location picked holds the wizard on Scope", async () => {
    await anUnpickedLocationHoldsTheScopeStep();
  });

  it("the edit Review shows the stored value beside the new one", async () => {
    await theEditReviewShowsNowBesideAfter();
  });

  it("the create wizard alone sends its POST without X-Copilot-Change", async () => {
    await theCreateWizardSendsNoCopilotHeader();
  });

  it("the edit wizard alone sends its PATCH without X-Copilot-Change", async () => {
    await theEditWizardSendsNoCopilotHeader();
  });

  it("review code:F4 an emptied start date on edit holds the Effective dates step and sends nothing", async () => {
    await anEmptiedStartDateHoldsTheDatesStep();
  });
});

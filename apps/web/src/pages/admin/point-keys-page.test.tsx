// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  aFillFillsTheNamedStepOnly,
  aNonNumberIsRefusedWithoutACall,
  anEmptyCodeHoldsTheBasicsStep,
  clearingSendsNull,
  columnShowsADashForNoRank,
  columnShowsTheRank,
  createStepsAreBasicsDetailsReview,
  deactivateIsARedReviewThatPostsDeactivate,
  organizationAdminSeesNoEdit,
  rankHintSaysASeededCodeIsReRanked,
  reactivateIsAReviewThatPostsReactivate,
  theCreateWizardSendsNoCopilotHeader,
  theCreateWizardSendsTheReviewedBody,
  theEditReviewShowsNowBesideAfter,
  typingTwoSendsTwo,
  aRefusedSaveShowsTheSentence,
  columnShowsTheTrendDefault,
  createWithTheBoxSendsTrue,
  editFormHasATrendDefaultCheckbox,
  organizationAdminSeesTheFlagButNoControl,
  uncheckingSendsFalse,
  untouchedBoxSendsNothing,
  aTouchedUncheckedBoxSendsFalse,
} from "./point-keys-page.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 * The `@vitest-environment jsdom` docblock is on THIS file because Vitest
 * reads it from the file it collects (ADR 0042 decision 2).
 */
describe("F3.68 point keys page — headline rank", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("W1 shows a ranked key's rank in the Headline rank column", async () => {
    await columnShowsTheRank();
  });

  it("W1b shows — for an unranked key", async () => {
    await columnShowsADashForNoRank();
  });

  it("W2 clearing the field sends headlineRank: null for that key", async () => {
    await clearingSendsNull();
  });

  it("W3 typing 2 sends headlineRank: 2", async () => {
    await typingTwoSendsTwo();
  });

  it("W4 refuses a non-number on the page and calls no API", async () => {
    await aNonNumberIsRefusedWithoutACall();
  });

  it("W5 an organization_admin sees the rows and no Edit button", async () => {
    await organizationAdminSeesNoEdit();
  });

  it("W6 the rank hint says a seeded code is re-ranked on the next seed", async () => {
    await rankHintSaysASeededCodeIsReRanked();
  });

  it("F4.204 a refused save shows the sentence, not the envelope", async () => {
    await aRefusedSaveShowsTheSentence();
  });
});

describe("F3.86 PR 3c point keys page — the catalog wizards (ADR 0099 decision 6, ruling Q9)", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("the create wizard's steps are Basics, Details, Review", async () => {
    await createStepsAreBasicsDetailsReview();
  });

  it("Submit sends exactly the body Review showed", async () => {
    await theCreateWizardSendsTheReviewedBody();
  });

  it("an empty code holds the Basics step and sends nothing", async () => {
    await anEmptyCodeHoldsTheBasicsStep();
  });

  it("the create wizard sends no X-Copilot-Change header", async () => {
    await theCreateWizardSendsNoCopilotHeader();
  });

  it("a copilot fill fills the named step's fields only", async () => {
    await aFillFillsTheNamedStepOnly();
  });

  it("an edit's Review shows Now beside After", async () => {
    await theEditReviewShowsNowBesideAfter();
  });

  it("Deactivate is a red Review that posts the plain deactivate", async () => {
    await deactivateIsARedReviewThatPostsDeactivate();
  });

  it("Reactivate is a Review that posts the plain reactivate", async () => {
    await reactivateIsAReviewThatPostsReactivate();
  });

  it("F4.300 the table shows the trend default column", async () => {
    await columnShowsTheTrendDefault();
  });

  it("F4.300 the Details step has a Trend default checkbox from the stored flag", async () => {
    await editFormHasATrendDefaultCheckbox();
  });

  it("F4.300 checking the box on create sends trendDefault: true", async () => {
    await createWithTheBoxSendsTrue();
  });

  it("F4.300 unchecking a stored true sends trendDefault: false", async () => {
    await uncheckingSendsFalse();
  });

  it("F4.300 an untouched box sends no trendDefault", async () => {
    await untouchedBoxSendsNothing();
  });

  it("F4.300 a touched box left unchecked on a false row sends trendDefault: false", async () => {
    await aTouchedUncheckedBoxSendsFalse();
  });

  it("F4.300 an organization_admin sees the flag and no control", async () => {
    await organizationAdminSeesTheFlagButNoControl();
  });
});

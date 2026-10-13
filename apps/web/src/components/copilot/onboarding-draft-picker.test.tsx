// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  aPendingStartReadsStarting,
  aResumeLeavesTheOtherRowIdleAndAllDisabled,
  aResumingRowReadsResuming,
  aDraftWithNoAuthorReadsUnknownUser,
  aDraftWithNoLocationReadsUntitled,
  resumeCallsBackWithThatRowsId,
  theListIsReadOnceForTheOrganization,
  theRowsNameTheirPhaseAndAuthor,
  withDraftsTheStartButtonReadsStartNew,
  withNoDraftTheStartButtonReadsOnboardASite,
  withNoOrganizationNothingIsRead,
  theHomeListIsReadWithNoOrganization,
  eachResumeIsDescribedByItsRow,
} from "./onboarding-draft-picker.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). The
 * `@vitest-environment` docblock is on THIS file (ADR 0042 decision 2).
 */
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("F4.255 PR 3 — the dock's onboarding draft list", () => {
  it("rows name their phase and author, 'by you' for the caller's own", theRowsNameTheirPhaseAndAuthor);
  it("a draft with no location reads 'Untitled draft'", aDraftWithNoLocationReadsUntitled);
  it("a draft with no author reads 'by an unknown user'", aDraftWithNoAuthorReadsUnknownUser);
  it("Resume calls back with that row's id only", resumeCallsBackWithThatRowsId);
  it("with drafts the start button reads 'Start new'", withDraftsTheStartButtonReadsStartNew);
  it("with no draft the start button reads 'Onboard a site'", withNoDraftTheStartButtonReadsOnboardASite);
  it("the list is read once, for the organization", theListIsReadOnceForTheOrganization);
  it("a resuming row reads 'Resuming…' and is busy", aResumingRowReadsResuming);
  it("a resume leaves the other row idle and every button disabled", aResumeLeavesTheOtherRowIdleAndAllDisabled);
  it("a pending start reads 'Starting…' and is busy", aPendingStartReadsStarting);
  it("with no organization yet nothing is read and the start button shows", withNoOrganizationNothingIsRead);
  it("the home list is read once, naming no organization", theHomeListIsReadWithNoOrganization);
  it("each Resume is described by its own row's label", eachResumeIsDescribedByItsRow);
});

// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  anotherTenantsProfileShowsNoMappedSeverity,
  asksAnAdminToChooseAnOrganization,
  aStepRowCanBeAddedAndRemoved,
  createPostsTheOrganizationCodeNameAndLadder,
  editingSendsOnlyTheNameAndLadder,
  listsProfilesWithStepCountsAndMappedSeverities,
  locksASingleGrantOrganizationAdmin,
  refusesABlankOrNonNumericStepDelay,
  showsTheRefusalWhenDeletingAMappedProfile,
  showsTheServerRefusalOnCreate,
  theChannelChecklistExcludesAnotherTenantsChannels,
  theSeverityMapPutsOnlyTheMappedSeverities,
} from "./escalation-profiles-page.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 *
 * The `@vitest-environment jsdom` docblock is on THIS file because Vitest reads
 * it from the file it collects (ADR 0042 decision 2).
 */
/**
 * Per-case timeout (review 4): each case types through several fields and a
 * step fieldset with `userEvent`, which lands near Vitest's 5 s default on a
 * loaded machine or a full parallel run.
 */
const CASE_TIMEOUT_MS = 15_000;

describe("F3.10 escalation profiles page", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("lists each profile with its step count and the severities mapped to it", async () => {
    await listsProfilesWithStepCountsAndMappedSeverities();
  }, CASE_TIMEOUT_MS);

  it("posts the organization, code, name and ladder on create", async () => {
    await createPostsTheOrganizationCodeNameAndLadder();
  }, CASE_TIMEOUT_MS);

  it("sends only the name and the ladder when editing — never code or organization", async () => {
    await editingSendsOnlyTheNameAndLadder();
  }, CASE_TIMEOUT_MS);

  it("adds a step row and removes it, keeping the survivors' values", async () => {
    await aStepRowCanBeAddedAndRemoved();
  }, CASE_TIMEOUT_MS);

  it("refuses a blank or non-numeric step delay at the field and does not submit", async () => {
    await refusesABlankOrNonNumericStepDelay();
  }, CASE_TIMEOUT_MS);

  it("offers only the organization's channels and the fleet-wide ones", async () => {
    await theChannelChecklistExcludesAnotherTenantsChannels();
  }, CASE_TIMEOUT_MS);

  it("PUTs only the mapped severities — None means absent, not null", async () => {
    await theSeverityMapPutsOnlyTheMappedSeverities();
  }, CASE_TIMEOUT_MS);

  it("shows the server's reason when a create is refused", async () => {
    await showsTheServerRefusalOnCreate();
  }, CASE_TIMEOUT_MS);

  it("shows the server's reason when a mapped profile cannot be deleted", async () => {
    await showsTheRefusalWhenDeletingAMappedProfile();
  }, CASE_TIMEOUT_MS);

  it("asks an admin to choose an organization — there is no fleet-wide profile", async () => {
    await asksAnAdminToChooseAnOrganization();
  }, CASE_TIMEOUT_MS);

  it("locks a single-grant organization admin to its own organization", async () => {
    await locksASingleGrantOrganizationAdmin();
  }, CASE_TIMEOUT_MS);

  it("leaves another tenant's profile with no mapped severity", async () => {
    await anotherTenantsProfileShowsNoMappedSeverity();
  }, CASE_TIMEOUT_MS);
});

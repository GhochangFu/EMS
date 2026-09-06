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
describe("F3.10 escalation profiles page", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("lists each profile with its step count and the severities mapped to it", async () => {
    await listsProfilesWithStepCountsAndMappedSeverities();
  });

  it("posts the organization, code, name and ladder on create", async () => {
    await createPostsTheOrganizationCodeNameAndLadder();
  });

  it("sends only the name and the ladder when editing — never code or organization", async () => {
    await editingSendsOnlyTheNameAndLadder();
  });

  it("adds a step row and removes it, keeping the survivors' values", async () => {
    await aStepRowCanBeAddedAndRemoved();
  });

  it("offers only the organization's channels and the fleet-wide ones", async () => {
    await theChannelChecklistExcludesAnotherTenantsChannels();
  });

  it("PUTs only the mapped severities — None means absent, not null", async () => {
    await theSeverityMapPutsOnlyTheMappedSeverities();
  });

  it("shows the server's reason when a create is refused", async () => {
    await showsTheServerRefusalOnCreate();
  });

  it("shows the server's reason when a mapped profile cannot be deleted", async () => {
    await showsTheRefusalWhenDeletingAMappedProfile();
  });

  it("asks an admin to choose an organization — there is no fleet-wide profile", async () => {
    await asksAnAdminToChooseAnOrganization();
  });

  it("locks a single-grant organization admin to its own organization", async () => {
    await locksASingleGrantOrganizationAdmin();
  });

  it("leaves another tenant's profile with no mapped severity", async () => {
    await anotherTenantsProfileShowsNoMappedSeverity();
  });
});

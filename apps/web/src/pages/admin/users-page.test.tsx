// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  a400PolicyRefusalShowsTheServerMessageNotThePassword,
  a404ShowsANotFoundSentence,
  a503ShowsASentenceAndWritesNothingElse,
  aGlobalAdminMayCreateAnAdmin,
  addingAGrantSendsItsKindAndTarget,
  anIneffectiveGrantShowsTheNote,
  anOrganizationAdminIsNotOfferedAdmin,
  hidesTheUsersTabFromALocationAdmin,
  linkedEditIsEnabled,
  localModeDisablesEveryUserAction,
  passwordInputIsEmptyOnReopen,
  refusesAShortPasswordBeforeFetch,
  refusesAShortPasswordOnCreateBeforeFetch,
  removingAGrantSendsItsIdAndKind,
  rendersKeycloakCreateOutcomeUnknown,
  rendersKeycloakDisableFailed,
  rendersKeycloakEnableFailed,
  rendersKeycloakLogoutFailed,
  rendersKeycloakOrphanDisabledAccount,
  sendsATwelveCharacterPassword,
  showsTheDeactivatedPill,
  showsTheUsersTabToAnOrganizationAdmin,
  unlinkedEditIsDisabledWithTheSentence,
} from "./users-page.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). The jsdom docblock is on
 * THIS file because Vitest reads it from the file it collects (ADR 0042 decision 2).
 */
describe("F3.78 users page", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("shows the Users tab to an organization_admin", async () => {
    await showsTheUsersTabToAnOrganizationAdmin();
  });

  it("hides the Users tab from a location_admin and fails the page closed", async () => {
    await hidesTheUsersTabFromALocationAdmin();
  });

  it("shows a deactivated pill on a deactivated user only", async () => {
    await showsTheDeactivatedPill();
  });

  it("unlinked edit disabled with the sign-in-once sentence", async () => {
    await unlinkedEditIsDisabledWithTheSentence();
  });

  it("linked edit enabled", async () => {
    await linkedEditIsEnabled();
  });

  it("local mode disables create and every row action with the Keycloak sentence", async () => {
    await localModeDisablesEveryUserAction();
  });

  it("refuses before fetch an 11-character temporary password", async () => {
    await refusesAShortPasswordBeforeFetch();
  });

  it("refuses before fetch an 11-character password on create", async () => {
    await refusesAShortPasswordOnCreateBeforeFetch();
  });

  it("sends a 12-character temporary password", async () => {
    await sendsATwelveCharacterPassword();
  });

  it("leaves the temporary-password input empty on reopen", async () => {
    await passwordInputIsEmptyOnReopen();
  });

  it("renders keycloak_enable_failed", async () => {
    await rendersKeycloakEnableFailed();
  });

  it("renders keycloak_disable_failed", async () => {
    await rendersKeycloakDisableFailed();
  });

  it("renders keycloak_logout_failed", async () => {
    await rendersKeycloakLogoutFailed();
  });

  it("renders keycloak_orphan_disabled_account from an error body", async () => {
    await rendersKeycloakOrphanDisabledAccount();
  });

  it("renders keycloak_create_outcome_unknown from an error body", async () => {
    await rendersKeycloakCreateOutcomeUnknown();
  });

  it("a 503 shows a sentence and writes nothing else", async () => {
    await a503ShowsASentenceAndWritesNothingElse();
  });

  it("a 400 policy refusal shows the server message and never the password", async () => {
    await a400PolicyRefusalShowsTheServerMessageNotThePassword();
  });

  it("a 404 shows a not-found sentence", async () => {
    await a404ShowsANotFoundSentence();
  });

  it("an ineffective grant shows the note", async () => {
    await anIneffectiveGrantShowsTheNote();
  });

  it("removing a grant sends the grant's id and kind", async () => {
    await removingAGrantSendsItsIdAndKind();
  });

  it("adding a grant sends its kind and target", async () => {
    await addingAGrantSendsItsKindAndTarget();
  });

  it("offers the admin role to a global admin", async () => {
    await aGlobalAdminMayCreateAnAdmin();
  });

  it("does not offer the admin role to an organization_admin", async () => {
    await anOrganizationAdminIsNotOfferedAdmin();
  });
});

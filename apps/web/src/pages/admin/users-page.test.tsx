// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  a400ClearsThePasswordInput,
  a400LeavesNoPasswordInTheMarkup,
  a400PolicyRefusalShowsTheServerMessageNotThePassword,
  aFailedCreateClearsThePasswordInput,
  aFailedCreateLeavesNoPasswordInTheMarkup,
  a404ShowsANotFoundSentence,
  a503ShowsASentenceAndWritesNothingElse,
  aMissingGrantTargetGetsItsOwnSentence,
  aMissingUserInTheDrawerKeepsTheUserSentence,
  aPendingAddAnnouncesItself,
  aPendingDeactivateAnnouncesItselfOnItsRowOnly,
  aPendingDeactivateLeavesTheSameActionOnAnotherRowAlone,
  aPendingEditAnnouncesItsRow,
  aPendingReactivateAnnouncesItself,
  aPendingTemporaryPasswordAnnouncesItsRow,
  aPendingRemoveAnnouncesOnlyItsOwnGrant,
  aSuccessfulWriteReadsTheListAgain,
  aGlobalAdminMayCreateAnAdmin,
  addingAGrantSendsItsKindAndTarget,
  anIneffectiveGrantShowsTheNote,
  anOrganizationAdminIsNotOfferedAdmin,
  hidesTheUsersTabFromALocationAdmin,
  linkedEditIsEnabled,
  localModeDisablesEveryUserAction,
  localModeKeepsAddGrantEnabled,
  localModeKeepsGrantRemoveEnabled,
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
  theCreateRoleSelectShowsTheSharedLabels,
  theDrawerRoleLineShowsTheSharedLabel,
  theEditRoleSelectShowsTheSharedLabels,
  theRoleColumnShowsTheSharedLabel,
  theTargetSelectNamesTheGroupsLocation,
  anAssetGroupGrantRowNamesItsLocation,
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

  it("a successful write reads the users list again", async () => {
    await aSuccessfulWriteReadsTheListAgain();
  });

  it("a 400 policy refusal shows the server message and never the password", async () => {
    await a400PolicyRefusalShowsTheServerMessageNotThePassword();
  });

  it("a 400 on the temporary password leaves no password in the markup", async () => {
    await a400LeavesNoPasswordInTheMarkup();
  });

  it("a 400 on the temporary password clears the password input", async () => {
    await a400ClearsThePasswordInput();
  });

  it("a failed create leaves no password in the markup", async () => {
    await aFailedCreateLeavesNoPasswordInTheMarkup();
  });

  it("a failed create clears the password input and keeps the rest", async () => {
    await aFailedCreateClearsThePasswordInput();
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

  it("a pending Remove announces only its own grant", async () => {
    await aPendingRemoveAnnouncesOnlyItsOwnGrant();
  });

  it("a pending Add grant announces itself", async () => {
    await aPendingAddAnnouncesItself();
  });

  it("local mode keeps a grant's Remove enabled", async () => {
    await localModeKeepsGrantRemoveEnabled();
  });

  it("local mode keeps Add grant enabled once a target is chosen", async () => {
    await localModeKeepsAddGrantEnabled();
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

  it("a missing grant target gets its own sentence in the drawer", async () => {
    await aMissingGrantTargetGetsItsOwnSentence();
  });

  it("a 404 that is not the grant target keeps the user sentence in the drawer", async () => {
    await aMissingUserInTheDrawerKeepsTheUserSentence();
  });

  it("a pending Deactivate announces itself and only its own row", async () => {
    await aPendingDeactivateAnnouncesItselfOnItsRowOnly();
  });

  it("a pending Deactivate leaves the same action on another row alone", async () => {
    await aPendingDeactivateLeavesTheSameActionOnAnotherRowAlone();
  });

  it("a pending Reactivate announces itself", async () => {
    await aPendingReactivateAnnouncesItself();
  });

  it("a pending Edit save announces itself on its row", async () => {
    await aPendingEditAnnouncesItsRow();
  });

  it("a pending Temporary password announces itself on its row", async () => {
    await aPendingTemporaryPasswordAnnouncesItsRow();
  });

  it("F4.200: the Role column shows the shared role label", async () => {
    await theRoleColumnShowsTheSharedLabel();
  });

  it("F4.200: the create modal's Role select shows the shared role labels", async () => {
    await theCreateRoleSelectShowsTheSharedLabels();
  });

  it("F4.200: the edit modal's Role select shows the shared role labels", async () => {
    await theEditRoleSelectShowsTheSharedLabels();
  });

  it("F4.200: the grants drawer's Role line shows the shared role label", async () => {
    await theDrawerRoleLineShowsTheSharedLabel();
  });

  it("F4.201: the grant target select names each asset group's location", async () => {
    await theTargetSelectNamesTheGroupsLocation();
  });

  it("F4.201: an asset-group grant row names its location", async () => {
    await anAssetGroupGrantRowNamesItsLocation();
  });
});

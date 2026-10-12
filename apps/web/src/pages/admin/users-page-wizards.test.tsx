// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  theCreateRequestBodyIsTheWizardValuesAndThePassword,
  theCreateRequestCarriesTheTypedPassword,
  theCreateWizardValuesHoldNoPassword,
  theCreateValuesBuilderHasNoPasswordKey,
  theCreateRequestCarriesNoCopilotHeader,
  theEditRequestCarriesNoCopilotHeader,
  theEditWizardNeverOffersAdmin,
  anAdminRowKeepsTheOldEditForm,
  aViewerRowEditIsTheWizard,
  theGlobalRoleActionOffersAdmin,
  anOrganizationAdminHasNoGlobalRoleAction,
  theGrantRemoveWizardIsRed,
  theGrantRemoveSendsAPlainDelete,
  theGrantAddCarriesNoCopilotHeader,
  reactivateSubmitSendsOneRequest,
  theCreateWizardNeverOffersAdminToAGlobalAdmin,
} from "./users-page-wizards.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). The jsdom docblock is on
 * THIS file because Vitest reads it from the file it collects (ADR 0042 decision 2).
 */
describe("F3.86 users page and grants drawer wizards", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("the create request body is the wizard's four fields and the typed password", async () => {
    await theCreateRequestBodyIsTheWizardValuesAndThePassword();
  });

  it("the create request carries the typed password", async () => {
    await theCreateRequestCarriesTheTypedPassword();
  });

  it("the create wizard's Review card holds no password row and the markup no secret", async () => {
    await theCreateWizardValuesHoldNoPassword();
  });

  it("the create values builder has the four step fields and no temporaryPassword", async () => {
    await theCreateValuesBuilderHasNoPasswordKey();
  });

  it("the create request carries no X-Copilot-Change header", async () => {
    await theCreateRequestCarriesNoCopilotHeader();
  });

  it("the edit wizard sends only the changed field, with no X-Copilot-Change header", async () => {
    await theEditRequestCarriesNoCopilotHeader();
  });

  it("the edit wizard's Role step never offers admin, even to a global admin", async () => {
    await theEditWizardNeverOffersAdmin();
  });

  it("an admin row's Edit is the old form, not the user.update wizard", async () => {
    await anAdminRowKeepsTheOldEditForm();
  });

  it("a viewer row's Edit is the user.update wizard", async () => {
    await aViewerRowEditIsTheWizard();
  });

  it("the global admin's Global role action opens the old form, which offers admin", async () => {
    await theGlobalRoleActionOffersAdmin();
  });

  it("an organization admin has no Global role action", async () => {
    await anOrganizationAdminHasNoGlobalRoleAction();
  });

  it("the grant remove wizard renders red (data-risk access)", async () => {
    await theGrantRemoveWizardIsRed();
  });

  it("the grant remove wizard sends the plain DELETE with no X-Copilot-Change header", async () => {
    await theGrantRemoveSendsAPlainDelete();
  });

  it("the grant add wizard's POST carries no X-Copilot-Change header", async () => {
    await theGrantAddCarriesNoCopilotHeader();
  });

  it("the create wizard never offers the admin role, even to a global admin (replaces F3.78's 'a global admin may create an admin')", async () => {
    await theCreateWizardNeverOffersAdminToAGlobalAdmin();
  });

  it("ruling Q9: Reactivate is a Review wizard; one Submit sends one request (replaces F4.202's 'sends at once')", async () => {
    await reactivateSubmitSendsOneRequest();
  });
});

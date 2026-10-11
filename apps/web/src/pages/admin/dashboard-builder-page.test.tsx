// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import { useAuthStore } from "../../stores/auth-store";
import { resetWizardStore } from "../../stores/wizard-store";
import {
  addingAWidgetSelectsItForEditing,
  aGroupDashboardsLayoutStepOffersPlantMimic,
  aMimicOnAGroupScopeLeavesCreateEnabled,
  anUnselectedWidgetsProblemRendersInTheSummary,
  assetGroupAdminCreatesAGroupDashboardFromItsOwnScope,
  assetGroupAdminWithNoStoreScopeGetsAnEmptyGroupList,
  assetGroupAdminsCreateFormDoesNotFetchAdminAssetGroups,
  assetGroupAdminsCreateFormDoesNotFetchLocations,
  assetGroupAdminsCreateFormDoesNotFetchOrganizations,
  assetGroupAdminsGroupListComesFromItsOwnScope,
  assetGroupAdminsWidgetInspectorOffersTheAssetChain,
  createIsDisabledUntilRequiredFieldsAreFilled,
  createPageOffersPlantMimicOnlyOnAGroupScope,
  creatingWithAnAssetGroupSendsAssetGroupIdAndNoLocationId,
  locationAdminDoesNotFetchAssetGroups,
  locationAdminGetsNoAssetGroupOptionOnTheComposedPage,
  locationAdminGetsNoOrganizationWideOptionOnTheComposedPage,
  aWidgetProblemRefusesTheWidgetsSubmit,
  theCreateBodyIsTheScopeColumnsPlusNameAndSlug,
  theCreateRequestCarriesNoCopilotHeader,
  theCreateRequestFiresWithTheWizardsBody,
  theCreateWizardStepsAreBasicsScopeReview,
  theWidgetsSubmitPutsToTheNewDashboard,
  theWidgetsWizardIsAbsentWhileTheCreateIsPending,
  theWidgetsWizardOpensWhenTheCreateResolves,
  theWidgetsWizardStepsAreLayoutReview,
  aLocationFillAfterAGroupChoiceChoosesTheLocation,
  locationAdminCreatesOnItsOwnLocation,
  anOrganizationWideFillOnReviewDoesNotCreateForALocationAdmin,
  aBreakerTableOnAnOrganizationWideDashboardReachesReview,
  aBreakerTableOnAnOrganizationWideDashboardSendsNoPut,
  cancellingClickOnlyLayoutWorkAsksFirst,
} from "./dashboard-builder-page.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and
 * the jsdom docblock is here because this is the file Vitest collects
 * (ADR 0042 decision 2).
 */
describe("F3.1d dashboard builder page", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    // The role cases sign an `asset_group_admin` scope into the store; reset it here, where a
    // failing `expect` cannot skip it.
    useAuthStore.setState({ scope: null });
    // A copilot fill a case left waiting must not reach the next case's wizard.
    resetWizardStore();
  });

  it("gives a location_admin no organization-wide option on the composed page", async () => {
    await locationAdminGetsNoOrganizationWideOptionOnTheComposedPage();
  });

  it("gives a location_admin no asset-group option on the composed page (F3.34)", async () => {
    await locationAdminGetsNoAssetGroupOptionOnTheComposedPage();
  });

  it("creating with an asset group sends assetGroupId and no locationId (F3.34)", async () => {
    await creatingWithAnAssetGroupSendsAssetGroupIdAndNoLocationId();
  });

  it("offers no Plant mimic on an organization-wide dashboard's Layout step (F3.32)", async () => {
    await createPageOffersPlantMimicOnlyOnAGroupScope();
  });

  it("offers Plant mimic on a group dashboard's Layout step (F3.32)", async () => {
    await aGroupDashboardsLayoutStepOffersPlantMimic();
  });

  it("selects a newly added widget for editing", async () => {
    await addingAWidgetSelectsItForEditing();
  });

  it("sends no create until the required fields are filled, then sends it (F3.85 PR 9)", async () => {
    await createIsDisabledUntilRequiredFieldsAreFilled();
  });

  it("renders an unselected widget's problem in the Layout step's summary", async () => {
    await anUnselectedWidgetsProblemRendersInTheSummary();
  });

  it("a widget problem refuses the widgets Submit (F3.85 PR 9)", async () => {
    await aWidgetProblemRefusesTheWidgetsSubmit();
  });

  it("an asset_group_admin's create form does not fetch organizations (F3.63)", async () => {
    await assetGroupAdminsCreateFormDoesNotFetchOrganizations();
  });

  it("an asset_group_admin's create form does not fetch locations (F3.63)", async () => {
    await assetGroupAdminsCreateFormDoesNotFetchLocations();
  });

  it("an asset_group_admin's create form does not fetch the admin asset-group list (F3.63)", async () => {
    await assetGroupAdminsCreateFormDoesNotFetchAdminAssetGroups();
  });

  it("an asset_group_admin's group list comes from its own /auth/me scope (F3.63)", async () => {
    await assetGroupAdminsGroupListComesFromItsOwnScope();
  });

  it("an asset_group_admin creates a group dashboard from its own scope (F3.63)", async () => {
    await assetGroupAdminCreatesAGroupDashboardFromItsOwnScope();
  });

  it("a location_admin does not fetch asset groups (F3.63, the F3.34 residual)", async () => {
    await locationAdminDoesNotFetchAssetGroups();
  });

  it("an asset_group_admin's widget inspector offers the asset chain (F3.63)", async () => {
    await assetGroupAdminsWidgetInspectorOffersTheAssetChain();
  });

  it("an asset_group_admin with no store scope gets an empty group list, not a crash (F3.63)", async () => {
    await assetGroupAdminWithNoStoreScopeGetsAnEmptyGroupList();
  });

  it("a mimic on a group dashboard is saved by the widgets Submit (F3.32 review, positive control)", async () => {
    await aMimicOnAGroupScopeLeavesCreateEnabled();
  });

  it("the create wizard's steps are Basics, Scope, Review (F3.85 PR 9)", async () => {
    await theCreateWizardStepsAreBasicsScopeReview();
  });

  it("the widgets wizard's steps are Layout, Review (F3.85 PR 9)", async () => {
    await theWidgetsWizardStepsAreLayoutReview();
  });

  it("the create body is scopeColumns(scope) plus organization, name and slug (F3.85 PR 9)", async () => {
    await theCreateBodyIsTheScopeColumnsPlusNameAndSlug();
  });

  it("no widgets wizard exists while the create is pending (F3.85 PR 9)", async () => {
    await theWidgetsWizardIsAbsentWhileTheCreateIsPending();
  });

  it("the widgets wizard opens when the create resolves (F3.85 PR 9)", async () => {
    await theWidgetsWizardOpensWhenTheCreateResolves();
  });

  it("the widgets Submit puts to the new dashboard's id (F3.85 PR 9)", async () => {
    await theWidgetsSubmitPutsToTheNewDashboard();
  });

  it("the wizard alone fires POST /dashboards with its body (F3.85 PR 9)", async () => {
    await theCreateRequestFiresWithTheWizardsBody();
  });

  it("the wizard alone sends no X-Copilot-Change header (F3.85 PR 9, plan §10.5)", async () => {
    await theCreateRequestCarriesNoCopilotHeader();
  });

  it("a Scope fill naming a location after a group choice chooses the location (F3.85 PR 9 review C3)", async () => {
    await aLocationFillAfterAGroupChoiceChoosesTheLocation();
  });

  it("a location_admin creates on its own location (review SEC-2, positive control)", async () => {
    await locationAdminCreatesOnItsOwnLocation();
  });

  it("an organization-wide fill on Review does not create for a location_admin (review SEC-2)", async () => {
    await anOrganizationWideFillOnReviewDoesNotCreateForALocationAdmin();
  });

  it("a Breaker table on an organization-wide dashboard reaches Review with the page's reason (review compliance F1)", async () => {
    await aBreakerTableOnAnOrganizationWideDashboardReachesReview();
  });

  it("a Breaker table on an organization-wide dashboard sends no PUT (review compliance F1)", async () => {
    await aBreakerTableOnAnOrganizationWideDashboardSendsNoPut();
  });

  it("cancelling click-only Layout work asks first (review C4)", async () => {
    await cancellingClickOnlyLayoutWorkAsksFirst();
  });
});

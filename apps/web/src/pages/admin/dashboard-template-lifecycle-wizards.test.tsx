// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  BODYLESS,
  aGroupBodyOnASiteTemplateIsRefusedBeforeTheWire,
  aLowercaseSlugWithASpaceStaysOnDetails,
  aRefusedPublishShowsItsErrorOnce,
  aSecondSubmitClearsTheLastRefusal,
  aSiteBodyOnAGroupTemplateIsRefusedBeforeTheWire,
  aTypedNameAsTheSlugStaysOnDetails,
  anOrganizationWideFillOnARoleBoundTemplateIsRefused,
  applyOpensAReviewOnlyWizard,
  applyResultTableListsASkippedSitesReason,
  applyReviewNamesTheOrganization,
  archiveAsksBeforeArchiving,
  archiveReviewIsTheRedCard,
  bodylessWizardAloneSendsNoCopilotHeader,
  bodylessWizardSendsTheClientRequest,
  draftWizardOpensANewDraft,
  instantiateOpensTargetDetailsReview,
  instantiateSendsTheGroupBody,
  instantiateTrimsTheSlugAndName,
  instantiateWizardAloneSendsNoCopilotHeader,
  madeSummaryCountsTheTilesLeftOut,
  noTargetPickedStopsAtReview,
  organizationWideOptionSendsANullAssetGroup,
  publishOpensAReviewOnlyWizard,
  publishSubmitPublishesOnce,
  refusedPublishShowsTheErrorOnReview,
  resolutionReportNamesAPartialWidget,
  siteInstantiateDetailsHasNoInputs,
  siteInstantiateWizardAloneSendsNoCopilotHeader,
  siteTargetShowsAFilledTabGroups,
  siteTemplateInstantiatePicksALocation,
  submittedArchiveAnnouncesArchiving,
} from "./dashboard-template-lifecycle-wizards.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 * `@vitest-environment jsdom` is on this file because Vitest reads it from
 * the file it collects (ADR 0042 decision 2).
 */
describe("F3.85 PR 10b the template lifecycle actions are catalog wizards", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("Publish opens a Review-only wizard and sends nothing yet", async () => {
    await publishOpensAReviewOnlyWizard();
  });

  it("Submit on the publish Review publishes once and closes the wizard", async () => {
    await publishSubmitPublishesOnce();
  });

  it("a refused publish shows the error on the Review", async () => {
    await refusedPublishShowsTheErrorOnReview();
  });

  it("Archive asks before it archives: Cancel posts nothing, Submit posts once (F3.73 critique)", async () => {
    await archiveAsksBeforeArchiving();
  });

  it("the archive Review is the red deactivate card with the dialog's explanation", async () => {
    await archiveReviewIsTheRedCard();
  });

  it("a submitted archive shows Archiving… with aria-busy on the page's Archive (F4.168)", async () => {
    await submittedArchiveAnnouncesArchiving();
  });

  it("Edit this version opens a Review-only draft wizard and Submit opens the draft", async () => {
    await draftWizardOpensANewDraft();
  });

  for (const [name, kind] of Object.entries(BODYLESS)) {
    it(`the ${name} wizard sends the client's POST: the path, no body, no Content-Type`, async () => {
      await bodylessWizardSendsTheClientRequest(kind);
    });

    it(`the ${name} wizard alone sends no X-Copilot-Change header`, async () => {
      await bodylessWizardAloneSendsNoCopilotHeader(kind);
    });
  }

  it("Apply to all sites opens a Review-only wizard and posts nothing yet", async () => {
    await applyOpensAReviewOnlyWizard();
  });

  it("the apply Review names the organization, never an empty name", async () => {
    await applyReviewNamesTheOrganization();
  });

  it("the apply-to-sites result lists a skipped site with its reason (F3.73)", async () => {
    await applyResultTableListsASkippedSitesReason();
  });

  it("Instantiate opens Target, Details, Review and sends nothing yet", async () => {
    await instantiateOpensTargetDetailsReview();
  });

  it("the instantiate wizard names a partial widget with its counts (ADR 0049 Amendment 2)", async () => {
    await resolutionReportNamesAPartialWidget();
  });

  it("the group arm sends the group, the slug and the seeded name", async () => {
    await instantiateSendsTheGroupBody();
  });

  it("choosing Organization-wide sends assetGroupId null", async () => {
    await organizationWideOptionSendsANullAssetGroup();
  });

  it("a typed name as the slug stays on Details; a valid slug reaches Review (PR 2 sweep)", async () => {
    await aTypedNameAsTheSlugStaysOnDetails();
  });

  it("with no group picked, Review shows the refusal and Submit sends nothing", async () => {
    await noTargetPickedStopsAtReview();
  });

  it("a padded slug and name are sent trimmed", async () => {
    await instantiateTrimsTheSlugAndName();
  });

  it("the group instantiate wizard alone sends no X-Copilot-Change header", async () => {
    await instantiateWizardAloneSendsNoCopilotHeader();
  });

  it("a site template's Details step has no name or slug input", async () => {
    await siteInstantiateDetailsHasNoInputs();
  });

  it("a site template's instantiate picks a location (F3.73)", async () => {
    await siteTemplateInstantiatePicksALocation();
  });

  it("the made summary counts the role tiles a copy left out (ADR 0087 Amendment 2)", async () => {
    await madeSummaryCountsTheTilesLeftOut();
  });

  it("the site instantiate wizard alone sends exactly { locationId } and no X-Copilot-Change header", async () => {
    await siteInstantiateWizardAloneSendsNoCopilotHeader();
  });

  it("a lowercase slug with a space keeps the space and stays on Details (review C1)", async () => {
    await aLowercaseSlugWithASpaceStaysOnDetails();
  });

  it("a second Submit clears the last refusal before it sends (review Q1)", async () => {
    await aSecondSubmitClearsTheLastRefusal();
  });

  it("a group body on a site template is refused before the wire (review Q2)", async () => {
    await aGroupBodyOnASiteTemplateIsRefusedBeforeTheWire();
  });

  it("a site body on a group template is refused before the wire (review Q2, reverse arm)", async () => {
    await aSiteBodyOnAGroupTemplateIsRefusedBeforeTheWire();
  });

  it("an organization-wide fill on a role-bound template is refused before the wire (review F2)", async () => {
    await anOrganizationWideFillOnARoleBoundTemplateIsRefused();
  });

  it("a refused publish shows its error once, in the wizard (review F1)", async () => {
    await aRefusedPublishShowsItsErrorOnce();
  });

  it("a tabGroups the copilot filled on Target is shown as text", async () => {
    await siteTargetShowsAFilledTabGroups();
  });
});

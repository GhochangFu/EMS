// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  addWidgetAddsAWidgetEditor,
  bindingTemplateHidesTheOrganizationWideOption,
  addingAMetricListsItAndHidesTheRolePicker,
  deleteDraftLandsOnTheList,
  draftShowsPublishAndDelete,
  publishedShowsArchiveAndInstantiate,
  refusedDeleteStaysOnThePage,
  deleteDraftIsDisabledWhilePublishPends,
  deleteDraftKeepsItsNameWhilePublishPends,
  publishAnnouncesPublishing,
  roleFreeTemplateOffersTheOrganizationWideOption,
  saveCanvasSendsTheStoredTabsBack,
  applyToAllSitesShowsOnlyForAPublishedSiteTemplate,
  siteTemplateCountsAndListsItsTabWidgets,
  groupTemplateCountAndEmptyMessageAreUnchanged,
  archiveIsNotAPrimaryFill,
  readOnlyNoticeGivesAPlainReason,
  saveCanvasOpensTheUpdateWizard,
  saveWizardAloneSendsNoCopilotHeader,
  updateReviewShowsCurrentBesideNew,
  saveCanvasSendsTheEditedWidgets,
  saveSendsATrimmedName,
  saveSendsNoNameForABlankOne,
  aValueChangeClearsTheSaveRefusal,
  aValueChangeShowsTheNewReviewAfterARefusal,
  saveContentStepDescribesAFilledContent,
  saveBasicsShowsAFilledSection,
  reviewShowsTheTrimmedNameAfterBlur,
} from "./dashboard-template-detail-page.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 * `@vitest-environment jsdom` is on this file because Vitest reads it from
 * the file it collects (ADR 0042 decision 2).
 */
describe("F3.36 dashboard template detail page", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("a draft offers Publish and Delete, never Archive or Instantiate", async () => {
    await draftShowsPublishAndDelete();
  });

  it("a published version offers Archive and Instantiate, never Publish or Delete", async () => {
    await publishedShowsArchiveAndInstantiate();
  });

  it("adding a widget grows the canvas with a vocabulary-fed role picker", async () => {
    await addWidgetAddsAWidgetEditor();
  });

  it("adding a metric lists it by label and hides the role picker (F3.61)", async () => {
    await addingAMetricListsItAndHidesTheRolePicker();
  });

  it("a successful Delete draft lands on the template list (F3.62)", async () => {
    await deleteDraftLandsOnTheList();
  });

  it("a refused Delete draft stays on the page with the error (F3.62)", async () => {
    await refusedDeleteStaysOnThePage();
  });

  it("a role-free template offers Organization-wide (no group) — E4.2", async () => {
    await roleFreeTemplateOffersTheOrganizationWideOption();
  });

  it("a template that binds a role does not offer it", async () => {
    await bindingTemplateHidesTheOrganizationWideOption();
  });

  it("B3 Publish announces Publishing… with aria-busy", async () => {
    await publishAnnouncesPublishing();
  });

  it("B3 Delete draft keeps its name and is not busy while Publish pends", async () => {
    await deleteDraftKeepsItsNameWhilePublishPends();
  });

  it("B3 Delete draft stays disabled while Publish pends", async () => {
    await deleteDraftIsDisabledWhilePublishPends();
  });

  it("Save canvas on a site draft sends the stored tabs back (F3.73)", async () => {
    await saveCanvasSendsTheStoredTabsBack();
  });

  it("Apply to all sites shows only for a published site template (F3.73)", async () => {
    await applyToAllSitesShowsOnlyForAPublishedSiteTemplate();
  });

  it("a site template counts its tab widgets and lists its tabs (F3.73)", async () => {
    await siteTemplateCountsAndListsItsTabWidgets();
  });

  it("a group template keeps its own count and empty message (F3.73)", async () => {
    await groupTemplateCountAndEmptyMessageAreUnchanged();
  });

  it("Archive is not a primary-filled button (F3.73 critique)", async () => {
    await archiveIsNotAPrimaryFill();
  });

  it("the read-only notice gives a plain reason, no ADR number (F3.73 critique)", async () => {
    await readOnlyNoticeGivesAPlainReason();
  });
});

describe("F3.85 PR 10a the canvas save is the dashboardTemplate.update wizard", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("Save canvas opens Basics, Content, Review and sends nothing yet", async () => {
    await saveCanvasOpensTheUpdateWizard();
  });

  it("the Review card shows the stored value under Now beside the new one", async () => {
    await updateReviewShowsCurrentBesideNew();
  });

  it("the update wizard alone sends the PATCH with no X-Copilot-Change header", async () => {
    await saveWizardAloneSendsNoCopilotHeader();
  });

  it("the PATCH sends the canvas as edited, a widget added before Save included", async () => {
    await saveCanvasSendsTheEditedWidgets();
  });

  it("a padded name is sent trimmed", async () => {
    await saveSendsATrimmedName();
  });

  it("leaving the Name field trims it, so Review shows the name Submit sends", async () => {
    await reviewShowsTheTrimmedNameAfterBlur();
  });

  it("a name of spaces is not sent", async () => {
    await saveSendsNoNameForABlankOne();
  });

  it("a value change after a refused Save clears the old error from Review", async () => {
    await aValueChangeClearsTheSaveRefusal();
  });

  it("the Review reached after a refusal shows the new value", async () => {
    await aValueChangeShowsTheNewReviewAfterARefusal();
  });

  it("the Content step counts a content the copilot filled, not the canvas", async () => {
    await saveContentStepDescribesAFilledContent();
  });

  it("the Basics step shows a section the copilot filled", async () => {
    await saveBasicsShowsAFilledSection();
  });
});

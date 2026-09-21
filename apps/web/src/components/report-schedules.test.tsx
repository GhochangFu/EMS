// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  aDeleteInFlightDisablesThatRowsEdit,
  aLocationAdminCreateBodyHasNoOrganizationIdKey,
  aLocationAdminHasNoOrganizationSelect,
  aLocationAdminHasNoWholeOrganizationOption,
  aLocationAdminReadsTheChannelSentenceInsteadOfTheSelect,
  aRefusedCreateRendersTheApiSentence,
  aTypedTimezoneSurvivesALocationChange,
  aWebhookChannelIsNotAnOption,
  anAdminHasTheWholeOrganizationOption,
  anAdminSaveSendsTheBodyByKey,
  anAdminSeesTheOrganizationSelect,
  anOrganizationAdminGetsTheChannelSelect,
  choosingAnOrganizationLoadsItsLocations,
  deleteCallsTheApiOnceAndRefetches,
  editPrefillsTheName,
  saveIsDisabledBesideTheBlockedSentence,
  selectingALocationDefaultsTheTimezoneToItsZone,
  theTimezoneDefaultsToKolkataWithNoLocationSelected,
  twoDeletesInFlightKeepBothButtonsPending,
  twoSchedulesRenderTwoRows,
  updateSendsOnlyTheChangedKey,
} from "./report-schedules.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and
 * the jsdom docblock is here because this is the file Vitest collects
 * (ADR 0042 decision 2).
 */
describe("F3.5b report schedules section", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("an admin sees the organization select", async () => {
    await anAdminSeesTheOrganizationSelect();
  });

  it("choosing an organization calls fetchAdminLocations('true', ESKOM)", async () => {
    await choosingAnOrganizationLoadsItsLocations();
  });

  it("the timezone reads Asia/Kolkata with no location selected", async () => {
    await theTimezoneDefaultsToKolkataWithNoLocationSelected();
  });

  it("selecting a location defaults the timezone to its zone", async () => {
    await selectingALocationDefaultsTheTimezoneToItsZone();
  });

  it("a typed timezone survives a later location change", async () => {
    await aTypedTimezoneSurvivesALocationChange();
  });

  it("an admin save sends the create body, asserted by key", async () => {
    await anAdminSaveSendsTheBodyByKey();
  });

  it("a webhook channel is not an option; the email one is", async () => {
    await aWebhookChannelIsNotAnOption();
  });

  it("a location_admin has no organization select", async () => {
    await aLocationAdminHasNoOrganizationSelect();
  });

  it("a location_admin has no Whole organization option", async () => {
    await aLocationAdminHasNoWholeOrganizationOption();
  });

  it("an admin has the Whole organization option", async () => {
    await anAdminHasTheWholeOrganizationOption();
  });

  it("Q-6: a location_admin reads the channel sentence instead of the select", async () => {
    await aLocationAdminReadsTheChannelSentenceInsteadOfTheSelect();
  });

  it("an organization_admin gets the channel select through the locations' organization", async () => {
    await anOrganizationAdminGetsTheChannelSelect();
  });

  it("a location_admin create body has no organizationId key", async () => {
    await aLocationAdminCreateBodyHasNoOrganizationIdKey();
  });

  it("two DTOs render two rows", async () => {
    await twoSchedulesRenderTwoRows();
  });

  it("Edit pre-fills the name", async () => {
    await editPrefillsTheName();
  });

  it("a rename PATCHes only the name key", async () => {
    await updateSendsOnlyTheChangedKey();
  });

  it("Delete calls deleteReportSchedule once and refetches the list", async () => {
    await deleteCallsTheApiOnceAndRefetches();
  });

  it("two deletes in flight keep both Delete buttons on Deleting…", async () => {
    await twoDeletesInFlightKeepBothButtonsPending();
  });

  it("a delete in flight disables that row's Edit and not the other's", async () => {
    await aDeleteInFlightDisablesThatRowsEdit();
  });

  it("a refused create renders the API's sentence", async () => {
    await aRefusedCreateRendersTheApiSentence();
  });

  it("Save is disabled beside the blocked sentence", async () => {
    await saveIsDisabledBesideTheBlockedSentence();
  });
});

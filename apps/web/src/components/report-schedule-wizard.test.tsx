// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import { resetWizardStore } from "../stores/wizard-store";
import {
  aLocationAdminCreateBodyHasNoOrganizationIdKey,
  aScopedUsersBodyNeverCarriesThePrefilledOrganization,
  aTrendPrefillShowsItsTemplateLine,
  anAdminStartsOnThePrefilledOrganization,
  anEditNeverSendsTheTemplateOrParams,
  anEnergyPrefillShowsItsTemplateLine,
  theCreateBodyCarriesTheTemplateAndParams,
  theReviewListsTheTemplate,
  withNoPrefillTheBodyHasNeitherKey,
  aLocationAdminHasNoOrganizationSelect,
  aLocationAdminHasNoWholeOrganizationOption,
  aLocationAdminReadsTheChannelSentenceInsteadOfTheSelect,
  aLocationAdminWithNoLocationSelectedIsBlockedOnTheLocation,
  anAdminHasTheWholeOrganizationOption,
  anAdminSaveSendsTheBodyByKey,
  anAdminSeesTheOrganizationSelect,
  anOrganizationAdminGetsTheChannelSelect,
  anUnchangedEditSaysNothingChanged,
  aRefusedCreateRendersTheApiSentence,
  aTypedTimezoneSurvivesALocationChange,
  aWebhookChannelIsNotAnOption,
  choosingAnOrganizationLoadsItsLocations,
  editPrefillsTheName,
  selectingALocationDefaultsTheTimezoneToItsZone,
  theLocationsPickerListsTheTree,
  theReviewSummaryNamesNoAddress,
  theTimezoneDefaultsToKolkataWithNoLocationSelected,
  updateSendsOnlyTheChangedKey,
} from "./report-schedule-wizard.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014); the jsdom docblock is here (ADR 0042). */
describe("F4.280 — the report schedule wizard (ADR 0099 decision 6)", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    resetWizardStore();
  });

  it("an admin sees the organization select", () => anAdminSeesTheOrganizationSelect());
  it("choosing an organization loads its locations", () => choosingAnOrganizationLoadsItsLocations());
  it("the timezone reads Asia/Kolkata with no location selected", () => theTimezoneDefaultsToKolkataWithNoLocationSelected());
  it("selecting a location defaults the timezone to its zone", () => selectingALocationDefaultsTheTimezoneToItsZone());
  it("a typed timezone survives a later location change", () => aTypedTimezoneSurvivesALocationChange());
  it("an admin submit sends the create body, asserted by key", () => anAdminSaveSendsTheBodyByKey());
  it("the Review summary names no address", () => theReviewSummaryNamesNoAddress());
  it("a webhook channel is not an option", () => aWebhookChannelIsNotAnOption());
  it("a location_admin has no organization select", () => aLocationAdminHasNoOrganizationSelect());
  it("a location_admin has no Whole organization option", () => aLocationAdminHasNoWholeOrganizationOption());
  it("an admin has the Whole organization option", () => anAdminHasTheWholeOrganizationOption());
  it("Q-6: a location_admin reads the channel sentence", () => aLocationAdminReadsTheChannelSentenceInsteadOfTheSelect());
  it("an organization_admin gets the channel select", () => anOrganizationAdminGetsTheChannelSelect());
  it("a location_admin create body has no organizationId key", () => aLocationAdminCreateBodyHasNoOrganizationIdKey());
  it("a location_admin with no location reads the blocked sentence", () => aLocationAdminWithNoLocationSelectedIsBlockedOnTheLocation());
  it("the Locations picker lists the tree", () => theLocationsPickerListsTheTree());
  it("an edit pre-fills the name", () => editPrefillsTheName());
  it("a rename PATCHes only the name key", () => updateSendsOnlyTheChangedKey());
  it("an unchanged edit says Nothing changed yet and sends nothing", () => anUnchangedEditSaysNothingChanged());
  it("a refused create renders the API's sentence", () => aRefusedCreateRendersTheApiSentence());

  // F4.303 U16 (ADR 0108 Amendment 6 item 6): the wizard prefilled from a view.
  it("a trend prefill shows its template line", () => aTrendPrefillShowsItsTemplateLine());
  it("an energy prefill shows its template line", () => anEnergyPrefillShowsItsTemplateLine());
  it("the Review step lists the template", () => theReviewListsTheTemplate());
  it("the create body carries the template and params", () => theCreateBodyCarriesTheTemplateAndParams());
  it("with no prefill the body has neither key", () => withNoPrefillTheBodyHasNeitherKey());
  it("an edit never sends the template or params", () => anEditNeverSendsTheTemplateOrParams());
  it("a scoped user's body never carries the prefilled organization", () => aScopedUsersBodyNeverCarriesThePrefilledOrganization());
  it("an admin starts on the prefilled organization", () => anAdminStartsOnThePrefilledOrganization());
});

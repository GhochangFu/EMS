// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  aRefusalShowsTheServersSentence,
  anAttachmentConflictShowsTheServersSentence,
  anAttachmentSwitchLeftOnCanBeTurnedOffWhileTheCopilotIsOff,
  theAttachmentSwitchIsDisabledWhileTheCopilotIsOff,
  theOrganizationAdminSetsTheAttachmentSwitch,
  aRoleSwitchSendsOnlyThatRole,
  aSavedPickResetsThePicker,
  anExceptionIsListedAndRemoved,
  theGlobalAdminSwitchesTheOrganizationOn,
  theOrganizationAdminCannotChangeTheOrganizationSwitch,
  thePickerOffersOnlyThisOrganizationsAdministrators,
} from "./copilot-access-card.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, ADR 0042 decision 2). */
describe("F3.85 Copilot access card", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("lets the global admin switch the organization on", () => theGlobalAdminSwitchesTheOrganizationOn());
  it("keeps the organization switch from the organization admin", () =>
    theOrganizationAdminCannotChangeTheOrganizationSwitch());
  it("sends only the role switch that changed", () => aRoleSwitchSendsOnlyThatRole());
  it("offers only this organization's administrators for an exception", () =>
    thePickerOffersOnlyThisOrganizationsAdministrators());
  it("resets the picker once a pick is saved", () => aSavedPickResetsThePicker());
  it("lists an exception by name and removes it", () => anExceptionIsListedAndRemoved());
  it("shows the server's sentence on a refusal", () => aRefusalShowsTheServersSentence());
  it("lets the organization admin set the attachment switch (F3.87)", () =>
    theOrganizationAdminSetsTheAttachmentSwitch());
  it("disables the attachment switch while the copilot is off (F3.87)", () =>
    theAttachmentSwitchIsDisabledWhileTheCopilotIsOff());
  it("lets a switch left on be turned off while the copilot is off (F3.87)", () =>
    anAttachmentSwitchLeftOnCanBeTurnedOffWhileTheCopilotIsOff());
  it("shows the server's sentence on an attachment conflict (F3.87)", () =>
    anAttachmentConflictShowsTheServersSentence());
});

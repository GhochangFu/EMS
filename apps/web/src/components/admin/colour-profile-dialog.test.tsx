// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  d1TheSixProfilesAreOfferedWithTheCurrentOneChosen,
  d2ChoosingAProfilePreviewsItAndCancelRestores,
  d3SaveSendsThePutReReadsMeAndRefreshesTheList,
  d4ARefusalShowsTheServersSentenceAndKeepsTheDialog,
  d5SaveIsBusyAndTheChoiceLockedWhileSaving,
} from "./colour-profile-dialog.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, ADR 0042 decision 2). */
describe("F4.310 colour-profile chooser (ADR 0110 decision 8)", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    localStorage.clear();
    document.documentElement.removeAttribute("data-profile");
  });

  it("D1 offers the six profiles with the current one chosen", () => d1TheSixProfilesAreOfferedWithTheCurrentOneChosen());
  it("D2 a choice previews the page; Cancel restores", () => d2ChoosingAProfilePreviewsItAndCancelRestores());
  it("D3 Save sends the PUT, re-reads /auth/me and refreshes the list", () => d3SaveSendsThePutReReadsMeAndRefreshesTheList());
  it("D4 a refusal shows the server's sentence and keeps the dialog", () => d4ARefusalShowsTheServersSentenceAndKeepsTheDialog());
  it("D5 Save is busy and the choice is locked while saving", () => d5SaveIsBusyAndTheChoiceLockedWhileSaving());
});

// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  aChoicePreviewsAndCancelRestores,
  inheritWritesNullAndPreviewsTheInheritedValue,
  myDialogStartsFromMeAndWritesMyRow,
  saveWritesReReadsMeAndCloses,
  theOrganizationDialogWritesItsRowAndInheritsThePortal,
  thePortalLevelHasNoInherit,
} from "./appearance-panel.spec";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
  document.documentElement.removeAttribute("data-design");
  document.documentElement.removeAttribute("data-profile");
});

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.341 the Appearance panel (ADR 0118 decision 11)", () => {
  it("AP1 a choice previews the page; Cancel restores the viewer's own look", () => aChoicePreviewsAndCancelRestores());
  it("AP2 Save writes the values, re-reads /auth/me and closes", () => saveWritesReReadsMeAndCloses());
  it("AP3 Inherit writes null and previews the inherited value", () => inheritWritesNullAndPreviewsTheInheritedValue());
  it("AP4 the portal level has no Inherit", () => thePortalLevelHasNoInherit());
  it("AP5 the organization dialog inherits the portal default and writes its row", () => theOrganizationDialogWritesItsRowAndInheritsThePortal());
  it("AP6 my dialog starts from /auth/me and writes my row", () => myDialogStartsFromMeAndWritesMyRow());
});

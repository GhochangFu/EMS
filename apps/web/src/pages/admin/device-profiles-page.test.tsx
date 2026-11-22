// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  aStaleSaveShowsTheReloadMessage,
  copyAsksForANewCode,
  editOpensAndSavesTheNewestVersion,
  anOrganizationSwitchClearsTheImportMessages,
  failsClosedForALocationAdmin,
  importingAHeldCodeAsksFirst,
  importListsTheStockEntries,
  listsOneRowPerCodeAtItsNewestVersion,
} from "./device-profiles-page.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, ADR 0042 decision 2). */
describe("F1.2 Device Profiles admin page", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("P1 lists one row per code at its newest version, with vendor, model, register count and the Unverified pill", () =>
    listsOneRowPerCodeAtItsNewestVersion());
  it("P2 Edit opens the newest version and Save posts that row's id and version", () =>
    editOpensAndSavesTheNewestVersion());
  it("P3 a stale save shows the reload message, and Reload reads the list again", () =>
    aStaleSaveShowsTheReloadMessage());
  it("P4 Import lists the stock entries and posts the chosen code with the organization", () =>
    importListsTheStockEntries());
  it("P5 Copy asks for a new code and posts the newest row's id", () => copyAsksForANewCode());
  it("P7 a stock code the organization holds says so, and its Import asks first", () =>
    importingAHeldCodeAsksFirst());
  it("P8 an organization switch clears the import panel's messages", () =>
    anOrganizationSwitchClearsTheImportMessages());
  it("P6 fails closed for a location_admin: the sentence, no list, no request", () => failsClosedForALocationAdmin());
});

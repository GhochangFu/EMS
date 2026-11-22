// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  aConflictShowsTheStaleMessage,
  aDuplicateSourceKeyMarksTheSecondRow,
  aNewProfilePostsVersionOne,
  addsEditsAndRemovesARegisterRow,
  savePostsANewVersionAndNeverAPatch,
  showsTheSharedSchemasMessageOnTheFailingRow,
} from "./device-profile-editor.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, ADR 0042 decision 2). */
describe("F1.2 device profile editor", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("E1 adds, edits and removes a register row, and Save sends the rows in order", () =>
    addsEditsAndRemovesARegisterRow());
  it("E2 shows the shared schema's message on the failing row only, and sends nothing", () =>
    showsTheSharedSchemasMessageOnTheFailingRow());
  it("E3 a duplicate sourceKey marks the second row", () => aDuplicateSourceKeyMarksTheSecondRow());
  it("E4 Save posts /:id/versions with the opened row's version as baseVersion, never a PATCH", () =>
    savePostsANewVersionAndNeverAPatch());
  it("E5 a new profile posts /admin/device-profiles with the organization and the code", () =>
    aNewProfilePostsVersionOne());
  it("E6 a 409 shows the stale message and a Reload", () => aConflictShowsTheStaleMessage());
});

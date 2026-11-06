import { afterEach, describe, it, vi } from "vitest";

import {
  makeSendsAnEmptyPut,
  makeThrowsTheConflictWithItsBody,
  resetSendsADelete,
  resetThrowsOn403,
  theViewReadHitsTheOrganizationPath,
  theViewReadThrowsOn404,
  theViewReadThrowsOnSchemaMismatch,
} from "./control-room-organization.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, §4.6). `node`
 * environment, not jsdom.
 */
describe("F4.317 organization strip clients — what they put on the wire", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("O1 reads GET /control-room/organizations/:id/view with the bearer token", async () => {
    await theViewReadHitsTheOrganizationPath();
  });

  it("O2 throws an ApiError carrying a 404", async () => {
    await theViewReadThrowsOn404();
  });

  it("O3 throws when the body fails the contract", async () => {
    await theViewReadThrowsOnSchemaMismatch();
  });

  it("O4 makes the layout with a PUT of an empty object", async () => {
    await makeSendsAnEmptyPut();
  });

  it("O5 throws the 409 with its body", async () => {
    await makeThrowsTheConflictWithItsBody();
  });

  it("O6 resets with a DELETE", async () => {
    await resetSendsADelete();
  });

  it("O7 throws an ApiError carrying a refused reset", async () => {
    await resetThrowsOn403();
  });
});

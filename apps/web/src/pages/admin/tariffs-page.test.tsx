// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import * as spec from "./tariffs-page.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, §4.6); the jsdom
 * docblock is on this file because Vitest reads it from the file it collects (ADR 0042).
 */
const BUDGET_MS = 20_000;

describe("F4.365 U9 Admin → Tariffs", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("the list narrows by state and segment", async () => {
    await spec.theListNarrowsByStateAndSegment();
  });

  it("a secondary line shows Verify in the list; an official one does not", async () => {
    await spec.aSecondaryLineShowsVerifyInTheList();
  });

  it("opening a line reads its versions by key", async () => {
    await spec.openingALineReadsItsVersionsByKey();
  });

  it("the source URL is a noopener noreferrer link", async () => {
    await spec.theSourceUrlIsANoopenerLink();
  });

  it("a version in force, or the catalog's, has no Edit or Delete", async () => {
    await spec.aLockedVersionHasNoEditOrDelete();
  });

  it("a location_admin sees no write control", async () => {
    await spec.aLocationAdminSeesNoWriteControl();
  });

  it("the revision body carries kind revision and no descriptive field", async () => {
    await spec.theRevisionBodyCarriesKindRevisionAndNoDescriptiveField();
  }, BUDGET_MS);

  it("the grid derives each From from the previous To", async () => {
    await spec.theGridDerivesEachFromFromThePreviousTo();
  }, BUDGET_MS);

  it("an open middle slab is held without a request", async () => {
    await spec.anOpenMiddleSlabIsHeldWithoutARequest();
  }, BUDGET_MS);

  it("the server's 409 sentence is rendered", async () => {
    await spec.theServerConflictSentenceIsRendered();
  }, BUDGET_MS);

  it("the custom body carries the custom key and its fields", async () => {
    await spec.theCustomBodyCarriesTheCustomKeyAndItsFields();
  }, BUDGET_MS);

  it("Edit and Delete address the editable version", async () => {
    await spec.editAndDeleteAddressTheEditableVersion();
  }, BUDGET_MS);
});

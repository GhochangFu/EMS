// @vitest-environment jsdom
// Pinned to a non-UTC zone BEFORE anything reads the clock: in UTC the
// wall-clock-as-UTC bug and the correct local-zone conversion are
// observationally identical, so the ISO-offset case would pass in CI for
// the implementation it exists to forbid (PR 2 code review; the F4.40 shape).
// (`process` is reached through `globalThis`: the web tsconfig carries no Node types.)
(globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env.TZ = "Asia/Kolkata";
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  adminHasTheOrganizationRadio,
  deleteAsksBeforeSending,
  editDisablesKeyAndScope,
  keySelectOffersExactlyTheFetchedKeys,
  locationAdminDefaultsToLocationScope,
  locationAdminHasNoOrganizationRadio,
  rendersRowsWithAllThreeScopeLabels,
  rendersTheServerConflictSentenceVerbatim,
  submitsTheChosenScopeAndIsoDates,
} from "./calc-parameters-page.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 *
 * The `@vitest-environment jsdom` docblock is on THIS file because Vitest
 * reads it from the file it collects (ADR 0042 decision 2). The project
 * default stays `node`.
 */
describe("E4.1a calc parameters page", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders the mocked rows with all three scope labels", async () => {
    await rendersRowsWithAllThreeScopeLabels();
  });

  it("as location_admin the form has no Organization radio", async () => {
    await locationAdminHasNoOrganizationRadio();
  });

  it("as location_admin the Location radio is the checked default", async () => {
    await locationAdminDefaultsToLocationScope();
  });

  it("as admin the Organization radio is present and the default", async () => {
    await adminHasTheOrganizationRadio();
  });

  it("offers exactly the fetched keys in the key select", async () => {
    await keySelectOffersExactlyTheFetchedKeys();
  });

  it("creates with the chosen scope and ISO dates with an offset", async () => {
    await submitsTheChosenScopeAndIsoDates();
  });

  it("renders the server's 409 sentence verbatim under the form", async () => {
    await rendersTheServerConflictSentenceVerbatim();
  });

  it("edit opens the form with key and scope disabled and sends only the editable fields", async () => {
    await editDisablesKeyAndScope();
  });

  it("delete asks with confirm() before sending", async () => {
    await deleteAsksBeforeSending();
  });
});

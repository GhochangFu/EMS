// @vitest-environment jsdom
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

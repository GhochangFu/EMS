// @vitest-environment jsdom
import { afterEach, describe, it } from "vitest";

import {
  aFailedDetailReadKeepsItsRow,
  aFailedReadShowsUnavailable,
  anEmptyListShowsTheSentence,
  aPendingDetailReadShowsTheLoadingLine,
  aPendingReadShowsTheLoadingLine,
  aRowNotScopedAtTheLocationIsNotDetailRead,
  aSiteReadsByItsLocationId,
  cleanupList,
  eachRowOpensTheViewerWithItsOrganization,
  omitsTheTemplateCopy,
  readsTheListByTheOrganizationId,
  theEstateReadsWithNoOrganization,
  theKeyCarriesTheLocationId,
  withoutThePropEveryRowIsListed,
} from "./scoped-dashboards-list.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and
 * the jsdom docblock is here because this is the file Vitest collects
 * (ADR 0042 decision 2).
 */
describe("F3.72 U1 ScopedDashboardsList (D7)", () => {
  afterEach(() => {
    cleanupList();
  });

  it("reads the list by the organization id", async () => {
    await readsTheListByTheOrganizationId();
  });

  it("reads the estate list with no filter", async () => {
    await theEstateReadsWithNoOrganization();
  });

  it("reads a site's list by its location id", async () => {
    await aSiteReadsByItsLocationId();
  });

  it("keeps a site's list apart from its organization's: the key carries the location", async () => {
    await theKeyCarriesTheLocationId();
  });

  it("opens each row in the viewer with the row's own organization", async () => {
    await eachRowOpensTheViewerWithItsOrganization();
  });

  it("shows 'No dashboards for this scope.' for an empty list", async () => {
    await anEmptyListShowsTheSentence();
  });

  it("shows 'Dashboards unavailable.' when the read fails", async () => {
    await aFailedReadShowsUnavailable();
  });

  it("shows the loading line while the read is pending", async () => {
    await aPendingReadShowsTheLoadingLine();
  });

  it("D1 F4.240 omitTemplateCopies leaves out the row whose detail carries a templateId", async () => {
    await omitsTheTemplateCopy();
  });

  it("D2 F4.240 without omitTemplateCopies lists every row and reads no detail", async () => {
    await withoutThePropEveryRowIsListed();
  });

  it("D3 F4.240 a failed detail read keeps its row", async () => {
    await aFailedDetailReadKeepsItsRow();
  });

  it("D4 F4.240 a row not scoped at the location is listed and never detail-read", async () => {
    await aRowNotScopedAtTheLocationIsNotDetailRead();
  });

  it("D5 F4.240 a pending detail read shows the loading line and no row", async () => {
    await aPendingDetailReadShowsTheLoadingLine();
  });
});

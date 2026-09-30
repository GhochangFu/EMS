// @vitest-environment jsdom
import { afterEach, describe, it } from "vitest";

import {
  aFailedReadShowsUnavailable,
  anEmptyListShowsTheSentence,
  aPendingReadShowsTheLoadingLine,
  aSiteReadsByItsLocationId,
  cleanupList,
  eachRowOpensTheViewerWithItsOrganization,
  readsTheListByTheOrganizationId,
  theEstateReadsWithNoOrganization,
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
});

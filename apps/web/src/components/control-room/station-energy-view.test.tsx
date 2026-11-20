// @vitest-environment jsdom
import { afterEach, describe, it } from "vitest";

import {
  cleanupStationEnergy,
  noEnergyShownShowsOnlyTheTrendsLinks,
  noSegmentReadAndNoSiteTrendsView,
  oneTrendsLinkPerSite,
  theEnergyViewIsTheStationsWithTheSiteBills,
  theRangeZoneIsTheOrganizationViewsZone,
} from "./station-energy-view.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, ADR 0042 decision 2). */
describe("F4.240 part b StationEnergyView (ADR 0140 decision 3f)", () => {
  afterEach(() => {
    cleanupStationEnergy();
  });

  it("EV1 the energy view is the station's, with the sites' bills in its bill slot", async () => {
    await theEnergyViewIsTheStationsWithTheSiteBills();
  });

  it("EV2 mounts no SiteTrendsView and makes no segment read", async () => {
    await noSegmentReadAndNoSiteTrendsView();
  });

  it("EV3 one Trends link per site, to the site's own tab", async () => {
    await oneTrendsLinkPerSite();
  });

  it("EV4 the range controls take the zone from the organization-views answer", async () => {
    await theRangeZoneIsTheOrganizationViewsZone();
  });

  it("EV5 with no site showing energy, only the Trends links show", async () => {
    await noEnergyShownShowsOnlyTheTrendsLinks();
  });
});

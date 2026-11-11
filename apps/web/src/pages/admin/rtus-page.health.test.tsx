// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  aGlobalAdminSeesUnregisteredDevices,
  aMarkupSourceKeyRendersAsText,
  anEdgeServedRtuCarriesTheMarker,
  anOrganizationAdminSeesNoUnregisteredDevices,
  aSimulatorRtuReadsNotMonitored,
  eachStateRendersItsExactLabel,
  lastSeenIsRelativeWithAnAbsoluteTitle,
  noBannerWhileTheHostIsOk,
  skewIsHighlightedBeyondThreeHundredSecondsOnly,
  theBannerShowsOnlyWhenTheHostIsNotOk,
  theDropsCellOpensTheHistoryDrawer,
  theHeaderTilesCountMonitoredRtus,
  theListSurvivesAFailedHealthRead,
} from "./rtus-page.health.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and
 * the jsdom docblock is here because this is the file Vitest collects
 * (ADR 0042 decision 2).
 */
describe("F3.16 RTUs admin page — device health (ADR 0127)", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("H1 each state renders its exact label", async () => {
    await eachStateRendersItsExactLabel();
  });

  it("H2 last seen is relative with an absolute title, Never without a sample", async () => {
    await lastSeenIsRelativeWithAnAbsoluteTitle();
  });

  it("H3 clock skew is highlighted beyond ±300 s and not at 300 s", async () => {
    await skewIsHighlightedBeyondThreeHundredSecondsOnly();
  });

  it("H4 a source key with markup renders as literal text", async () => {
    await aMarkupSourceKeyRendersAsText();
  });

  it("H5 a simulator RTU reads Not monitored", async () => {
    await aSimulatorRtuReadsNotMonitored();
  });

  it("H6 an edge-served RTU carries the Edge marker", async () => {
    await anEdgeServedRtuCarriesTheMarker();
  });

  it("H7 the header tiles count monitored RTUs", async () => {
    await theHeaderTilesCountMonitoredRtus();
  });

  it("H8 the ingest-host banner shows when the host is not ok", async () => {
    await theBannerShowsOnlyWhenTheHostIsNotOk();
  });

  it("H8b no banner while the host is ok", async () => {
    await noBannerWhileTheHostIsOk();
  });

  it("H9 a global admin sees the unregistered devices, as text", async () => {
    await aGlobalAdminSeesUnregisteredDevices();
  });

  it("H9b an organization admin sees no unregistered devices", async () => {
    await anOrganizationAdminSeesNoUnregisteredDevices();
  });

  it("H10 the RTU list survives a failed device-health read", async () => {
    await theListSurvivesAFailedHealthRead();
  });

  it("H11 the Drops cell opens the drop history drawer", async () => {
    await theDropsCellOpensTheHistoryDrawer();
  });
});

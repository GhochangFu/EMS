import { afterAll, beforeAll, describe, it } from "vitest";

import { requireIntegrationDb } from "../testing/integration-db-gate";
import { requireIntegrationStorage } from "../testing/integration-storage-gate";
import { openReportFileFixtures, type OpenReportFileFixtures, type ReportFileIntegrationFixtures } from "./report-files.integration.spec";
import { aSiteFilteredSaveStoresTheNamedSite, theSitesLocationAdminListsTheFilteredFile } from "./report-files.scope.integration.spec";

/**
 * `F4.290` — Vitest entry point for the save's site filter against Postgres
 * and MinIO. Assertions live in the sibling `.spec` (§4.6); the lifecycle is
 * `report-files.integration.spec.ts`'s `openReportFileFixtures`.
 */
const connectionString = requireIntegrationDb({
  item: "F4.290",
  label: "report file site filter integration tests",
  because:
    "these are the only tests that prove a site-filtered save stores the named site in location_ids " +
    "and that the R-7 list predicate then lists it to that site's location admin.",
});

const storageConfig = requireIntegrationStorage({
  item: "F4.290",
  label: "report file site filter integration tests",
  because: "the save puts its rendered object before the row is written (ADR 0071 decision 5).",
});

describe.skipIf(!connectionString || !storageConfig)("F4.290 — a site-filtered save against MinIO and Postgres", () => {
  let opened: OpenReportFileFixtures | undefined;
  let fx: ReportFileIntegrationFixtures;

  beforeAll(async () => {
    opened = await openReportFileFixtures(connectionString as string, storageConfig!, "F4.290");
    fx = opened.fx;
  });

  afterAll(async () => {
    await opened?.close();
  });

  it("a site-filtered save stores the named site in location_ids", () => aSiteFilteredSaveStoresTheNamedSite(fx));
  it("the site's location admin lists the filtered file", () => theSitesLocationAdminListsTheFilteredFile(fx));
});

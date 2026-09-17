import { describe, it } from "vitest";

import {
  assertAnAssetWithNoViewsWrittenIsNotReportedCreated,
  assertANonConflictErrorStopsTheCallUntouched,
  assertASlugConflictIsCountedSeparatelyFromTheSkipSet,
  assertASlugConflictSkipsOneAssetAndTheCallCarriesOn,
  assertEveryChunkLeavesItsOwnAuditRow,
  assertEveryChunkStillRunsAfterASlugConflict,
  assertTheBackfillAsksForTheConfigurationWriteRole,
  assertTheBackfillSplitsIntoChunksThatFitTheCap,
  assertTheChunkAuditRowCountsItsOwnConflicts,
  assertTheConflictingAssetReportsNoDashboards,
  assertTheResultCarriesEveryChunksDashboards,
  assertTheSkipSetIsStampedOnTheFirstChunkOnly,
} from "./asset-dashboards-backfill.spec";

/**
 * `F3.2` / ADR 0067 Q7 — Vitest entry point for the chunked backfill.
 * Assertions live in the sibling `.spec` (§4.6 / ADR 0014). No database: see
 * that file's docblock for why each claim is provable without one.
 *
 * One claim per `it()`: `expect` throws, so grouping them would leave every
 * assertion after the first unreached on a failure.
 */
describe("F3.2 — the backfill runs in chunks that fit the widget-row bound", () => {
  it("B1: splits the estate into chunks that fit the cap, in code order", async () => {
    await assertTheBackfillSplitsIntoChunksThatFitTheCap();
  });

  it("B1b: writes one audit row per chunk, carrying chunkIndex and chunkCount", async () => {
    await assertEveryChunkLeavesItsOwnAuditRow();
  });

  it("B1d: stamps the call-wide skip set on the first chunk's audit row only", async () => {
    await assertTheSkipSetIsStampedOnTheFirstChunkOnly();
  });

  it("B1c: returns every chunk's dashboards, not the last chunk's alone", async () => {
    await assertTheResultCarriesEveryChunksDashboards();
  });

  it("B2: does not report an asset created when nothing was written for it", async () => {
    await assertAnAssetWithNoViewsWrittenIsNotReportedCreated();
  });

  it("B3: lets an error that is not a slug collision stop the call, untouched", async () => {
    await assertANonConflictErrorStopsTheCallUntouched();
  });

  it("B5: skips only the asset whose slug is taken, and carries on", async () => {
    await assertASlugConflictSkipsOneAssetAndTheCallCarriesOn();
  });

  it("B5b: runs every chunk after a slug collision", async () => {
    await assertEveryChunkStillRunsAfterASlugConflict();
  });

  it("B5c: counts a slug collision apart from the skip set", async () => {
    await assertASlugConflictIsCountedSeparatelyFromTheSkipSet();
  });

  it("B5d: reports no dashboards for the conflicting asset alone", async () => {
    await assertTheConflictingAssetReportsNoDashboards();
  });

  it("B5e: counts each chunk's own conflicts on its own audit row", async () => {
    await assertTheChunkAuditRowCountsItsOwnConflicts();
  });

  it("B4: asks for the configuration write role before it reads the estate", async () => {
    await assertTheBackfillAsksForTheConfigurationWriteRole();
  });
});

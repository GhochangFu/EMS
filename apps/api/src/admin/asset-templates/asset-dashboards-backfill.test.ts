import { describe, it } from "vitest";

import {
  assertAFailingChunkReportsWhatEarlierChunksCreated,
  assertAnAssetWithNoViewsWrittenIsNotReportedCreated,
  assertEveryChunkLeavesItsOwnAuditRow,
  assertTheBackfillAsksForTheConfigurationWriteRole,
  assertTheBackfillSplitsIntoChunksThatFitTheCap,
  assertTheResultCarriesEveryChunksDashboards,
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

  it("B1c: returns every chunk's dashboards, not the last chunk's alone", async () => {
    await assertTheResultCarriesEveryChunksDashboards();
  });

  it("B2: does not report an asset created when nothing was written for it", async () => {
    await assertAnAssetWithNoViewsWrittenIsNotReportedCreated();
  });

  it("B3: stops at the first failing chunk and says how many assets were created", async () => {
    await assertAFailingChunkReportsWhatEarlierChunksCreated();
  });

  it("B4: asks for the configuration write role before it reads the estate", async () => {
    await assertTheBackfillAsksForTheConfigurationWriteRole();
  });
});

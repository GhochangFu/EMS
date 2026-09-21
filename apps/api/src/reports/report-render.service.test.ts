import { describe, it } from "vitest";

import * as spec from "./report-render.service.spec";

/** `F3.5b` — `ReportRenderService.render` (phase A) over fakes. Assertions live in the sibling `.spec.ts` (§4.6). */
describe("F3.5b ReportRenderService — the gate, the schedule, the scope (R-9)", () => {
  it("throws the storage 503 before any read when unconfigured", spec.assertUnconfiguredStorageThrowsBeforeAnyRead);
  it("an absent schedule is the skipped/absent outcome", spec.assertAbsentScheduleIsSkipped);
  it("an absent schedule writes nothing (no put, render or insert)", spec.assertAbsentScheduleWritesNothing);
  it("a disabled schedule is the skipped/disabled outcome", spec.assertDisabledScheduleIsSkipped);
  it("a disabled schedule writes nothing", spec.assertDisabledScheduleWritesNothing);
  it("resolves the assets on the transaction, not a fleet pool", spec.assertAssetsResolveOnTheTransaction);
  it("structural control: slot 1 is STORAGE_CLIENT — the service injects no fleet handle", spec.assertStorageClientIsSlotOne);
  it("location_ids = {} selects every asset the policy shows", spec.assertEmptyLocationIdsSelectsEveryAsset);
  it("named locations filter the assets with location_id = ANY($ids)", spec.assertNamedLocationsFilterTheAssets);
  it("the render receives the period and the resolved asset ids", spec.assertTheRenderReceivesTheResolvedAssetIds);
});

describe("F3.5b ReportRenderService — files, objects, rows (R-9)", () => {
  it("renders one file and one object per format", spec.assertRendersOneFileAndObjectPerFormat);
  it("per format: unique check, render, put, insert; then the prune select", spec.assertObjectThenRowPerFormatThenPrune);
  it("every row carries created_by = NULL", spec.assertInsertsCarryCreatedByNull);
  it("every row carries schedule_id, the copied location_ids, delivery none and the template", spec.assertInsertsCarryTheScheduleIdAndCopiedLocationIds);
  it("the filename is built from the two dates and the format", spec.assertTheFilenameComesFromTheDatesAndTheFormat);
  it("the key is buildReportObjectKey({ organizationId, fileId }) on the put and on the row", spec.assertTheKeyIsBuiltFromTheOrganizationAndTheRowId);
  it("byteSize comes from the rendered buffer", spec.assertHashAndSizeComeFromTheBuffer);
  it("the schedule name reaches no insert value, put key, log line or filename", spec.assertTheScheduleNameReachesNoValueKeyLogOrFilename);
  it("countReportFileWritten ticks pdf then xlsx", spec.assertCountsWrittenPdfThenXlsx);
  it("only the formats the schedule names are rendered", spec.assertOnlyTheFormatsTheScheduleNamesAreRendered);
  it("a format whose unique row exists is skipped: one put, the other format", spec.assertSkipsAFormatWhoseUniqueRowExistsPutsOnlyTheOther);
  it("a format whose unique row exists counts skippedExisting", spec.assertSkipsAFormatWhoseUniqueRowExistsCountsIt);
  it("the unique check carries the format (xlsx is not skipped by the pdf row)", spec.assertTheUniqueCheckNamesScheduleAndPeriodEndAndFormat);
});

describe("F3.5b ReportRenderService — prune and the throw (R-9)", () => {
  it("prunes the overflow rows in phase A with one row delete", spec.assertPrunesTheOverflowRowsInPhaseA);
  it("the pruned keys are carried in the outcome by file id", spec.assertPrunedKeysAreCarriedInTheOutcome);
  it("render deletes no object — that is for finish", spec.assertRenderDeletesNoObject);
  it("no overflow means no row delete", spec.assertNoOverflowMeansNoRowDelete);
  it("a throw after a put discards exactly the objects of this run", spec.assertAThrowAfterAPutDiscardsThisRunsObjects);
  it("a throw after a put rethrows the original error", spec.assertAThrowAfterAPutRethrows);
  it("the throw warns with the schedule id and err.name, never a key", spec.assertAThrowWarnsWithTheScheduleIdAndErrNameNeverTheKey);
});

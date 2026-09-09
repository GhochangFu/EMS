import type { RejectedRowDto, TelemetryImportCommitDto, TelemetryImportPreviewDto } from "@bms/shared";

import {
  describeImportUploadError,
  groupRejectionsByReason,
  summarizeCommit,
  summarizePreview,
} from "./telemetry-import-preview";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function rejection(overrides: Partial<RejectedRowDto> & { rowNumber: number }): RejectedRowDto {
  return { field: null, reason: "some reason", ...overrides };
}

/** Coverage for the pure telemetry-import preview/commit formatting (`F1.9`). */
export function runGroupRejectionsByReasonTests(): void {
  assert(groupRejectionsByReason([]).length === 0, "no rejections must produce no groups");

  const grouped = groupRejectionsByReason([
    rejection({ rowNumber: 2, reason: "value must be a finite number" }),
    rejection({ rowNumber: 5, reason: "value must be a finite number" }),
    rejection({ rowNumber: 3, reason: "time must be a parsable timestamp" }),
  ]);
  assert(grouped.length === 2, `expected 2 distinct reasons, got ${grouped.length}`);
  assert(
    grouped[0]?.reason === "value must be a finite number" && JSON.stringify(grouped[0]?.rowNumbers) === "[2,5]",
    `expected the first group to be value/[2,5], got ${JSON.stringify(grouped[0])}`,
  );
  assert(
    grouped[1]?.reason === "time must be a parsable timestamp" && JSON.stringify(grouped[1]?.rowNumbers) === "[3]",
    `expected the second group to be time/[3], got ${JSON.stringify(grouped[1])}`,
  );

  // Group order follows first appearance, not alphabetical or numeric sort.
  const reordered = groupRejectionsByReason([
    rejection({ rowNumber: 9, reason: "b" }),
    rejection({ rowNumber: 1, reason: "a" }),
  ]);
  assert(
    reordered[0]?.reason === "b" && reordered[1]?.reason === "a",
    "groups must appear in first-seen order, not sorted",
  );
}

function preview(overrides: Partial<TelemetryImportPreviewDto> = {}): TelemetryImportPreviewDto {
  return { totalRows: 0, acceptedCount: 0, rejectedCount: 0, rejected: [], ...overrides };
}

export function runSummarizePreviewTests(): void {
  assert(
    summarizePreview(preview({ totalRows: 0 })) === "The file has no data rows.",
    "an empty file must say so plainly",
  );

  assert(
    summarizePreview(preview({ totalRows: 5, acceptedCount: 5, rejectedCount: 0 })) ===
      "All 5 rows look ready to import (final checks happen on commit).",
    `unexpected all-accepted summary: "${summarizePreview(preview({ totalRows: 5, acceptedCount: 5, rejectedCount: 0 }))}"`,
  );

  assert(
    summarizePreview(preview({ totalRows: 1, acceptedCount: 1, rejectedCount: 0 })) ===
      "All 1 row looks ready to import (final checks happen on commit).",
    "a single accepted row must use singular grammar",
  );

  assert(
    summarizePreview(preview({ totalRows: 5, acceptedCount: 0, rejectedCount: 5 })) ===
      "None of the 5 rows can be imported — every row was rejected.",
    "an all-rejected file must say so plainly",
  );

  assert(
    summarizePreview(preview({ totalRows: 5, acceptedCount: 3, rejectedCount: 2 })) ===
      "3 of 5 rows look ready to import (final checks happen on commit); 2 rejected.",
    `unexpected mixed summary: "${summarizePreview(preview({ totalRows: 5, acceptedCount: 3, rejectedCount: 2 }))}"`,
  );
}

function commit(overrides: Partial<TelemetryImportCommitDto> = {}): TelemetryImportCommitDto {
  return {
    written: 0,
    skipped: 0,
    assetPointsCreated: 0,
    firstTime: null,
    lastTime: null,
    batchId: "00000000-0000-4000-8000-000000000001",
    rejected: [],
    ...overrides,
  };
}

export function runSummarizeCommitTests(): void {
  assert(
    summarizeCommit(commit({ written: 5 })) === "Wrote 5 readings.",
    `unexpected: "${summarizeCommit(commit({ written: 5 }))}"`,
  );

  assert(
    summarizeCommit(commit({ written: 1 })) === "Wrote 1 reading.",
    "a single written row must use singular grammar",
  );

  assert(
    summarizeCommit(commit({ written: 5, assetPointsCreated: 2 })) ===
      "Wrote 5 readings, 2 new point mappings created.",
    `unexpected: "${summarizeCommit(commit({ written: 5, assetPointsCreated: 2 }))}"`,
  );

  assert(
    summarizeCommit(commit({ written: 5, assetPointsCreated: 1, rejected: [rejection({ rowNumber: 3 })] })) ===
      "Wrote 5 readings, 1 new point mapping created, 1 row rejected.",
    `unexpected: "${summarizeCommit(
      commit({ written: 5, assetPointsCreated: 1, rejected: [rejection({ rowNumber: 3 })] }),
    )}"`,
  );

  assert(
    summarizeCommit(commit({ written: 0, rejected: [rejection({ rowNumber: 1 }), rejection({ rowNumber: 2 })] })) ===
      "Wrote 0 readings, 2 rows rejected.",
    "an all-rejected commit must still summarise cleanly",
  );
}

/**
 * Coverage for `describeImportUploadError` (FG4).
 *
 * **`F4.106` corrected this docblock; it used to claim the opposite.** A 413
 * from `FileInterceptor`'s `fileSize` limit *does* reach the app's usual JSON
 * error path: Nest maps multer's `LIMIT_FILE_SIZE` to
 * `PayloadTooLargeException`, so the body is the ordinary envelope and an
 * unwrapper alone would yield `File too large`. The friendly message exists to
 * add the 5 MB figure that message does not carry.
 *
 * That leaves the `<html>` case below as the *other* topology rather than as
 * this one's body: an HTML 413 is what a reverse proxy in front of the API
 * answers `client_max_body_size` with, before the request reaches Nest. This
 * repository ships no such proxy — `apps/web/nginx.conf` serves static SPA
 * files and does not proxy `/api` — so the case is a deployment this code has
 * to survive, not one the repo is known to produce. `oversizeUploadMessage`
 * carries the evidence for that.
 */
export function runDescribeImportUploadErrorTests(): void {
  assert(
    describeImportUploadError(413, "") === "File is too large — the limit is 5 MB.",
    `unexpected 413 message: "${describeImportUploadError(413, "")}"`,
  );

  // A 413 body that carries text loses to the friendly message anyway. This
  // one is a proxy page; the Nest envelope would say `File too large`, which
  // names no limit. Neither is what the operator needs to read.
  assert(
    describeImportUploadError(413, "<html>Request Entity Too Large</html>") ===
      "File is too large — the limit is 5 MB.",
    "a 413 must always use the friendly message, regardless of its raw body",
  );

  assert(
    describeImportUploadError(400, "Missing required column 'value'") === "Missing required column 'value'",
    "a non-413 error must pass its body text through unchanged",
  );

  assert(
    describeImportUploadError(500, "") === "Import failed (500).",
    `unexpected fallback for an empty body: "${describeImportUploadError(500, "")}"`,
  );
}

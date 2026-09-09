import type { RejectedRowDto, TelemetryImportCommitDto, TelemetryImportPreviewDto } from "@bms/shared";

import { oversizeUploadMessage } from "./oversize-upload";

export type GroupedRejection = { reason: string; rowNumbers: number[] };

/**
 * Groups rejected rows by their reason text, in first-seen order — a compact
 * shape for the preview table instead of one line per row when the same
 * mistake (a missing column, say) repeats across many rows.
 */
export function groupRejectionsByReason(rejected: readonly RejectedRowDto[]): GroupedRejection[] {
  const order: string[] = [];
  const byReason = new Map<string, number[]>();
  for (const r of rejected) {
    if (!byReason.has(r.reason)) {
      byReason.set(r.reason, []);
      order.push(r.reason);
    }
    byReason.get(r.reason)?.push(r.rowNumber);
  }
  return order.map((reason) => ({ reason, rowNumbers: byReason.get(reason) ?? [] }));
}

/**
 * One-line summary of a preview result. Names commit as the authority — see
 * `telemetryImportPreviewDtoSchema`'s doc comment (`@bms/shared`) for why
 * `acceptedCount` here is a structural check, not a guarantee.
 */
export function summarizePreview(dto: TelemetryImportPreviewDto): string {
  if (dto.totalRows === 0) {
    return "The file has no data rows.";
  }
  if (dto.rejectedCount === 0) {
    return `All ${dto.totalRows} row${dto.totalRows === 1 ? "" : "s"} look${
      dto.totalRows === 1 ? "s" : ""
    } ready to import (final checks happen on commit).`;
  }
  if (dto.acceptedCount === 0) {
    return `None of the ${dto.totalRows} rows can be imported — every row was rejected.`;
  }
  return (
    `${dto.acceptedCount} of ${dto.totalRows} rows look ready to import ` +
    `(final checks happen on commit); ${dto.rejectedCount} rejected.`
  );
}

/** One-line summary of a commit result, for the page's result banner. */
export function summarizeCommit(dto: TelemetryImportCommitDto): string {
  const parts = [`Wrote ${dto.written} reading${dto.written === 1 ? "" : "s"}`];
  if (dto.assetPointsCreated > 0) {
    parts.push(`${dto.assetPointsCreated} new point mapping${dto.assetPointsCreated === 1 ? "" : "s"} created`);
  }
  if (dto.rejected.length > 0) {
    parts.push(`${dto.rejected.length} row${dto.rejected.length === 1 ? "" : "s"} rejected`);
  }
  return `${parts.join(", ")}.`;
}

/**
 * Turns a non-OK upload response into a message worth showing an operator.
 *
 * **The 413 branch adds the 5 MB figure. It does not rescue a framework error
 * page** — this docblock said the latter until `F4.106` measured it. Nest maps
 * multer's `LIMIT_FILE_SIZE` to `PayloadTooLargeException`, so the body IS this
 * app's ordinary envelope and an unwrapper alone would already yield
 * `File too large`: a refusal that names no limit. The sentence and the full
 * reasoning live in `oversizeUploadMessage`, which is the only copy of both.
 *
 * **Every other status returns the response body raw**, falling back to a
 * generic line only when the body is empty — and "raw" means the wire
 * *envelope*, not the sentence inside it. A first correction of this docblock
 * said the body was "one of this app's own `BadRequestException` messages",
 * which is the same mistake in a new place: `telemetry-import.controller.ts`
 * throws `new BadRequestException("Import file is required")`, so the body is
 * `{"message":"Import file is required","error":"Bad Request","statusCode":400}`
 * and this function hands that JSON object back character for character. Its
 * `parseOptions` throws `err.flatten()`, which returns raw the same way. The 413
 * body is an envelope too; the difference is only that the 413 branch replaces
 * it.
 *
 * `F4.106` did not change that. Unwrapping this sibling belongs to the row filed
 * for the ~30 raw-body sites on the other admin pages (owner ruling 1), and this
 * file was explicitly out of scope.
 */
export function describeImportUploadError(status: number, bodyText: string): string {
  const oversize = oversizeUploadMessage(status);
  if (oversize !== null) {
    return oversize;
  }
  return bodyText.trim() || `Import failed (${status}).`;
}

import type { RejectedRowDto, TelemetryImportCommitDto, TelemetryImportPreviewDto } from "@bms/shared";

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

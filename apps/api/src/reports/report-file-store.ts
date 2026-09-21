import type { Logger } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { createHash } from "node:crypto";

import { reportFiles } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { ReportFileDto, ReportFileFormat } from "@bms/shared";

import { deleteObject } from "../storage/storage-client";
import type { StorageClient } from "../storage/storage-client";

/**
 * `F3.5b` U7 (plan R-15) — the pure pieces of a stored report file, moved
 * out of `ReportFilesService` byte for byte so the scheduled render (U9)
 * and the on-demand save name a file, hash a buffer and discard a failed
 * object the same way. Nothing here reads the token or the config.
 */

export const CONTENT_TYPES: Record<ReportFileFormat, ReportFileDto["contentType"]> = {
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

/**
 * The stored filename. ADR 0071 Amendment 1 item 12: the parameters are two
 * dates and a format and nothing else — a schedule's name never reaches the
 * filename (`report-file-store.spec.ts` scans this signature).
 */
export function reportFilename(periodStart: string, periodEnd: string, format: ReportFileFormat): string {
  return `energy-consumption-${periodStart}-to-${periodEnd}.${format}`;
}

/** R-3: the buffer is the only size and hash authority — never a header. */
export function describeBuffer(buffer: Buffer): { sha256: string; byteSize: number } {
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const byteSize = buffer.length;
  return { sha256, byteSize };
}

/**
 * A private copy of `AssetImagesWriteService.discardObjectUnlessTheRowCommitted`
 * (F3.4, post-merge sweep C3) parameterised on `reportFiles` — R-12 says why
 * it is copied and not lifted. `withTenant` rejects on any failure of the
 * tenant transaction, and one of those failures is not a rollback: a
 * connection dropped between the server's `COMMIT` and the acknowledgement
 * leaves the row committed. Discarding then makes a live row whose object is
 * gone. So the row is re-read on `fleetDb` (the tenant connection is the one
 * that just failed); a present row, or a re-read that itself fails, keeps
 * the object. Never throws — the caller rethrows the original error.
 *
 * The projection is `fileId`, not `id`, so the spec's fleet fake can tell
 * this read from the others by its shape.
 */
export async function discardObjectUnlessTheRowCommitted(
  deps: { fleetDb: BmsDb; client: StorageClient; logger: Logger },
  fileId: string,
  key: string,
): Promise<void> {
  let committed: boolean;
  try {
    const rows = await deps.fleetDb
      .select({ fileId: reportFiles.id })
      .from(reportFiles)
      .where(eq(reportFiles.id, fileId))
      .limit(1);
    committed = rows.length > 0;
  } catch (err) {
    deps.logger.warn(
      `report file ${fileId}: the committed-row re-check failed with ${errorName(err)}; the object is kept (ADR 0071 decision 4)`,
    );
    return;
  }
  if (committed) {
    deps.logger.warn(
      `report file ${fileId}: the row committed but the transaction reported failure; the object is kept (ADR 0071 decision 4)`,
    );
    return;
  }
  try {
    await deleteObject(deps.client, key);
  } catch (err) {
    deps.logger.warn(
      `report file ${fileId}: cleanup of the object after a failed row write failed with ${errorName(err)}; an orphan object remains (ADR 0066 decision 11)`,
    );
  }
}

export function errorName(err: unknown): string {
  return typeof err === "object" && err !== null && typeof (err as { name?: unknown }).name === "string"
    ? (err as { name: string }).name
    : "Error";
}

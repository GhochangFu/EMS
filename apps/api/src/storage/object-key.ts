import { z } from "zod";

/**
 * The **one** object key builder (ADR 0066 decision 4).
 *
 * Every object lives in the one configured bucket under
 * `org/<organization_id>/assets/<asset_id>/<image_id>`. The key is built
 * from the row the API is about to insert and is never accepted from a
 * client — not as a field, not as a path segment. Each part must be a
 * uuid, so no client-controlled string (a traversal, a bare word, a
 * near-uuid) can reach the key; a non-uuid throws `ObjectKeyError` naming
 * the part and never the value.
 *
 * `tests/f3.3-object-storage-invariants.test.ts` (Unit 8) counts exactly
 * one `function buildObjectKey(` under `apps/api/src` and no other `org/`
 * literal — a second builder is a defect, not a convenience.
 *
 * **Two builders, one prefix, both here** (ADR 0071 decision 5). Decision
 * 4 allows one object key *file*; ADR 0071 decision 5 adds the second
 * *function* in it — `buildReportObjectKey`, under
 * `org/<organization_id>/reports/<file_id>` — rather than a second module,
 * so `OBJECT_KEY_PREFIX` and the fence's "one file" reasoning stay singular.
 */

export class ObjectKeyError extends Error {
  override readonly name = "ObjectKeyError";
}

export type ObjectKeyParts = {
  readonly organizationId: string;
  readonly assetId: string;
  readonly imageId: string;
};

/** ADR 0071 decision 5 — `bms.report_files`'s key parts. */
export type ReportObjectKeyParts = {
  readonly organizationId: string;
  readonly fileId: string;
};

const uuid = z.string().uuid();

function requireUuid(
  part: keyof ObjectKeyParts | keyof ReportObjectKeyParts,
  value: string,
): string {
  if (!uuid.safeParse(value).success) {
    // The message names the part, never the value — and avoids the word
    // "key", which the spec's `"key"` row would otherwise read as an echo.
    throw new ObjectKeyError(`${part} must be a uuid (ADR 0066 decision 4)`);
  }
  return value;
}

/**
 * The first segment of every key, exported so that a leak assertion can look
 * for a partial key ("the warn must not carry the prefix") without writing
 * the literal a second time. Unit 8's invariant allows the literal in this
 * file and in `object-key.spec.ts` alone.
 */
export const OBJECT_KEY_PREFIX = "org/";

export function buildObjectKey(parts: ObjectKeyParts): string {
  const organizationId = requireUuid("organizationId", parts.organizationId);
  const assetId = requireUuid("assetId", parts.assetId);
  const imageId = requireUuid("imageId", parts.imageId);
  return `${OBJECT_KEY_PREFIX}${organizationId}/assets/${assetId}/${imageId}`;
}

/** ADR 0071 decision 5 — `bms.report_files`'s object key, `org/<org>/reports/<fileId>`. */
export function buildReportObjectKey(parts: ReportObjectKeyParts): string {
  const organizationId = requireUuid("organizationId", parts.organizationId);
  const fileId = requireUuid("fileId", parts.fileId);
  return `${OBJECT_KEY_PREFIX}${organizationId}/reports/${fileId}`;
}

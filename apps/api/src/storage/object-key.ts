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
 */

export class ObjectKeyError extends Error {
  override readonly name = "ObjectKeyError";
}

export type ObjectKeyParts = {
  readonly organizationId: string;
  readonly assetId: string;
  readonly imageId: string;
};

const uuid = z.string().uuid();

function requireUuid(part: keyof ObjectKeyParts, value: string): string {
  if (!uuid.safeParse(value).success) {
    // The message names the part, never the value — and avoids the word
    // "key", which the spec's `"key"` row would otherwise read as an echo.
    throw new ObjectKeyError(`${part} must be a uuid (ADR 0066 decision 4)`);
  }
  return value;
}

export function buildObjectKey(parts: ObjectKeyParts): string {
  const organizationId = requireUuid("organizationId", parts.organizationId);
  const assetId = requireUuid("assetId", parts.assetId);
  const imageId = requireUuid("imageId", parts.imageId);
  return `org/${organizationId}/assets/${assetId}/${imageId}`;
}

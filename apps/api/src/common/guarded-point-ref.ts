import { BadRequestException } from "@nestjs/common";
import { decodePointRefParam } from "@bms/shared";
import { z } from "zod";

/**
 * `E1.4a` / ADR 0135 Amendment 3 S2 (plan R6) — the point-ref guard, shared.
 *
 * `decodeGuardedPointRef` moved here unchanged from
 * `telemetry/telemetry.controller.ts`, where it was private; the telemetry
 * routes call it exactly as before. `decodeBoundedPointRef` is the same guard
 * plus the `pointKey` bound, and is what the `ml` route calls: the column is
 * `varchar(128)`, so a longer key can match no row and is a caller error.
 */
const assetIdSchema = z.string().uuid();

/** The widest `point_key` any table holds (`varchar(128)`), in characters. */
export const POINT_KEY_MAX_CHARS = 128;

/**
 * One path-param ref, decoded and checked: a malformed ref (no separator, or a
 * `%` sequence `decodeURIComponent` cannot read) and a non-UUID asset id are
 * each a 400 — the same two sentences `atInstant` answers per ref. Runs before
 * the scope check, so neither reaches a query.
 */
export function decodeGuardedPointRef(pointRef: string): { assetId: string; pointKey: string } {
  let point: { assetId: string; pointKey: string };
  try {
    point = decodePointRefParam(pointRef);
  } catch {
    // A 400, not a 500. A malformed reference is a caller error, and letting
    // the decode throw raw would answer it with a stack trace.
    throw new BadRequestException("Invalid point reference");
  }
  if (!assetIdSchema.safeParse(point.assetId).success) {
    throw new BadRequestException("Invalid point reference: the asset id is not a UUID");
  }
  return point;
}

/**
 * {@link decodeGuardedPointRef}, then a `pointKey` of 1 to
 * {@link POINT_KEY_MAX_CHARS} characters, counted in code points as Postgres's
 * `varchar` counts them (an emoji is one character there and two UTF-16 units
 * here). Every refusal is a 400 and runs before any scope check or query.
 */
export function decodeBoundedPointRef(pointRef: string): { assetId: string; pointKey: string } {
  const point = decodeGuardedPointRef(pointRef);
  const length = [...point.pointKey].length;
  if (length < 1 || length > POINT_KEY_MAX_CHARS) {
    throw new BadRequestException(
      `Invalid point reference: the point key must be 1 to ${POINT_KEY_MAX_CHARS} characters`,
    );
  }
  return point;
}

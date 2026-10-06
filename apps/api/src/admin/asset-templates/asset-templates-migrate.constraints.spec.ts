import { ConflictException } from "@nestjs/common";

import { translateAssetPointInsertUnique } from "./asset-templates-migrate.service";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const SOURCE_KEY_INDEX = "asset_points_asset_source_key_idx";
const POINT_KEY_UNIQUE = "asset_points_asset_id_point_key_unique";

function uniqueViolation(constraint: string | undefined): Error {
  return Object.assign(new Error("duplicate key value"), {
    code: "23505",
    constraint,
  });
}

function conflictFor(constraint: string): ConflictException {
  const result = translateAssetPointInsertUnique(uniqueViolation(constraint));
  assert(
    result instanceof ConflictException,
    `${constraint} must become a ConflictException, got ${String(result)}`,
  );
  assert(
    (result as ConflictException).getStatus() === 409,
    `${constraint} must answer 409`,
  );
  return result as ConflictException;
}

/** `F4.222` — a raced source key answers 409 with the source-key sentence. */
export function assertSourceKeyCollisionIsA409(): void {
  const { message } = conflictFor(SOURCE_KEY_INDEX);
  assert(/source key/.test(message), `names the source key: ${message}`);
  assert(/Nothing was written/.test(message), `says nothing was written: ${message}`);
  assert(!/point key/.test(message), `must not name the point key: ${message}`);
}

/** `F4.222` — a raced point key answers 409 with its own, different sentence. */
export function assertPointKeyCollisionIsA409(): void {
  const { message } = conflictFor(POINT_KEY_UNIQUE);
  assert(/point key/.test(message), `names the point key: ${message}`);
  assert(/Nothing was written/.test(message), `says nothing was written: ${message}`);
  assert(!/source key/.test(message), `must not name the source key: ${message}`);
  assert(
    message !== conflictFor(SOURCE_KEY_INDEX).message,
    "the two collisions must carry two different sentences",
  );
}

/** `F4.222` — any other constraint, or none, is rethrown as the same raw error. */
export function assertUnknownConstraintIsRethrownRaw(): void {
  for (const constraint of ["asset_points_pkey", undefined]) {
    const err = uniqueViolation(constraint);
    const result = translateAssetPointInsertUnique(err);
    assert(result === err, `constraint ${String(constraint)} must come back as the same error`);
    assert(
      typeof (result as { getStatus?: unknown }).getStatus !== "function",
      `constraint ${String(constraint)} must not become an HTTP exception`,
    );
  }
}

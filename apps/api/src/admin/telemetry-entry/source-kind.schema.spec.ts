import {
  pointSourceKindSchema,
  rejectedRowDtoSchema,
  telemetryEntryRowSchema,
  writableSourceKindSchema,
} from "@bms/shared";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * Behavioural cover for the ADR 0018 `source_kind` contract
 * (`packages/shared/src/contracts/telemetry-entry.ts`).
 *
 * `tests/adr-0018-source-axis.test.ts` proves the enum's *values* track the
 * CHECK constraint's; it is a source-text scan and cannot import
 * `@bms/shared` (`packages/shared` has no Vitest project, and the root
 * `tests/` project does not depend on the workspace package). This is the
 * runtime half: does the schema actually parse and reject the way the
 * contract claims.
 */
export function runSourceKindSchemaTests(): void {
  // ---- pointSourceKindSchema — the full vocabulary --------------------------

  for (const kind of ["measured", "manual", "computed", "unmapped"]) {
    assert(
      pointSourceKindSchema.safeParse(kind).success,
      `pointSourceKindSchema must accept '${kind}'`,
    );
  }
  assert(
    !pointSourceKindSchema.safeParse("archived").success,
    "pointSourceKindSchema must reject a value outside the CHECK's four",
  );

  // ---- writableSourceKindSchema — what a caller may ASK for -----------------

  assert(
    writableSourceKindSchema.safeParse("manual").success,
    "writableSourceKindSchema must accept 'manual'",
  );
  assert(
    writableSourceKindSchema.safeParse("unmapped").success,
    "writableSourceKindSchema must accept 'unmapped'",
  );
  assert(
    !writableSourceKindSchema.safeParse("measured").success,
    "writableSourceKindSchema must reject 'measured' — the API cannot supply the rtu_id " +
      "asset_points_source_ref_check requires a 'measured' row to carry",
  );
  assert(
    !writableSourceKindSchema.safeParse("computed").success,
    "writableSourceKindSchema must reject 'computed' — F1.8/F1.9 do not derive points",
  );

  // ---- telemetryEntryRowSchema — one reading ---------------------------------

  const goodRow = {
    assetId: "00000000-0000-4000-8000-000000000001",
    pointKey: "kw",
    value: 12.5,
    time: "2026-08-19T12:00:00.000Z",
  };
  const parsed = telemetryEntryRowSchema.safeParse(goodRow);
  assert(parsed.success, `a well-formed row must parse: ${JSON.stringify(parsed)}`);

  assert(
    !telemetryEntryRowSchema.safeParse({ ...goodRow, assetId: "not-a-uuid" }).success,
    "assetId must be a uuid",
  );
  assert(
    !telemetryEntryRowSchema.safeParse({ ...goodRow, value: Number.NaN }).success,
    "value must be finite — NaN must be rejected before it ever reaches the CHECK",
  );
  assert(
    !telemetryEntryRowSchema.safeParse({ ...goodRow, value: Number.POSITIVE_INFINITY }).success,
    "value must be finite — Infinity must be rejected before it ever reaches the CHECK",
  );
  assert(
    !telemetryEntryRowSchema.safeParse({ ...goodRow, time: "not-a-timestamp" }).success,
    "time must be a parsable timestamp",
  );
  assert(
    telemetryEntryRowSchema.safeParse({ ...goodRow, unit: "kW" }).success,
    "unit is optional but must be accepted when present",
  );

  // ---- rejectedRowDtoSchema — the per-row error report shape -----------------

  assert(
    rejectedRowDtoSchema.safeParse({ rowNumber: 3, field: "value", reason: "not finite" }).success,
    "a rejected-row report with a field must parse",
  );
  assert(
    rejectedRowDtoSchema.safeParse({ rowNumber: 3, field: null, reason: "unknown asset" }).success,
    "field is nullable — a row-level rejection is not always attributable to one field",
  );
}

import type { Measured, Strict } from "@bms/shared";
import { telemetryEntryRowSchema, telemetryWriteResponseSchema } from "@bms/shared";
import type { z } from "zod";

import { manualReadingsBodySchema } from "./manual-readings.schema";
import type { WriteReadingsOutput } from "./telemetry-write.service";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * `telemetryEntryRowSchema` itself must be `.strict()` — the body wrapper's
 * own `.strict()` (tested below) only catches an unknown key at the top
 * level; a caller could still smuggle `sourceKind`/`rtuId` inside a *row* and
 * have it silently stripped rather than rejected. No privilege escalation
 * follows (the write path builds every column by named property, never by
 * spreading a row), but a caller sending `sourceKind` deserves the same 400
 * a caller sending it at the top level already gets.
 */
export function runTelemetryEntryRowSchemaStrictnessTests(): void {
  const goodRow = {
    assetId: "00000000-0000-4000-8000-000000000001",
    pointKey: "kw",
    value: 12.5,
    time: "2026-08-19T12:00:00.000Z",
  };
  assert(telemetryEntryRowSchema.safeParse(goodRow).success, "sanity: goodRow must itself parse");

  assert(
    !telemetryEntryRowSchema.safeParse({ ...goodRow, sourceKind: "manual" }).success,
    "a row carrying sourceKind must be rejected, not silently stripped",
  );
  assert(
    !telemetryEntryRowSchema.safeParse({ ...goodRow, rtuId: "00000000-0000-4000-8000-000000000002" }).success,
    "a row carrying rtuId must be rejected, not silently stripped",
  );
}

/**
 * Behavioural cover for the F1.8/F1.9 write-response envelope
 * (`packages/shared/src/contracts/telemetry-entry.ts`,
 * `telemetryWriteResponseSchema`).
 *
 * The controller returns the full `WriteReadingsOutput` shape from
 * `telemetry-write.service.ts` — `{ result, rejected }` — not just the
 * `TelemetryWriteResultDto` alone. This proves the schema's `z.infer` is
 * structurally identical to that frozen service type, and that it parses the
 * shapes the controller actually produces.
 */
export function runManualReadingsSchemaTests(): void {
  // ---- type-level: the schema's inferred type must match the service's
  // ---- output type exactly, not just be mutually assignable.
  type _EnvelopeMatchesServiceOutput = Measured<
    Strict<z.infer<typeof telemetryWriteResponseSchema>, WriteReadingsOutput>
  >;
  const _envelopeMatchesServiceOutput: _EnvelopeMatchesServiceOutput = true;
  void _envelopeMatchesServiceOutput;

  // ---- runtime: a full payload must parse -----------------------------------

  const fullPayload = {
    result: {
      written: 3,
      skipped: 1,
      assetPointsCreated: 0,
      firstTime: "2026-08-19T12:00:00.000Z",
      lastTime: "2026-08-19T12:05:00.000Z",
      batchId: "00000000-0000-4000-8000-000000000001",
    },
    rejected: [{ rowNumber: 2, field: "value", reason: "not finite" }],
  };
  const parsed = telemetryWriteResponseSchema.safeParse(fullPayload);
  assert(parsed.success, `a well-formed envelope must parse: ${JSON.stringify(parsed)}`);

  // ---- runtime: a payload missing `rejected` must fail -----------------------

  const { rejected: _omitted, ...missingRejected } = fullPayload;
  assert(
    !telemetryWriteResponseSchema.safeParse(missingRejected).success,
    "an envelope missing `rejected` must fail — the controller always returns both fields",
  );

  // ---- runtime: `field` nullability must survive the envelope ---------------

  const withNullField = {
    ...fullPayload,
    rejected: [{ rowNumber: 5, field: null, reason: "unknown asset" }],
  };
  assert(
    telemetryWriteResponseSchema.safeParse(withNullField).success,
    "a rejected row with field: null must parse — a row-level rejection is not always attributable to one field",
  );
}

/**
 * Behavioural cover for the F1.8/F1.9 manual-entry request body
 * (`manual-readings.schema.ts`, `manualReadingsBodySchema`).
 *
 * `sourceKind` is deliberately absent from the body — the controller
 * hardcodes `"manual"` — so a caller sending it must be rejected, which is
 * also the test that proves `.strict()` is actually applied.
 */
export function runManualReadingsBodySchemaTests(): void {
  const goodRow = {
    assetId: "00000000-0000-4000-8000-000000000001",
    pointKey: "kw",
    value: 12.5,
    time: "2026-08-19T12:00:00.000Z",
  };
  assert(telemetryEntryRowSchema.safeParse(goodRow).success, "sanity: goodRow must itself parse");

  // ---- conflictPolicy default and explicit value -----------------------------

  const withoutPolicy = manualReadingsBodySchema.safeParse({ rows: [goodRow] });
  assert(withoutPolicy.success, `a body without conflictPolicy must parse: ${JSON.stringify(withoutPolicy)}`);
  assert(
    withoutPolicy.success && withoutPolicy.data.conflictPolicy === "reject",
    "conflictPolicy must default to 'reject', not merely allow it to be omitted",
  );

  const withOverwrite = manualReadingsBodySchema.safeParse({
    rows: [goodRow],
    conflictPolicy: "overwrite",
  });
  assert(
    withOverwrite.success && withOverwrite.data.conflictPolicy === "overwrite",
    "an explicit conflictPolicy: 'overwrite' must survive parsing",
  );

  assert(
    !manualReadingsBodySchema.safeParse({ rows: [goodRow], conflictPolicy: "merge" }).success,
    "conflictPolicy: 'merge' must fail — only 'reject' and 'overwrite' exist",
  );

  // ---- .strict() — an unknown top-level key must fail ------------------------

  assert(
    !manualReadingsBodySchema.safeParse({ rows: [goodRow], sourceKind: "manual" }).success,
    "an unknown key like sourceKind must fail — the controller hardcodes it, callers cannot set it",
  );

  // ---- row-count bounds (A4a's M2, discharged here via .max(50)) ------------

  assert(
    !manualReadingsBodySchema.safeParse({ rows: [] }).success,
    "an empty rows array must fail",
  );

  const rows51 = Array.from({ length: 51 }, (_, i) => ({ ...goodRow, pointKey: `kw-${i}` }));
  assert(!manualReadingsBodySchema.safeParse({ rows: rows51 }).success, "51 rows must fail");

  const rows50 = Array.from({ length: 50 }, (_, i) => ({ ...goodRow, pointKey: `kw-${i}` }));
  const parsed50 = manualReadingsBodySchema.safeParse({ rows: rows50 });
  assert(parsed50.success, `exactly 50 rows must parse: ${JSON.stringify(parsed50)}`);

  // ---- per-row validation, delegated to telemetryEntryRowSchema -------------

  assert(
    !manualReadingsBodySchema.safeParse({ rows: [{ ...goodRow, value: Number.NaN }] }).success,
    "a row with value: NaN must fail",
  );
  assert(
    !manualReadingsBodySchema.safeParse({ rows: [{ ...goodRow, value: Number.POSITIVE_INFINITY }] })
      .success,
    "a row with value: Infinity must fail",
  );
  assert(
    !manualReadingsBodySchema.safeParse({ rows: [{ ...goodRow, time: "not-a-timestamp" }] }).success,
    "a row with an unparsable time must fail",
  );
  assert(
    !manualReadingsBodySchema.safeParse({ rows: [{ ...goodRow, assetId: "not-a-uuid" }] }).success,
    "a row with a bad assetId must fail",
  );

  const { unit: _unused, ...rowWithoutUnit } = { ...goodRow, unit: "kW" };
  assert(
    manualReadingsBodySchema.safeParse({ rows: [rowWithoutUnit] }).success,
    "a row with no unit key must parse — unit is optional",
  );
}

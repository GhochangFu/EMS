/**
 * Manual and imported telemetry-entry contracts (ADR 0018, backlog `F1.8`/
 * `F1.9`).
 *
 * ADR 0018's own "Risk accepted" section: `source_kind` is enforced by a
 * Postgres CHECK constraint (`asset_points_source_kind_check`,
 * `packages/db/drizzle/0023_source_axis_separation.sql`), not by Zod at the
 * controller boundary — "adding a schema-level enum is owed when F1.8/F1.9
 * expose the field to callers." `pointSourceKindSchema` is that enum, and
 * `tests/adr-0018-source-axis.test.ts` asserts it lists exactly the CHECK's
 * four values, parsed from each source rather than one hard-coding the other.
 */
import { z } from "zod";

/** The full `bms.asset_points.source_kind` vocabulary. */
export const pointSourceKindSchema = z.enum(["measured", "manual", "computed", "unmapped"]);

/**
 * What a caller may ASK the write path for. `measured` is excluded: the API
 * cannot supply the `rtu_id` that `asset_points_source_ref_check` requires a
 * `measured` row to carry, so admitting it here would turn a 400 that names
 * the options into a 500 from the CHECK constraint instead.
 */
export const writableSourceKindSchema = pointSourceKindSchema.extract(["manual", "unmapped"]);

/**
 * One hand-entered or imported reading. `.refine()` is immediately followed
 * by `.describe()` — `tests/adr-0029-openapi-contract.test.ts` scans for that
 * order; a `.describe()` placed before the refinement is silently discarded
 * by the OpenAPI conversion.
 */
export const telemetryEntryRowSchema = z
  .object({
    assetId: z.string().uuid(),
    pointKey: z.string().min(1).max(128),
    value: z.number().finite(),
    unit: z.string().max(32).optional(),
    time: z
      .string()
      .refine((v) => !Number.isNaN(Date.parse(v)), "must be a parsable timestamp")
      .describe("ISO-8601 timestamp of the reading"),
  })
  .describe("One hand-entered or imported telemetry reading.");

/** One row a write attempt rejected, and why. */
export const rejectedRowDtoSchema = z.object({
  rowNumber: z.number(),
  field: z.string().nullable(),
  reason: z.string(),
});

/** The outcome of one manual-entry or import write, accepted rows only. */
export const telemetryWriteResultDtoSchema = z
  .object({
    written: z.number(),
    skipped: z.number(),
    assetPointsCreated: z.number(),
    firstTime: z.string().nullable(),
    lastTime: z.string().nullable(),
    batchId: z.string().uuid(),
  })
  .readonly();

/**
 * The full write-response envelope — what the F1.8/F1.9 controllers return,
 * accepted and rejected rows together. `telemetryWriteResultDtoSchema` alone
 * only covers the accepted half; a caller also needs to know which rows were
 * skipped and why.
 */
export const telemetryWriteResponseSchema = z.object({
  result: telemetryWriteResultDtoSchema,
  rejected: z.array(rejectedRowDtoSchema),
});

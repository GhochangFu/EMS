import { z } from "zod";

import { pointMetadataBodyShape, refinePointMetadata } from "./point-metadata.schema";

/**
 * The single-row telemetry-mapping bodies (`F4.16`, ADR 0018), as `F2.7` /
 * ADR 0056 decision 3 extends them.
 *
 * Two additions, one shape:
 *
 * - **the five instrument-metadata fields**, spread from
 *   `pointMetadataBodyShape` so this surface, the template surface and the
 *   mapping sheet cannot drift on the bounds or on the quality vocabulary.
 *   `null` clears the per-asset override back to "inherit the template";
 *   absent leaves the stored value alone. The *merged* pair (this row's
 *   `eng_min` beside the template's `eng_max`) is not a property of the body
 *   and is checked in the service, against the template row.
 * - **`rtuId`**, which the sheet has always been able to say by RTU code and
 *   this route could not say at all. The owner's ruling Q-H (2026-09-06)
 *   widened ADR 0056 decision 3's "create body" to the update body as well, as
 *   `uuid | null`: a uuid wires the point (`source_kind = 'measured'`), `null`
 *   unwires it (`rtu_id NULL`; `measured` becomes `unmapped`, a `manual` row
 *   stays `manual`), absent leaves the wiring alone. `asset_points_source_ref_check`
 *   is what makes that trio the only legal set of moves.
 */
const assetPointBodyShape = {
  assetId: z.string().uuid(),
  pointKey: z.string().min(1).max(128),
  sourceDataKey: z.string().min(1).max(128),
  sensorCode: z.string().max(64).optional(),
  unit: z.string().max(32).optional(),
  /**
   * The gateway this point is read through. Asserted by the service to live in
   * the asset's own location — a uuid alone would otherwise wire a point to a
   * gateway on another site, which reads as a working mapping and delivers
   * nothing.
   */
  rtuId: z.string().uuid().optional(),
  ...pointMetadataBodyShape,
};

export const createAssetPointBodySchema = z
  .object(assetPointBodyShape)
  // `.strict()` sits on the object, before `.superRefine` — a `ZodEffects` has
  // neither `.strict()` nor `.omit()`. Nothing may separate `.superRefine(...)`
  // from the `.describe(...)` below it (tests/adr-0029-openapi-contract.test.ts).
  .strict()
  .superRefine(refinePointMetadata)
  .describe(
    "Maps one catalog point key onto one asset. scaleMultiplier must not be 0 and engMin " +
      "must be below engMax when both are stated; null on any of the five means inherit " +
      "the template default, which resolves to multiplier 1, offset 0, no range test and " +
      "discard_bad. rtuId must be an RTU of the asset's own location; omit it to inherit " +
      "the asset's own gateway.",
  );

export const updateAssetPointBodySchema = z
  .object({
    ...assetPointBodyShape,
    // Q-H: nullable **here only**. On create there is nothing to unwire, and
    // `null` would be a second spelling of "inherit the asset's gateway".
    rtuId: z.string().uuid().nullable().optional(),
  })
  .omit({ assetId: true })
  .partial()
  .strict()
  .superRefine(refinePointMetadata)
  .describe(
    "Patches one asset point mapping. Every field is optional; an omitted field is left " +
      "as stored. On the five metadata fields null clears the per-asset override back to " +
      "the template default, and the resolved pair is checked against that default. " +
      "rtuId: a uuid wires the point to an RTU of the asset's location and makes it " +
      "measured, null unwires it (a measured point becomes unmapped, a manual one stays " +
      "manual), and omitting it leaves the wiring alone. A computed point refuses both.",
  );

/**
 * The query of `GET /admin/asset-points/mapping-sheet.xlsx` (ADR 0056 decision
 * 6): one workbook covers one location, which is what makes the sheet's
 * `asset_code` column unambiguous and the export's scope check a single
 * `canManageLocation`.
 */
export const mappingSheetQuerySchema = z
  .object({
    locationId: z.string().uuid(),
  })
  .strict();

export type CreateAssetPointBody = z.infer<typeof createAssetPointBodySchema>;
export type UpdateAssetPointBody = z.infer<typeof updateAssetPointBodySchema>;
export type MappingSheetQuery = z.infer<typeof mappingSheetQuerySchema>;

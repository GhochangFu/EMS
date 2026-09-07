import { MAX_ASSET_POINT_BULK_IDS, POINT_METADATA_FIELDS } from "@bms/shared";
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

export type CreateAssetPointBody = z.infer<typeof createAssetPointBodySchema>;
export type UpdateAssetPointBody = z.infer<typeof updateAssetPointBodySchema>;

/**
 * `F2.7` / ADR 0056 decision 8 — one edit applied to every selected asset point.
 *
 * The patch is deliberately **narrower than the single-row PATCH body**: it
 * carries no `pointKey`, no `sourceDataKey`, no `sensorCode` and no `rtuId`.
 * Each of those identifies *one* row — `asset_points_asset_id_point_key_unique`
 * and `asset_points_asset_source_key_idx` both refuse a second row with the
 * same value — so writing one across a selection is either a unique-violation
 * mid-transaction or, for `rtuId`, a wiring change that has to assert a
 * location per row. The mapping sheet is the surface for those (decisions 6 and
 * 7); this one is for the fields a whole selection can legitimately share: the
 * unit, the state flip, and the five instrument-metadata columns.
 *
 * Three spellings per field, as everywhere in `F2.7`: absent leaves the stored
 * value alone, a value sets it, and `null` clears the per-asset override back
 * to the template default. `active` has no `null` — a row is active or it is
 * not, and there is no template default to inherit.
 *
 * `.strict()`, so `scale_multiplier` or a stray `pointKey` is a 400 rather than
 * a key silently dropped from a bulk write the caller believes it made.
 */
export const assetPointBulkPatchSchema = z
  .object({
    /** `null` clears the stored unit; the catalog's own unit is not re-derived here. */
    unit: z.string().max(32).nullable().optional(),
    /** The list page's bulk enable/disable. Absent leaves each row as it is. */
    active: z.boolean().optional(),
    ...pointMetadataBodyShape,
  })
  .strict()
  // The within-row rules belong **here**, on the patch, and not on the body
  // below. Zod prepends the parent key to an issue raised inside a nested
  // schema, so a zero multiplier is reported at `patch.scaleMultiplier` — the
  // path the caller actually sent. Attached to the body it would report
  // `scaleMultiplier`, naming a field the body does not have.
  .superRefine(refinePointMetadata)
  .describe(
    "The edit applied to every selected asset point. Every field is optional; an omitted " +
      "field leaves each row as it is, and null on unit or on any of the five metadata " +
      "fields clears the stored value back to the template default. scaleMultiplier must " +
      "not be 0 and engMin must be below engMax when both are stated; the pair a row " +
      "resolves against its template default is checked per row by the service.",
  );

/** The seven fields a patch may state — the emptiness check's whole vocabulary. */
const ASSET_POINT_BULK_PATCH_FIELDS = ["unit", "active", ...POINT_METADATA_FIELDS] as const;

/**
 * A patch must state at least one field.
 *
 * Read field by field rather than as `Object.keys(patch).length`, because a key
 * present with an `undefined` value survives parsing and would make an empty
 * request look like an edit. The alternative — answering 200 to a request that
 * writes nothing and audits every selected row — is the failure this refuses:
 * the audit trail would record an edit that did not happen.
 */
function refuseAnEmptyBulkPatch(
  body: { readonly patch: z.infer<typeof assetPointBulkPatchSchema> },
  ctx: z.RefinementCtx,
): void {
  if (ASSET_POINT_BULK_PATCH_FIELDS.some((field) => body.patch[field] !== undefined)) {
    return;
  }
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: ["patch"],
    message:
      "The patch states no field, so this request would change nothing and still audit " +
      `every selected row. State at least one of: ${ASSET_POINT_BULK_PATCH_FIELDS.join(", ")}.`,
  });
}

/**
 * `F2.7` / ADR 0056 decision 8 — the bulk editor's request: a selection and one
 * patch, applied **all or nothing**.
 *
 * `MAX_ASSET_POINT_BULK_IDS` is the shared cap (`packages/shared`), not a
 * literal, so the page that offers the selection and the route that refuses it
 * cannot drift apart. `.min(1)` because a selection of nothing is a request
 * with no subject, and every id is a `uuid` so a caller passing point *keys*
 * is told rather than answered with an empty 404 list.
 */
export const assetPointBulkUpdateBodySchema = z
  .object({
    ids: z.array(z.string().uuid()).min(1).max(MAX_ASSET_POINT_BULK_IDS),
    patch: assetPointBulkPatchSchema,
  })
  .strict()
  .superRefine(refuseAnEmptyBulkPatch)
  .describe(
    "Applies one patch to every asset point named by ids, all or nothing: if any selected " +
      `row refuses the patch, none is written. At most ${MAX_ASSET_POINT_BULK_IDS} ids, all ` +
      "in one organization, all in locations the caller may manage. A computed row refuses " +
      "a patch that sets instrument metadata, and a row whose resolved engineering band " +
      "would be empty refuses it too — naming the bound inherited from its template.",
  );

export type AssetPointBulkPatch = z.infer<typeof assetPointBulkPatchSchema>;
export type AssetPointBulkUpdateBody = z.infer<typeof assetPointBulkUpdateBodySchema>;

/**
 * `F2.7` / ADR 0056 decisions 6 and 7 — the one parameter all three
 * mapping-sheet routes take. The sheet is a **location** document: the export
 * lists one location's assets, the preview and commit resolve every
 * `asset_code` against that location's own set, and the whole scope check is
 * `canManageLocation` on this id.
 *
 * `.strict()`, so a caller who spells it `location_id` or sends `assetId`
 * beside it gets a 400 rather than a whole-location export they did not ask
 * for. The two `POST` routes carry the file in a multipart part and this in the
 * query string, so this schema is parsed from `{ locationId }` rather than from
 * a body — there is no body to be strict about.
 *
 * Declared here, in the schema file, because ADR 0029's registry can only see
 * schemas that live in a `*.schema.ts` (`tests/adr-0029-openapi-contract.test.ts`
 * enforces it), and because `F2.7`'s PR 1 compliance review removed an earlier
 * copy of it: it belongs with the route it validates, not ahead of it.
 */
export const mappingSheetQuerySchema = z
  .object({
    locationId: z.string().uuid(),
  })
  .strict();

export type MappingSheetQuery = z.infer<typeof mappingSheetQuerySchema>;

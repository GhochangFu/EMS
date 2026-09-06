import { z } from "zod";

import { QUALITY_POLICIES } from "../ingest";

/**
 * `F2.7` / ADR 0056 decision 1 — the five point-metadata fields, on the **read
 * side**: `scale_multiplier`, `scale_offset`, `eng_min`, `eng_max` and
 * `quality_policy`, five nullable columns on both `bms.template_points` (the
 * class default) and `bms.asset_points` (the per-asset override), resolved per
 * column as `coalesce(asset_points.col, template_points.col)`.
 *
 * `NULL` = inherit, and a resolved `NULL` = today's behaviour: multiplier `1`,
 * offset `0`, no range test, `discard_bad`. Every existing row reads unchanged.
 *
 * **No bounds here**, the rule `admin.ts` states at
 * `assetPointCalcOverrideFieldsSchema`: this is a read-side shape over stored
 * rows, and a read schema that rejects a row the database holds lies about the
 * estate. ADR 0056 decision 2's bounds (`scale_multiplier <> 0`,
 * `eng_min < eng_max`, the enum) are the migration's CHECKs and `apps/api`'s
 * write-side schema; the merged-pair check (an override beside an inherited
 * bound) is `apps/api`'s alone.
 *
 * Declared as a **shape** and spread into the DTO literals — never `.merge()`,
 * `.extend()` or `z.intersection`: neither DTO is an intersection type, so there
 * is nothing to preserve, and a flattening combinator would only trip
 * `tests/adr-0030-contract-derivation.test.ts`'s source scan.
 */

/**
 * The host's two-valued policy on the protocol quality bit, as a schema. Built
 * from `QUALITY_POLICIES` in `../ingest` (the zod-free module the host
 * imports), never restated — §4.8: a copied enum is a copy that drifts.
 */
export const qualityPolicySchema = z.enum(QUALITY_POLICIES);

/** The five, by their camelCase wire names, for a walker that patches by key. */
export const POINT_METADATA_FIELDS = [
  "scaleMultiplier",
  "scaleOffset",
  "engMin",
  "engMax",
  "qualityPolicy",
] as const;

/** The five read-side fields, spread into a DTO's `z.object({...})` literal. */
export const pointMetadataShape = {
  /** engineering value = raw × multiplier + offset; `null` reads as `1`. */
  scaleMultiplier: z.number().nullable(),
  /** `null` reads as `0`. */
  scaleOffset: z.number().nullable(),
  /** Lower bound of the plausible engineering value, inclusive; `null` = no test. */
  engMin: z.number().nullable(),
  /** Upper bound, inclusive; `null` = no test. */
  engMax: z.number().nullable(),
  /** What to do with a sample the protocol marks bad; `null` reads as `discard_bad`. */
  qualityPolicy: qualityPolicySchema.nullable(),
};

/** The five as one object — the template default, the override, or the resolved value. */
export const pointMetadataFieldsSchema = z.object(pointMetadataShape);

/**
 * Compile-time: `POINT_METADATA_FIELDS` and `pointMetadataShape` name the same
 * five, in both directions. A sixth column added to one and not the other
 * fails `pnpm typecheck` rather than leaving a walker that silently skips it.
 */
type ShapeKey = keyof typeof pointMetadataShape;
type FieldName = (typeof POINT_METADATA_FIELDS)[number];
const _everyFieldIsAShapeKey: readonly ShapeKey[] = POINT_METADATA_FIELDS;
void _everyFieldIsAShapeKey;
type _EveryShapeKeyIsListed = Exclude<ShapeKey, FieldName> extends never ? true : never;
const _everyShapeKeyIsListed: _EveryShapeKeyIsListed = true;
void _everyShapeKeyIsListed;

/**
 * ADR 0056 decision 8 — `POST /admin/asset-points/bulk-update` takes at most
 * this many ids. All-or-nothing, so the ceiling bounds one transaction.
 */
export const MAX_ASSET_POINT_BULK_IDS = 500;

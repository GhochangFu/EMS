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
 * `F2.7` / ADR 0056 decision 8 — how many asset points one bulk edit may carry.
 *
 * The bulk editor is **all-or-nothing**: every selected row is validated against
 * its own template defaults before anything is written, and one refusal writes
 * nothing. That makes the cost of a selection super-linear in the operator's
 * head as well as in the transaction — a bound is what keeps "apply to the
 * selection" a reviewable act rather than a fleet-wide edit behind one button,
 * and it keeps the single `UPDATE … WHERE id IN (…)` and its audit insert inside
 * one short-lived transaction.
 *
 * Declared here, in shared, because both ends need the same number: `apps/api`'s
 * `assetPointBulkUpdateBodySchema` refuses a longer list, and the web page caps
 * what it offers to send. A second literal in either place is a cap that drifts
 * — the web would offer 600 rows to a route that refuses them.
 */
export const MAX_ASSET_POINT_BULK_IDS = 500;

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

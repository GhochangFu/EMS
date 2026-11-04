import { z } from "zod";

import {
  CALC_TRIGGERS,
  MAX_CALC_INTERVAL_SECONDS,
  MAX_FORMULA_LENGTH,
  MAX_INPUT_AGE_SECONDS_BOUND,
  MIN_CALC_INTERVAL_SECONDS,
} from "../calc-dsl/limits";
import { assetPointCalcConfigDtoSchema, calcDialectSchema } from "./asset-templates";
import { backfillDaysSchema } from "./calc-backfill";
import { calcPointKeyParamSchema } from "./calc-override-writes";

/**
 * `F4.311` PR 2 (ADR 0109 decisions 1, 4 and 7) — the bodies of the
 * standalone calculated-point writes: the extended `PUT
 * /admin/assets/:assetId/calc-points/:pointKey` on an asset with no template,
 * and `POST /admin/calc-points/batch`.
 *
 * **Every calc field is required** (decision 1): a standalone point has no
 * template value to inherit, so `null` cannot mean "inherit" here the way it
 * does in `assetPointCalcOverrideBodySchema`. `calcIntervalSeconds` is the one
 * nullable field, because `null` is its legal value for a `streaming` point.
 * The trigger/interval pairing and the formula's parse are not restated here:
 * the service runs `validateMergedCalcOverride` against an all-null template,
 * which is the same rule the override path enforces (one set of rules,
 * decision 3).
 *
 * Bounds are imported from `calc-dsl/limits.ts`, never restated.
 */

/** ADR 0109 ruling 4 — the batch cap, the same shape as `RULE_BATCH_MAX_ROWS`. */
export const CALC_POINT_BATCH_MAX_ASSETS = 25;

/**
 * The fields both bodies share, as a plain record and **spread** into each
 * strict object rather than intersected.
 *
 * `z.intersection(a.strict(), b.strict())` parses nothing: each strict half
 * refuses the other's keys (the precedent is `templateWidgetIdentityFields` in
 * `asset-template-content-writes.ts`). Dropping `.strict()` would let an
 * author's typo through on an authoring body. Spreading a field record is not
 * a flattening combinator (§4.8 bans `.merge()` / `.omit().extend()`, which
 * rebuild an intersection *type* as one object) — there is no `A & B` here,
 * only one object declared with its fields.
 */
const calcPointSetFields = {
  formula: z.string().min(1).max(MAX_FORMULA_LENGTH),
  formulaDialect: calcDialectSchema,
  calcTrigger: z.enum(CALC_TRIGGERS),
  calcIntervalSeconds: z
    .number()
    .int()
    .min(MIN_CALC_INTERVAL_SECONDS)
    .max(MAX_CALC_INTERVAL_SECONDS)
    .nullable(),
  maxInputAgeSeconds: z.number().int().min(1).max(MAX_INPUT_AGE_SECONDS_BOUND),
  /**
   * Days of history to compute on save (ADR 0109 decision 7). The point is
   * written first; the run is created after, and only the run creation is
   * refused while another backfill of the point is active (owner ruling 4).
   */
  backfillDays: backfillDaysSchema,
};

/** `PUT /admin/assets/:assetId/calc-points/:pointKey` on an asset with no template. */
export const calcPointSetBodySchema = z.object(calcPointSetFields).strict();

/**
 * `POST /admin/calc-points/batch` — one key, formula and timing on up to 25
 * template-less assets of one organization, all or nothing (decision 4).
 */
export const calcPointBatchBodySchema = z
  .object({
    assetIds: z.array(z.string().uuid()).min(1).max(CALC_POINT_BATCH_MAX_ASSETS),
    pointKey: calcPointKeyParamSchema,
    ...calcPointSetFields,
  })
  .strict();

/** The batch's 200 — one item per asset, in request order. */
export const calcPointBatchResponseSchema = z.object({
  items: z.array(assetPointCalcConfigDtoSchema),
});

/**
 * One refused asset in a batch's 400. `assetCode` is `null` when the caller
 * may not see the asset (it does not exist, or is outside their write scope):
 * naming the code of an asset the caller typed only as an id would disclose
 * it.
 */
export const calcPointRefusalSchema = z.object({
  assetId: z.string(),
  assetCode: z.string().nullable(),
  reason: z.string(),
});

/** The batch's 400 body: every refused asset, not just the first. */
export const calcPointBatchRefusedResponseSchema = z.object({
  message: z.string(),
  refused: z.array(calcPointRefusalSchema),
});

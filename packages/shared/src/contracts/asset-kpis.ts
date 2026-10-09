import { z } from "zod";

/**
 * `F2.33` — `GET /api/v1/assets/:assetId/kpis` (ADR 0097): the KPIs of the
 * asset's pinned template version, evaluated at read time, in declared order.
 *
 * **Disclosure (decision 6).** An item carries the value, the state, the two
 * counts and `inputAsOf`, plus the stored KPI's `code`, `name`, `unit?` and
 * `higherIsBetter?` (the owner's 2026-10-09 ruling) — never a member's id,
 * code or value, and never the KPI's `expression`, `pointKeys` or `dialect`.
 * `.strict()` holds that at the contract: an extra key is refused.
 *
 * **Encoding (§4.8):** flat `z.object().strict()` per item — no `.merge()`,
 * no `z.intersection`, no `.readonly()`. Nothing is composed from another
 * schema, so the flattening scan has nothing to flag.
 */

/**
 * Why a KPI has or has no value (ADR 0097 "Ruled here"). `ok`, `unvalidated`
 * (a KPI stored under the `"unvalidated"` dialect, listed and never
 * evaluated), and the runtime refusal reasons a read can reach — a subset of
 * the API's `CalcRuntimeSkipReason`. `coverage_below_floor` is absent: a KPI
 * aggregate runs with a `null` ratio (decision 3).
 */
export const assetKpiStateSchema = z.enum([
  "ok",
  "unvalidated",
  "missing_input",
  "stale_input",
  "no_members",
  "unknown_asset_reference",
  "parameter_unset",
  "window_empty",
  "window_sparse",
  "windows_unresolved",
  "timezone_unset",
  "non_finite",
]);

export const assetKpiValueSchema = z
  .object({
    code: z.string(),
    name: z.string(),
    unit: z.string().optional(),
    higherIsBetter: z.boolean().optional(),
    /** Finite by construction — the host maps a non-finite result to `non_finite`. */
    value: z.number().nullable(),
    state: assetKpiStateSchema,
    /** The oldest input sample read for this KPI; `null` when none was read. */
    inputAsOf: z.string().datetime({ offset: true }).nullable(),
    /** Declared aggregate members that were stale or missing. */
    excluded: z.number().int().nonnegative(),
    /** Declared aggregate members over every aggregate of the KPI. */
    memberCount: z.number().int().nonnegative(),
  })
  .strict();

export const assetKpisResponseSchema = z
  .object({
    assetId: z.string().uuid(),
    windowMinutes: z.number().int().positive(),
    items: z.array(assetKpiValueSchema),
  })
  .strict();

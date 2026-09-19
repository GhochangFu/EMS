import { z } from "zod";

/**
 * `E4.1a` U8 — the write side of `/admin/calc-parameters` (ADR 0070 decision
 * 2). The read DTOs live in `@bms/shared` (`calcParameterDtoSchema`); these
 * bodies are `apps/api`'s, `.strict()` per ADR 0029.
 */

/**
 * Plan design decision 5 / open question Q1: `$` then `[A-Za-z_][A-Za-z0-9_]*`
 * is the lexical form of a reference, so a key holding `-` could never be
 * written (`$a-b` lexes as `$a - b`). Narrower than ADR 0065's catalog class
 * on purpose; migration `0074` holds the same class as
 * `calc_parameter_keys_code_charset_check`.
 */
export const CALC_PARAMETER_KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
export const CALC_PARAMETER_KEY_MESSAGE =
  "a calc parameter key is snake_case: a lower-case letter, then up to 63 lower-case letters, digits or underscores";

const calcParameterKeySchema = z.string().regex(CALC_PARAMETER_KEY_PATTERN, CALC_PARAMETER_KEY_MESSAGE);

/** ISO 8601 with an offset (`Z` or `±hh:mm`), so a client's local time is never read as UTC. */
const instantSchema = z.string().datetime({ offset: true });

type Window = { effectiveFrom?: string | undefined; effectiveTo?: string | null | undefined };

/**
 * `[effectiveFrom, effectiveTo)` must be non-empty. Shared by both bodies;
 * `update` may name one end only, and then the database's
 * `calc_parameters_validity_check` holds the pair against the stored end.
 */
function refineWindow(body: Window, ctx: z.RefinementCtx): void {
  if (
    body.effectiveFrom !== undefined &&
    body.effectiveTo !== undefined &&
    body.effectiveTo !== null &&
    Date.parse(body.effectiveTo) <= Date.parse(body.effectiveFrom)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["effectiveTo"],
      message: "effectiveTo must be later than effectiveFrom",
    });
  }
}

export const createCalcParameterBodySchema = z
  .object({
    organizationId: z.string().uuid(),
    key: calcParameterKeySchema,
    locationId: z.string().uuid().nullish(),
    assetId: z.string().uuid().nullish(),
    value: z.number().finite(),
    effectiveFrom: instantSchema,
    effectiveTo: instantSchema.nullish(),
  })
  .strict()
  .superRefine((body, ctx) => {
    if (body.locationId != null && body.assetId != null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["assetId"],
        message: "a parameter is scoped to the organization, to one location or to one asset — not to a location and an asset",
      });
    }
    refineWindow(body, ctx);
  })
  .describe(
    "At most one of locationId / assetId (both absent is the organization scope); " +
      "effectiveTo, when given, is later than effectiveFrom.",
  );

/**
 * Design decision 12: `key`, `organizationId` and the scope are immutable on
 * PATCH — this body simply has no such field, and `.strict()` refuses one. A
 * re-scope is delete + create, which keeps the overlap rule one predicate.
 */
export const updateCalcParameterBodySchema = z
  .object({
    value: z.number().finite().optional(),
    effectiveFrom: instantSchema.optional(),
    effectiveTo: instantSchema.nullish(),
  })
  .strict()
  .superRefine((body, ctx) => {
    refineWindow(body, ctx);
    // An empty PATCH would rewrite the same window, bump `updated_at` and
    // write an audit row for no change (PR 2 code review; the
    // `updateAssetRoleBodySchema` precedent).
    if (body.value === undefined && body.effectiveFrom === undefined && body.effectiveTo === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "At least one of value, effectiveFrom or effectiveTo is required" });
    }
  })
  .describe("At least one field; effectiveTo, when both ends are given, is later than effectiveFrom.");

export const listCalcParametersQuerySchema = z
  .object({
    organizationId: z.string().uuid(),
    key: calcParameterKeySchema.optional(),
  })
  .strict();

export type CreateCalcParameterBody = z.infer<typeof createCalcParameterBodySchema>;
export type UpdateCalcParameterBody = z.infer<typeof updateCalcParameterBodySchema>;
export type ListCalcParametersQuery = z.infer<typeof listCalcParametersQuerySchema>;

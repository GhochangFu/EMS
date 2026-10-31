import { atInstantIsInRange } from "@bms/shared";
import { z } from "zod";

import { foldRepeatedQueryValue } from "../auth/asset-scope.schema";

/**
 * Query contracts for the telemetry point reads.
 *
 * In a `*.schema.ts` and never in the controller: ADR 0029 / `F4.20` found
 * `statusQuerySchema` inside a controller, where the OpenAPI registry could not
 * see it, and `tests/adr-0029-openapi-contract.test.ts` now scans controller
 * files for exactly this declaration. `pointAggregateQuerySchema` (`F3.35`
 * Stage A, ADR 0048) and `pointRawQuerySchema` (`F4.297`) live in
 * `@bms/shared` (`contracts/telemetry-queries.ts`, ADR 0108 decision 1.2).
 */

// `F4.297` (ADR 0108 decision 1.2): declared once in `@bms/shared`, re-exported
// so the copilot importers do not change.
export { MAX_AT_INSTANT_LEAD_MS, MIN_AT_INSTANT_MS, atInstantIsInRange } from "@bms/shared";

/** The most refs one `GET /telemetry/points/at-instant` call may name. */
export const MAX_AT_INSTANT_REFS = 50;

/**
 * `F3.28` (ADR 0074 decision 2 / plan decision 2) — the query contract for
 * `GET /telemetry/points/at-instant?at=<ISO offset>&refs=<ref>&refs=<ref>`.
 *
 * **`refs` is folded the way `assetIdsQueryField` folds a repeated asset-scope
 * parameter** (`../auth/asset-scope.schema.ts`), for the identical reason:
 * Nest hands a bare string for one occurrence and an array for more than one,
 * and past 20 occurrences `qs`'s default `arrayLimit` turns the value into an
 * index-keyed object instead. Only `foldRepeatedQueryValue`'s exact overflow
 * shape folds back into an array; any other object reaches `z.array` as an
 * object and is refused.
 *
 * **`at` requires an explicit offset.** `z.string().datetime()` without
 * `{ offset: true }` accepts only a bare `Z`, and a caller's local offset
 * (`+02:00`) would be a 400 for no reason this route needs — the "prior
 * instant" it feeds is always compared against stored UTC timestamps, so any
 * valid offset resolves to the same instant.
 *
 * **`at` is bounded to `[1970-01-01T00:00:00Z, now + 1 day]`.** The datetime
 * format admits year `0000`, which Postgres refuses as a `timestamptz` — a 500
 * where the caller made an ordinary mistake. Refused here as a 400 instead.
 */
export const pointValuesAtQuerySchema = z
  .object({
    at: z
      .string()
      .datetime({ offset: true })
      .refine((at) => atInstantIsInRange(at), {
        message: "at must lie between 1970-01-01T00:00:00Z and one day after now",
      })
      .describe(
        "An ISO 8601 instant with an explicit offset, not before 1970-01-01T00:00:00Z and " +
          "not more than one day after the server's clock.",
      ),
    refs: z.preprocess(foldRepeatedQueryValue, z.array(z.string()).min(1).max(MAX_AT_INSTANT_REFS)),
  })
  .strict();

export type PointValuesAtQuery = z.infer<typeof pointValuesAtQuerySchema>;

/**
 * One point key: bounded by its column, `varchar(128)`, and free of control
 * characters (Postgres refuses a NUL byte in `text`, 22021). Shared since
 * `F4.274` by the latest-values query and the copilot telemetry read tools.
 */
export const pointKeySchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[^\u0000-\u001f\u007f]+$/, "a point key may not contain a control character");

/** The most asset ids one `GET /telemetry/points/latest` call may name. */
export const MAX_LATEST_ASSET_IDS = 50;

/** The most point keys one `GET /telemetry/points/latest` call may name. */
export const MAX_LATEST_POINT_KEYS = 64;

/** The widest window the latest-value read accepts, in minutes. */
export const MAX_LATEST_WINDOW_MINUTES = 60;

/** The window when none is given — the per-point `/recent` default it replaces. */
export const DEFAULT_LATEST_WINDOW_MINUTES = 15;

/**
 * `F4.176` (ADR 0074 Amendment 2 decision 2) — the query contract for
 * `GET /telemetry/points/latest?assetIds=<uuid>&…&pointKeys=<key>&…&windowMinutes=15`.
 *
 * Both lists fold the way `refs` does above, for the same reason: past 20
 * repeats `qs` hands an index-keyed object, and the SMOC view sends 43 ids.
 *
 * **Each asset id is a UUID here, not in the controller.** Unchecked, a
 * non-UUID reaches the `::uuid[]` cast and is a 500 where the caller made an
 * ordinary mistake. A point key is bounded by its column, `varchar(128)`, and
 * may not carry a control character: Postgres refuses a NUL byte in `text`
 * (22021), so `?pointKeys=%00` would otherwise be a 500 (security review L2).
 */
export const pointsLatestQuerySchema = z
  .object({
    assetIds: z.preprocess(
      foldRepeatedQueryValue,
      z.array(z.string().uuid()).min(1).max(MAX_LATEST_ASSET_IDS),
    ),
    pointKeys: z.preprocess(
      foldRepeatedQueryValue,
      z.array(pointKeySchema).min(1).max(MAX_LATEST_POINT_KEYS),
    ),
    windowMinutes: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_LATEST_WINDOW_MINUTES)
      .default(DEFAULT_LATEST_WINDOW_MINUTES),
  })
  .strict();

export type PointsLatestQuery = z.infer<typeof pointsLatestQuerySchema>;

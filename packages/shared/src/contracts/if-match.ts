import { z } from "zod";

/**
 * `F4.247` / ADR 0099 Amendment 5 — the `If-Match` precondition on the two list writes the
 * copilot can propose (`PUT /dashboards/:id/widgets`, `PATCH /admin/asset-templates/:id`).
 *
 * The header takes the record DTO's `updatedAt` — a millisecond ISO instant — in quotes, as an
 * entity tag is written: `If-Match: "2026-10-20T10:00:00.000Z"`. It is **not** the response's
 * `ETag` (Express sends a weak one), and a weak tag, `*` or a list is a 400.
 *
 * The routes compare the unquoted value **as text** against the row's `updated_at` rendered to
 * the same shape, so a value that passes this schema but that Postgres cannot cast (the year
 * 0000) is a 412, never a 500.
 */
export const ifMatchHeaderSchema = z
  .string()
  .regex(/^"[^"]*"$/)
  .transform((s) => s.slice(1, -1))
  .pipe(z.string().datetime({ precision: 3 }).brand<"IfMatch">());

export type IfMatch = z.infer<typeof ifMatchHeaderSchema>;

/**
 * The 412 both routes answer when `If-Match` names an `updatedAt` the record no longer has.
 * Shared, not restated, as `MIMIC_LAYOUT_STALE_MESSAGE` is.
 */
export const PRECONDITION_STALE_MESSAGE = "the record changed since it was read; reload and apply the edit again";

import { z } from "zod";

import { MAX_EXPORT_SPAN_DAYS } from "./audit.limits";

/**
 * Query contracts for the audit read API (ADR 0021).
 *
 * Both schemas are `.strict()`: an unknown query key is a caller error, not a
 * silently ignored one. A misspelt `entitiyType` that returns the unfiltered
 * log is worse than a 400 — the caller believes they filtered.
 */

/** `bms.audit_log.created_at` is `timestamptz`; accept an offset or `Z`. */
const isoTimestamp = z.string().datetime({ offset: true });

/**
 * `action` and `entity_type` are `varchar(64)`. A longer filter cannot match a
 * stored row, so it is rejected rather than run as a guaranteed-empty query.
 */
const filterShape = {
  action: z.string().min(1).max(64).optional(),
  entityType: z.string().min(1).max(64).optional(),
  entityId: z.string().uuid().optional(),
  actorId: z.string().uuid().optional(),
};

const MAX_EXPORT_SPAN_MS = MAX_EXPORT_SPAN_DAYS * 24 * 60 * 60 * 1000;

function addWindowOrderIssue(ctx: z.RefinementCtx): void {
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: ["to"],
    message: "`to` must not be earlier than `from`",
  });
}

/**
 * `GET /api/v1/admin/audit`. Offset pagination by ADR 0021 decision 4 —
 * `F4.22` adds a cursor field without removing these.
 */
export const auditListQuerySchema = z
  .object({
    ...filterShape,
    from: isoTimestamp.optional(),
    to: isoTimestamp.optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    // Bounded: deep offsets scan linearly, and this table grows on every
    // `rules/preview` call (§4.7).
    //
    // This used to say "global-admin-only, so this is a guard against accident
    // rather than abuse". `E7.1e` (ADR 0046) made that false — an
    // `organization_admin` now reaches this parameter. There is no index on
    // `bms.audit_log (organization_id)`, so a scoped deep-offset read walks
    // `audit_log_created_idx` backwards past every other organization's rows.
    // The bound is what keeps that finite. Availability, not disclosure; the
    // index is recorded as follow-up work rather than added here.
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.from && value.to && new Date(value.from) > new Date(value.to)) {
      addWindowOrderIssue(ctx);
    }
  })
  .describe("When both are supplied, `from` must not be later than `to`.");

/**
 * `GET /api/v1/admin/audit/export`. The window is **required** and bounded, and
 * there is deliberately no `limit`/`offset`: the cap is a per-request memory
 * bound, and pagination on an export is a different feature from a bounded
 * one. It does **not** stop a caller reassembling a large export from narrow
 * windows — nothing here does, and the cap is not trying to.
 */
export const auditExportQuerySchema = z
  .object({
    ...filterShape,
    from: isoTimestamp,
    to: isoTimestamp,
    format: z.enum(["csv", "xlsx"]).default("csv"),
  })
  .strict()
  .superRefine((value, ctx) => {
    const from = new Date(value.from);
    const to = new Date(value.to);
    if (from > to) {
      addWindowOrderIssue(ctx);
      return;
    }
    if (to.getTime() - from.getTime() > MAX_EXPORT_SPAN_MS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["to"],
        message: `Export window must not exceed ${MAX_EXPORT_SPAN_DAYS} days`,
      });
    }
  })
  .describe(
    "`from` must not be later than `to`, and the window must not exceed " +
      `${MAX_EXPORT_SPAN_DAYS} days.`,
  );

export type AuditListQuery = z.infer<typeof auditListQuerySchema>;
export type AuditExportQuery = z.infer<typeof auditExportQuerySchema>;

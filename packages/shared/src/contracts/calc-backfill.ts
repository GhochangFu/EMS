import { z } from "zod";

/** The longest backfill a write may ask for, in days (ADR 0109 decision 7). */
export const CALC_POINT_MAX_BACKFILL_DAYS = 31;

/**
 * `backfillDays` — days of history to compute on save (ADR 0109 decision 7),
 * `1 … CALC_POINT_MAX_BACKFILL_DAYS`, optional. One schema for every body
 * that accepts it: the standalone `PUT`, the batch, and the override `PUT`
 * (owner ruling 1, 2026-11-04).
 */
export const backfillDaysSchema = z.number().int().min(1).max(CALC_POINT_MAX_BACKFILL_DAYS).optional();

/**
 * `F4.311` PR 5b (ADR 0109 decision 7) — one calculated point's latest
 * backfill run, as the asset's calc-points list shows it.
 *
 * `status` is the run row's closed vocabulary (`calc_backfill_runs_status_check`
 * in migration `0123`): `queued` → `running` → `done` | `failed`. The engine
 * branches on it, so it is an enum here, not a string.
 *
 * `doneThrough` is the last bucket (or input time) the walk has stored —
 * `null` while `queued` — and equals `toAt` once `done`; a page measures
 * progress as `doneThrough − fromAt` over `toAt − fromAt`. `error` is an
 * error's name or a fixed sentence (`"no worker"`), never a message.
 * Timestamps are ISO strings.
 *
 * `.readonly()`: every field is read-only (§4.8).
 */
export const CALC_BACKFILL_STATUSES = ["queued", "running", "done", "failed"] as const;

export const calcBackfillRunDtoSchema = z
  .object({
    id: z.string(),
    status: z.enum(CALC_BACKFILL_STATUSES),
    fromAt: z.string(),
    toAt: z.string(),
    doneThrough: z.string().nullable(),
    writtenRows: z.number(),
    error: z.string().nullable(),
    createdAt: z.string(),
    finishedAt: z.string().nullable(),
  })
  .readonly();

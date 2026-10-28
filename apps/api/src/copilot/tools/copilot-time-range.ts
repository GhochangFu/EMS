import { z } from "zod";

import { atInstantIsInRange } from "../../telemetry/telemetry.schema";

/**
 * `F4.291` PR 2 (ADR 0099 Amendment 9 E5; owner ruling P3, 2026-10-27) — the
 * range arguments every copilot range tool shares (`list_alarms`,
 * `get_alarm_stats`; `get_point_stats` in PR 3).
 *
 * The model is never told the date (`COPILOT_SYSTEM_PROMPT` carries none, by
 * the cache-prefix spec), so a relative question ("the last 7 days") is
 * answered by `lastDays` (1–31), which the server resolves against the
 * turn's injected clock `ctx.now` — never `Date.now()` in a tool. `from`/`to`
 * (ISO instants with an offset) stay for an absolute range; `lastDays` with
 * either is refused. `to` must be after `from`; a tool that bounds the range
 * passes `maxDays`. A resolved instant before 1970 or more than one day past
 * the turn's clock is refused (the bound `get_values_at_instant` applies).
 *
 * `list_audit_log`'s own inline refine is not migrated here (no behaviour
 * change outside this row).
 */

export const isoInstantSchema = z.string().datetime({ offset: true });

/** The longest range a bounded range tool reads. */
export const COPILOT_RANGE_MAX_DAYS = 31;

const DAY_MS = 86_400_000;

/** The schema fields; a tool spreads them into its `z.object`. */
export const timeRangeFields = {
  from: isoInstantSchema.optional(),
  to: isoInstantSchema.optional(),
  lastDays: z.number().int().min(1).max(COPILOT_RANGE_MAX_DAYS).optional(),
};

export const COPILOT_RANGE_BOTH = "give lastDays or from/to, not both";
export const COPILOT_RANGE_NEEDED = "give lastDays, or both from and to";
export const COPILOT_RANGE_ORDER = "to must be after from";
export const COPILOT_RANGE_OUT_OF_CLOCK =
  "That range is outside what this read accepts: not before 1970-01-01T00:00:00Z and not more than one day after now.";

export function copilotRangeTooLong(maxDays: number): string {
  return `the range is at most ${maxDays} days`;
}

type RangeArgs = { readonly from?: string; readonly to?: string; readonly lastDays?: number };

/**
 * The schema-level checks, for a tool's `superRefine`. `required`: the tool
 * needs a range (`lastDays`, or both `from` and `to`); without it either end
 * may be given alone.
 */
export function refineInstantRange(
  args: RangeArgs,
  issue: z.RefinementCtx,
  options: { readonly maxDays?: number; readonly required?: boolean },
): void {
  const add = (message: string, path: string) => issue.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
  if (args.lastDays !== undefined) {
    if (args.from !== undefined || args.to !== undefined) add(COPILOT_RANGE_BOTH, "lastDays");
    return;
  }
  if (args.from === undefined || args.to === undefined) {
    if (options.required === true) add(COPILOT_RANGE_NEEDED, args.from === undefined ? "from" : "to");
    return;
  }
  const span = Date.parse(args.to) - Date.parse(args.from);
  if (!(span > 0)) {
    add(COPILOT_RANGE_ORDER, "to");
    return;
  }
  if (options.maxDays !== undefined && span > options.maxDays * DAY_MS) add(copilotRangeTooLong(options.maxDays), "to");
}

export type ResolvedRange = { readonly ok: true; readonly from?: Date; readonly to?: Date } | { readonly ok: false; readonly error: string };

/**
 * The range as instants: `lastDays` is `[now - lastDays, now)`; `from`/`to`
 * as given (either may be absent for an unbounded side). Refused when an
 * instant falls before 1970 or more than one day after `now`.
 */
export function resolveInstantRange(args: RangeArgs, now: Date): ResolvedRange {
  if (args.lastDays !== undefined) {
    return { ok: true, from: new Date(now.getTime() - args.lastDays * DAY_MS), to: now };
  }
  for (const instant of [args.from, args.to]) {
    if (instant !== undefined && !atInstantIsInRange(instant, now.getTime())) return { ok: false, error: COPILOT_RANGE_OUT_OF_CLOCK };
  }
  return {
    ok: true,
    ...(args.from !== undefined ? { from: new Date(args.from) } : {}),
    ...(args.to !== undefined ? { to: new Date(args.to) } : {}),
  };
}

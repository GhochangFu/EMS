import { MAINTENANCE_WINDOW_MAX_MS } from "@bms/shared";

/**
 * `F4.359` U3 (ADR 0131 decisions 1 and 2, plan D3) — the window period rules.
 * Pure: the caller passes `now`. The 7-day bound lives here, not in a table
 * CHECK, because an extension may carry a window's total length past 7 days
 * (decision 2); the table only says `ends_at > starts_at`.
 *
 * Each function answers `null` when the period is acceptable, or the 400 text.
 */

/** A start this far in the past is clock skew between the browser and the API, not a backdated window. */
export const WINDOW_START_GRACE_MS = 60_000;

/** A new window: start no more than 60 s ago; end after the start and after now; at most 7 days long. */
export function validateWindowPeriod(input: { now: Date; startsAt: Date; endsAt: Date }): string | null {
  const now = input.now.getTime();
  const startsAt = input.startsAt.getTime();
  const endsAt = input.endsAt.getTime();
  if (startsAt < now - WINDOW_START_GRACE_MS) {
    return "A maintenance window cannot start in the past";
  }
  if (endsAt <= startsAt) {
    return "A maintenance window must end after its start";
  }
  if (endsAt <= now) {
    return "A maintenance window must end in the future";
  }
  if (endsAt - startsAt > MAINTENANCE_WINDOW_MAX_MS) {
    return "A maintenance window may run at most 7 days";
  }
  return null;
}

/** An extension: later than the current end, and no more than 7 days from now. */
export function validateExtension(input: { now: Date; endsAt: Date; currentEndsAt: Date }): string | null {
  const endsAt = input.endsAt.getTime();
  if (endsAt <= input.currentEndsAt.getTime()) {
    return "An extension must end later than the window's current end";
  }
  if (endsAt - input.now.getTime() > MAINTENANCE_WINDOW_MAX_MS) {
    return "A maintenance window may be extended to at most 7 days from now";
  }
  return null;
}

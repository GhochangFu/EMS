/**
 * `E3.1` / ADR 0122 decision 3 — the work-order SLA: a whole number of minutes from
 * creation to `resolved`, wall time, no pause. The state is computed on read and never
 * stored, so nothing has to run when a clock crosses its line.
 */

/** The platform default when an organization has set no policy row (ruling Q6). */
export const WORK_ORDER_SLA_DEFAULT_MINUTES = {
  critical: 30,
  high: 60,
  medium: 240,
  low: 1440,
} as const;

/** One year: the upper bound of an SLA, in the policy table and on a ticket. */
export const WORK_ORDER_SLA_MAX_MINUTES = 525_600;

/** `at_risk` begins when less than this share of the window is left. */
export const WORK_ORDER_SLA_AT_RISK_FRACTION = 0.2;

export const WORK_ORDER_SLA_STATES = [
  "none",
  "on_track",
  "at_risk",
  "breached",
  "met",
  "missed",
] as const;

export type WorkOrderSlaStateName = (typeof WORK_ORDER_SLA_STATES)[number];

export type WorkOrderSlaInput = {
  /** Null for a ticket older than the SLA columns, which reads `none`. */
  readonly slaMinutes: number | null;
  readonly slaDueAt: Date | null;
  readonly resolvedAt: Date | null;
  readonly now: Date;
};

/**
 * A resolved ticket is `met` or `missed` for good; an open one moves from `on_track`
 * through `at_risk` to `breached` as `now` advances. Resolving exactly on the due
 * instant is `met`.
 */
export function workOrderSlaState(input: WorkOrderSlaInput): WorkOrderSlaStateName {
  if (input.slaMinutes === null || input.slaDueAt === null) {
    return "none";
  }
  const dueMs = input.slaDueAt.getTime();
  if (input.resolvedAt !== null) {
    return input.resolvedAt.getTime() <= dueMs ? "met" : "missed";
  }
  const leftMs = dueMs - input.now.getTime();
  if (leftMs < 0) {
    return "breached";
  }
  const windowMs = input.slaMinutes * 60_000;
  return leftMs < windowMs * WORK_ORDER_SLA_AT_RISK_FRACTION ? "at_risk" : "on_track";
}

/** `30` reads `30 mins`, `60` reads `1h`, `1680` reads `1d 4h` — the reference layout's wording. */
export function formatSlaMinutes(minutes: number): string {
  const whole = Math.max(0, Math.trunc(minutes));
  const days = Math.floor(whole / 1440);
  const hours = Math.floor((whole % 1440) / 60);
  const mins = whole % 60;
  const parts: string[] = [];
  if (days > 0) {
    parts.push(`${days}d`);
  }
  if (hours > 0) {
    parts.push(`${hours}h`);
  }
  if (mins > 0 || parts.length === 0) {
    parts.push(mins === 1 ? "1 min" : `${mins} mins`);
  }
  return parts.join(" ");
}

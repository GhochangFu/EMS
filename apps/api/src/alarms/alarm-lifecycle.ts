import type { DispatchInput } from "../notifications/notifications.service";

/**
 * `F3.10` — the alarm lifecycle's decisions, with no database and no clock of
 * their own (ADR 0057 decisions 3, 5 and 6).
 *
 * `AlarmLifecycleService` (`alarm-lifecycle.service.ts`) reads the alarms,
 * the rules, the samples and the escalation catalogue and supplies `now`;
 * everything that decides *whether an alarm clears* and *which step is due*
 * lives here, so it is asserted against fixed instants rather than whenever
 * CI happens to run — the same split `rule-evaluation.ts` makes for the rule
 * engine. Nothing here writes, sends or logs.
 */

/** Decision 4: one sweep in the API process, every 30 s. */
export const LIFECYCLE_TICK_MS = 30_000;

/**
 * Decision 3: `automation_rules.clear_hold_seconds` is nullable, and `NULL`
 * means this. The default is substituted HERE, where the value is consumed,
 * never on the write path (plan D16, the `F4.46` null discipline) — so a rule
 * saved with no hold keeps reading `null` and follows this constant if it
 * ever changes.
 */
export const DEFAULT_CLEAR_HOLD_SECONDS = 120;

/**
 * What the sweep knows about one active alarm — the `bms.alarms` columns the
 * two phases read, with `ruleId` already narrowed (the selection is
 * `rule_id IS NOT NULL`, plan D4).
 */
export type LifecycleAlarm = {
  id: string;
  /** The ALARM's organization — the tenant its state writes run under. */
  organizationId: string;
  assetId: string;
  ruleId: string;
  /**
   * `bms.alarms.severity`, which is what every event's dedupe key and subject
   * carry. Never the rule's current severity: an operator who edits the rule
   * would otherwise change the key under an alarm mid-escalation, and every
   * step would send again (PR 1's review, "U7 must guarantee").
   */
  severity: string;
  message: string;
  raisedAt: Date;
  acknowledgedAt: Date | null;
  normalSince: Date | null;
};

/** What the two input builders need from the alarm's rule. */
export type LifecycleRule = {
  id: string;
  code: string;
  /**
   * Plan D12, following `F3.7`'s `toDispatchInput`: the dispatch input's
   * organization is the RULE's. `null` — a rule the `0046` backfill never
   * reached, none on real data — yields no input; the caller warns and skips.
   */
  organizationId: string | null;
  severity: string | null;
};

/**
 * One step of the profile a `(organization, severity)` maps to, flattened
 * from `alarm_escalation_steps` and `alarm_escalation_step_channels`.
 */
export type EscalationStep = {
  stepNo: number;
  afterMinutes: number;
  channelIds: readonly string[];
};

/**
 * Plan D13: the four escalation tables, read every tick and never cached.
 * `defaults` is keyed by {@link escalationKey}; a key with no entry means the
 * organization has mapped nothing for that severity, so nothing escalates
 * (decision 8: no seed, nothing escalates until an operator configures it).
 */
export type EscalationCatalog = {
  readonly defaults: ReadonlyMap<string, readonly EscalationStep[]>;
};

/** The `alarm_escalation_defaults` primary key as one string. */
export function escalationKey(organizationId: string, severity: string): string {
  return `${organizationId}:${severity}`;
}

/**
 * What the clear phase writes for one alarm, or `null` for "nothing" — and
 * `null` is the common answer: a stamp already set with the hold still
 * running is left alone, so a tick over an unchanged plant writes no row.
 */
export type ClearDecision = { normalSince: Date | null; clearedAt: Date | null } | null;

/**
 * Decision 5, one alarm, one tick.
 *
 * `matched === null` means the sample was stale (older than
 * `MAX_RAISE_SAMPLE_AGE_MS`) or there was none: no change, whatever the
 * stamps say. ADR 0027's rule that staleness outranks every value-derived
 * state applies to the clear exactly as it applies to the raise — an asset
 * that stopped reporting has not returned to normal, it has gone quiet.
 *
 * Matching resets `normal_since` (the hold restarts from the next
 * non-matching sample); non-matching starts the hold at the tick's own
 * `now`, and once `now - normal_since` reaches the hold the alarm is cleared
 * at `now`. The stamp is kept on the clear as the record of when the
 * condition went normal.
 */
export function decideClear(a: {
  matched: boolean | null;
  normalSince: Date | null;
  clearHoldSeconds: number | null;
  now: Date;
}): ClearDecision {
  if (a.matched === null) {
    return null;
  }
  if (a.matched) {
    return a.normalSince === null ? null : { normalSince: null, clearedAt: null };
  }
  if (a.normalSince === null) {
    return { normalSince: a.now, clearedAt: null };
  }
  const holdMs = (a.clearHoldSeconds ?? DEFAULT_CLEAR_HOLD_SECONDS) * 1000;
  if (a.now.getTime() - a.normalSince.getTime() >= holdMs) {
    return { normalSince: a.normalSince, clearedAt: a.now };
  }
  return null;
}

/**
 * Decision 6: the step numbers whose `after_minutes` have passed since
 * `raisedAt`, in step order. Inclusive at the boundary on purpose — the tick
 * is 30 s, so a strict comparison would slip a step by up to a whole tick for
 * nothing. Which of these have already been sent is not this function's
 * question: the ledger answers it inside `dispatchToChannels` (decision 10).
 */
export function dueSteps(
  steps: readonly { stepNo: number; afterMinutes: number }[],
  raisedAt: Date,
  now: Date,
): number[] {
  const elapsedMs = now.getTime() - raisedAt.getTime();
  return steps
    .filter((step) => elapsedMs >= step.afterMinutes * 60_000)
    .map((step) => step.stepNo)
    .sort((a, b) => a - b);
}

/**
 * The escalation step's `DispatchInput` (decision 9, plan D12/D14), or
 * `null` for a rule with no organization.
 *
 * `severity` is the alarm's, `organizationId` the rule's, `alarmId` never
 * null, `raised: true` (an event is not a transition, and `dispatchToChannel`
 * does not consult `raised` when `event` is set — but a `false` here would
 * read as a refusal to anyone grepping the ledger's inputs). The body is
 * string composition, no template: the alarm's message, how long it has gone
 * unacknowledged in whole minutes, and the step.
 */
export function escalationDispatchInput(
  alarm: LifecycleAlarm,
  rule: LifecycleRule,
  stepNo: number,
  now: Date,
): DispatchInput | null {
  if (rule.organizationId === null) {
    return null;
  }
  const minutes = Math.floor((now.getTime() - alarm.raisedAt.getTime()) / 60_000);
  return {
    ruleId: rule.id,
    ruleCode: rule.code,
    organizationId: rule.organizationId,
    alarmId: alarm.id,
    severity: alarm.severity,
    message: `${alarm.message} — unacknowledged for ${minutes} min (escalation step ${stepNo})`,
    raised: true,
    event: { kind: "escalation", step: stepNo },
  };
}

/** The cleared message's `DispatchInput` (decision 9, plan D12/D14), or `null` for a rule with no organization. */
export function clearedDispatchInput(
  alarm: LifecycleAlarm,
  rule: LifecycleRule,
): DispatchInput | null {
  if (rule.organizationId === null) {
    return null;
  }
  return {
    ruleId: rule.id,
    ruleCode: rule.code,
    organizationId: rule.organizationId,
    alarmId: alarm.id,
    severity: alarm.severity,
    message: `Cleared: ${alarm.message}`,
    raised: true,
    event: { kind: "cleared" },
  };
}

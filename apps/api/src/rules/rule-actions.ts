import type { Logger } from "@nestjs/common";

import type { AlarmRaiseResult } from "../alarms/alarm-raise.service";
import type { DispatchInput, NotificationsService } from "../notifications/notifications.service";
import { asAction } from "./rule-mapping";

/**
 * `F3.7` — the one place a rule's stored `action` is read for effect.
 *
 * Both raise paths — `RulesService.evaluateEnabledRules` (on-demand) and
 * `AlarmEngineService` (streaming) — call {@link notifyOnRaise} and nothing
 * else, so the action vocabulary has exactly one reader (ADR 0041 decision 9:
 * dispatch sits in the caller, and `AlarmRaiser` stays ADR 0033's writer that
 * does not notify). If `review` is ever given a meaning, it is given here.
 *
 * The three imports above that name `alarms/` and `notifications/` are
 * type-only on purpose: `alarms/` already imports `rules/` at runtime
 * (`alarm-message`, `rule-evaluation`), so a runtime edge back would be a
 * cycle. The types are free.
 */

/** What the two callers know about a rule at the moment its raise returned. */
export type NotifiableRule = {
  id: string;
  code: string;
  /** `null` only on a row the `0046` backfill has not reached; never in practice since `0047`. */
  organizationId: string | null;
  /** The stored `jsonb` blob, un-narrowed — `asAction` is the one narrowing. */
  action: unknown;
};

/**
 * `notify` only. `review` is inert by owner ruling (Q3, 2026-09-06) and
 * `trace_only` is the default `asAction` falls back to — including for a
 * `notify` with no `target`, which `asAction` refuses rather than this
 * function re-checking it.
 */
export function shouldNotify(action: unknown): boolean {
  return asAction(action).type === "notify";
}

/**
 * Builds the `DispatchInput` for a raise, field for field, or `null` when the
 * rule has no organization — `notification_deliveries.organization_id` is
 * `NOT NULL` (`0048`) and the rule is its only source, so there is no valid
 * input to build.
 *
 * `severity` and `message` come from the raiser's result (plan D1): they are
 * what `bms.alarms` holds for the alarm, so the notification text is the alarm
 * text by construction rather than a second computation that could drift.
 * `raised` passes straight through — `dispatch` turns `false` into a
 * `skipped_deduped` result, recorded once per channel and dedupe key
 * (decision 7; `F3.46`).
 */
export function toDispatchInput(
  rule: NotifiableRule,
  raise: AlarmRaiseResult,
): DispatchInput | null {
  if (rule.organizationId === null) {
    return null;
  }
  return {
    ruleId: rule.id,
    ruleCode: rule.code,
    organizationId: rule.organizationId,
    alarmId: raise.alarmId,
    severity: raise.severity,
    message: raise.message,
    raised: raise.raised,
  };
}

/**
 * Starts a dispatch for a `notify` rule and returns without it.
 *
 * Fire-and-forget (ADR 0041 decision 1): the promise is never awaited, so a
 * hanging SMTP server cannot delay the next rule's raise in a streaming batch
 * or the HTTP response of the on-demand sweep. `dispatch` never rejects by its
 * own contract; the `.catch` is the belt for a fake or a regression, so a
 * rejection becomes a warn rather than an unhandled promise.
 *
 * §9.6: both warn lines name the rule code and a reason only — never the alarm
 * text, a channel config or a recipient.
 *
 * @returns whether a dispatch was started — for specs, never for control flow.
 */
export function notifyOnRaise(
  deps: {
    notifications: Pick<NotificationsService, "dispatch">;
    logger: Pick<Logger, "warn">;
  },
  rule: NotifiableRule,
  raise: AlarmRaiseResult,
): boolean {
  if (!shouldNotify(rule.action)) {
    return false;
  }
  const input = toDispatchInput(rule, raise);
  if (input === null) {
    deps.logger.warn(`notification skipped for rule ${rule.code}: the rule has no organization`);
    return false;
  }
  void deps.notifications.dispatch(input).catch((err: unknown) => {
    const reason = err instanceof Error ? err.message : String(err);
    deps.logger.warn(`notification dispatch failed for rule ${rule.code}: ${reason}`);
  });
  return true;
}

import type { NotificationDeliveryEvent } from "@bms/shared";

/**
 * `F3.8` — the dedupe key written on every delivery row (ADR 0041 decision 7).
 *
 * A pure function, separate from the service, because what counts as "the same
 * notification" is a decision worth reading on its own.
 *
 * **The key is the rule and the alarm, not the message text.** Two raises of
 * the same rule against the same alarm are the same event even if the observed
 * value in the message differs by a decimal — and they will differ, because the
 * message carries the reading. Keying on the text would defeat the dedupe on
 * exactly the storm it exists to stop.
 *
 * The alarm is included rather than the rule alone: when an alarm **clears**
 * (ADR 0057 decision 1 — `cleared_at`, stamped by the lifecycle sweep) and the
 * condition breaches again, a new `bms.alarms` row exists, and that genuinely
 * is a new event the operator wants to hear about. Acknowledgement is not that
 * boundary any more: since ADR 0057 decision 2 an acknowledged alarm whose
 * condition still holds stays the same row, so it stays the same key.
 *
 * **Since `F3.46` the key has a reader, not only a writer.** Before a refusal
 * is recorded, `hasRecordedSkip` (`ledger-reads.ts`, moved out of the service by `F3.53`)
 * looks this key up on the
 * channel and writes the row only if no `skipped_deduped` row holds it yet, so
 * an unchanged plant stops growing the ledger one row per press.
 *
 * On the sweep path the refusal's key is `<ruleId>:no-alarm:<severity>`, not
 * the open alarm's: `AlarmRaiser` returns `alarmId: null` when the
 * already-open conflict is the thing that refused the raise. Suppression there
 * is therefore per rule and severity for the life of the ledger, not per alarm
 * episode — accepted by the owner (ruling Q1, 2026-09-06), because the answer
 * the row exists to give, *"already open"*, is the same for every episode of
 * it, and `bms.rule_executions` still records that the sweep reached the rule.
 *
 * **`F3.10` — the event suffix (ADR 0057 decision 9).** An escalation step or
 * a cleared message for the same alarm is a different event from its raise, so
 * it gets a different key: `:escalation:<n>` or `:cleared` appended to the
 * raise key. The kind lives here and nowhere else — no column was added — and
 * `eventDeliveryBlocked` (`ledger-reads.ts`, moved with it) reads the key back
 * before a step
 * or a clear is sent, which is what makes decision 10's "once per channel"
 * a ledger read instead of a timer. Since `F3.48` a step the hourly ceiling
 * refused leaves no row under its key, so the key survives to be retried on a
 * later tick — the absence is deliberate. The suffix goes at the end so that the
 * raise key is a strict prefix of every event key for that alarm and never
 * equal to one: the raise row is already in the ledger when the sweep asks
 * about step 1, and an equal key would make every step look already sent.
 *
 * **Since `F3.56` the key has a reader that takes it APART, and it is in this
 * file** (ADR 0041 Amendment 8). It is not the key's first reader — there are
 * four others, and counting wrongly here is how a grammar change updates one
 * call site instead of five. `hasRecordedSkip` (`ledger-reads.ts:104`),
 * `eventDeliveryBlocked` (`:211`) and `loadRaiseAttempts`
 * (`raise-attempts.ts:219`) all match the key **whole**, by equality or by
 * `IN`; `isOverHourlyLimit`'s reserved-budget predicate
 * (`notifications.service.ts:650-651`) tests its shape without decomposing it,
 * counting separators with `LIKE '%:%:%:%'`. `parseDeliveryEvent` below reads the kind back out of a
 * ledger row so `NotificationDeliveryDto` can say what a `failed` row was FOR,
 * and it sits beside the writer deliberately: a key format whose writer and
 * reader are one file can be gated by a round trip over every `DispatchEvent`
 * shape — `runEventRoundTripTests` builds each key with `buildDedupeKey` and
 * hands it straight to the parse — where a format read in a second module is a
 * claim about a file the reader never opens.
 *
 * Bounded to the column width — `dedupe_key varchar(255)` in migration 0038 —
 * so a long rule id can never make the insert fail. Two uuids, a severity and
 * the longest suffix are far short of it; the clamp is there for the case
 * nobody predicted.
 */
const MAX_DEDUPE_KEY_LENGTH = 255;

/**
 * Which lifecycle event a dispatch is for (ADR 0057 decision 9). Absent on the
 * raise path; set by the alarm lifecycle sweep.
 *
 * **`F3.52` — `stale` marks a step the sweep found too late to send** (ADR 0041
 * Amendment 6 §2, ADR 0057 Amendment 7). Two things about its placement are
 * load-bearing:
 *
 * - It is **optional**, so every existing `{ kind: "escalation", step: n }`
 *   still typechecks and only the escalation phase has to answer the question.
 * - It is on the **escalation variant only**. A raise, a re-offered raise and a
 *   cleared message cannot carry it — that is the type-level half of ruling 1's
 *   gate, and it matters because a `skipped_stale` row under a RAISE key would
 *   block that raise for ever (`channelsOwedTheRaise` excludes only
 *   `skipped_rate_limited` and a stale `skipped_unconfigured`).
 *
 * It does NOT reach `buildDedupeKey` below: a step's key stays
 * `rule:alarm:severity:escalation:<n>`, so the rows earlier ticks wrote under
 * it still match. `alarm-lifecycle.spec.ts` asserts that identity.
 */
export type DispatchEvent =
  | { kind: "escalation"; step: number; stale?: true }
  | { kind: "cleared" };

/** The key for one notification: `rule:alarm:severity`, plus the event suffix when there is one. */
export function buildDedupeKey(input: {
  ruleId: string;
  alarmId: string | null;
  severity: string | null;
  event?: DispatchEvent;
}): string {
  const parts = [input.ruleId, input.alarmId ?? "no-alarm", input.severity ?? "no-severity"];
  if (input.event?.kind === "escalation") {
    parts.push("escalation", String(input.event.step));
  } else if (input.event?.kind === "cleared") {
    parts.push("cleared");
  }
  const key = parts.join(":");
  return key.length > MAX_DEDUPE_KEY_LENGTH ? key.slice(0, MAX_DEDUPE_KEY_LENGTH) : key;
}

/**
 * `F3.56` — which lifecycle event one ledger row's attempt was FOR (ADR 0041
 * Amendment 8). Derived, never stored: no column was added, and ADR 0057
 * decision 9's "the kind lives in the dedupe key" is unchanged.
 *
 * **The four steps, in order.**
 *
 * 1. `dedupeKey === null` → `test`. `NotificationsService.record()` is the one
 *    production insert; its three `sendTest` call sites are the only ones that
 *    pass a literal `null`, and they pass a `null` rule with it.
 * 2. `ruleId === null` with a non-null key → `unknown`. No writer produces that
 *    shape.
 * 3. Strip the prefix the ROW itself determines,
 *    `${ruleId}:${alarmId ?? "no-alarm"}:`. A key that does not start with it
 *    was not written for this row → `unknown`.
 * 4. On the remainder — the severity plus at most one suffix — `:cleared` at
 *    the end is `cleared`, `:escalation:<digits>` at the end is `escalation`,
 *    and everything else is a `raise`.
 *
 * **Neither a segment count nor a bare suffix match would work.**
 * `bms.alarm_severities.code` is `varchar(64)` PRIMARY KEY with **no format
 * CHECK** — the vocabulary is open by design (migration `0030`, ADR 0032). A
 * severity code containing a colon defeats a segment count. A severity code
 * literally named `cleared` defeats a bare `/:cleared$/` over the whole key,
 * because `rule:alarm:cleared` is a *raise* of a `cleared`-severity alarm.
 * Stripping the prefix the row supplies removes both, because the two uuids are
 * known values rather than parsed ones. `runSeverityThatMimicsASuffixIsARaise`
 * holds all three cases.
 *
 * **Two residual limits, named rather than claimed away.** A severity code
 * whose own text *ends* in `:cleared` or `:escalation:<digits>` is still read as
 * that event; and `buildDedupeKey` clamps at 255 and cuts the tail, so a key
 * long enough to lose its suffix reads as a raise. Both are asserted —
 * `runResidualLimitSeveritySuffix` and `runResidualLimitClampedTail` — so a
 * later fix reddens a test instead of silently contradicting the ADR.
 *
 * **`unknown` is unreachable from the writers**, and exists so the parse is
 * total without lying: a row whose key does not start with its own rule and
 * alarm was not written by this code, and calling it a raise would be a claim
 * about a row nothing here produced. `runUnknownWhenTheRuleIsNull`,
 * `…KeyIsAnotherRules` and `…KeyIsAnotherAlarms` drive it through this function
 * directly, so it is measured rather than dead prose.
 *
 * Pure and silent: it logs nothing (AGENTS.md §9.6), because the key it reads
 * carries a rule uuid, an alarm uuid and the severity code.
 */
export function parseDeliveryEvent(row: {
  dedupeKey: string | null;
  ruleId: string | null;
  alarmId: string | null;
}): NotificationDeliveryEvent {
  if (row.dedupeKey === null) return "test";
  if (row.ruleId === null) return "unknown";

  const prefix = `${row.ruleId}:${row.alarmId ?? "no-alarm"}:`;
  if (!row.dedupeKey.startsWith(prefix)) return "unknown";
  const rest = row.dedupeKey.slice(prefix.length);

  if (rest.endsWith(":cleared")) return "cleared";
  if (/:escalation:\d+$/.test(rest)) return "escalation";
  return "raise";
}

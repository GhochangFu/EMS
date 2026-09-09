import type { AlarmListItem } from "@bms/shared";
import { automationRuleOperatorSchema } from "@bms/shared";

import { buildDedupeKey } from "../notifications/dedupe-key";
import { MAX_EVENT_ATTEMPTS } from "../notifications/dispatch-policy";
import type { NotificationChannelRow } from "../notifications/notification-transport";
import { PROCESS_STARTED_AT } from "../notifications/notifications.config";
import type { DispatchInput } from "../notifications/notifications.service";
import type { RaiseAttemptsRead } from "../notifications/raise-attempts";
// `LostLedgerRows` is a type here, not a value: this module reads the instance
// off `deps` and never constructs one — `AlarmLifecycleService` owns the single
// instance. It is imported so the `{@link}`s below resolve.
import type { LostLedgerRows, RaiseAttemptRow, RaiseKeyRef } from "../notifications/raise-retry";
import { channelsOwedTheRaise } from "../notifications/raise-retry";
import { shouldNotify } from "../rules/rule-actions";
import type { LatestSampleLoader } from "../rules/rule-evaluation";
import { compare } from "../rules/rule-evaluation";
import type { RuleRow } from "../rules/rules.types";

import {
  type EscalationCatalog,
  type EscalationStep,
  clearedDispatchInput,
  decideClear,
  dueSteps,
  escalationDispatchInput,
  escalationKey,
  raiseRetryDispatchInput,
} from "./alarm-lifecycle";
import type { ActiveAlarm, AlarmLifecycleDeps, AlarmStateUpdate } from "./alarm-lifecycle.service";
import { isSampleFreshEnoughToRaise } from "./alarm-raise.service";

/**
 * `F3.10` — the three phases of one alarm lifecycle tick, lifted out of
 * `alarm-lifecycle.service.ts` unchanged.
 *
 * **This module is a move, not a design.** The service stood at 991 of
 * AGENTS.md §4.5's 1000-line cap — nine lines of headroom, with the next rows
 * in this area still to land — so the part that needs nothing from the Nest
 * class moved out. Every function below is byte-identical to its version at
 * `be2e61b9` apart from the `export` keyword on the three phases and on
 * {@link reasonOf}, which the service still calls; the branch's own gate is
 * that diff, not a green suite.
 *
 * **The precedent is one directory away, and it is narrower than it looks.**
 * Of the three modules `F3.51` put beside `notifications.service.ts`, only
 * `dispatch-policy.ts` is a carve-out under the cap: `MAX_EVENT_ATTEMPTS` and
 * `offeredAgainWithoutAsking` stood in the service at `16dc9e89~1` lines 150
 * and 172 and moved out when the review's High finding needed room, which its
 * own docblock records as 958 lines. `raise-attempts.ts` is NEW code placed
 * outside the class for the same cap reason, and `raise-retry.ts` is new code
 * kept pure by design, not a size decision. The service ended that commit
 * LARGER, 882 to 986 — so "the repo extracts when a file nears the cap" is
 * true of two of those three files, and the sentence here used to claim all
 * three.
 *
 * **The order is the sweep's order, and it is load-bearing**: clear, then
 * raise-retry, then escalation. {@link runClearPhase} returns the ids that
 * cleared this tick and both later phases leave them out (ADR 0057 decision 6
 * — a clear removes the alarm from the selection). `runLifecycleSweep` in the
 * service is the only caller of all three, and it is where the reasons for
 * each phase are written.
 *
 * **The dependencies stay a parameter, and the types stay in the service.**
 * {@link AlarmLifecycleDeps}, {@link ActiveAlarm} and {@link AlarmStateUpdate}
 * are still declared in `alarm-lifecycle.service.ts` and are imported here as
 * TYPES only, so the emitted JavaScript holds no edge back to the service and
 * there is no runtime cycle.
 *
 * **No suite imports this module, and FOUR of them gate it.** Every case still
 * drives `runLifecycleSweep` over fakes, which is why the move needed no
 * change to a spec — but the gate is spread across
 * `alarm-lifecycle-raise-retry.spec.ts` (23 sweeps),
 * `alarm-lifecycle.service.spec.ts` (21),
 * `alarm-lifecycle-cleared-no-recipients.spec.ts` (9) and
 * `alarm-lifecycle-escalation-lost-rows.spec.ts` (6). **Run all four.** This
 * docblock named only the second until review measured the split: 38 of the 59
 * sweeps are outside it, and `runRaiseRetryPhase`'s invariants are almost
 * entirely in the first — so `vitest run alarm-lifecycle.service` is green on a
 * change it never exercised.
 */

type ClearPhaseInput = {
  activeAlarms: ActiveAlarm[];
  rulesById: Map<string, RuleRow>;
  loadSample: LatestSampleLoader;
  now: Date;
};

/**
 * Decision 5. Decides every alarm first, then writes once per organization;
 * a failing organization is warned and the next one still runs
 * (`runHealthRollupSweep`'s shape — one bad tenant must not stall every
 * other tenant's clears). Returns the ids that cleared this tick, so the
 * escalation phase can leave them out (decision 6: a clear removes the
 * alarm from the selection).
 */
export async function runClearPhase(deps: AlarmLifecycleDeps, input: ClearPhaseInput): Promise<Set<string>> {
  const updatesByOrganization = new Map<string, AlarmStateUpdate[]>();
  const alarmsById = new Map(input.activeAlarms.map((alarm) => [alarm.id, alarm]));

  for (const alarm of input.activeAlarms) {
    const rule = input.rulesById.get(alarm.ruleId);
    if (!rule) {
      continue;
    }
    const matched = await matchedAgainstLatestSample(rule, input.loadSample, input.now);
    const decision = decideClear({
      matched,
      normalSince: alarm.normalSince,
      clearHoldSeconds: rule.clearHoldSeconds,
      now: input.now,
    });
    if (decision === null) {
      continue;
    }
    const updates = updatesByOrganization.get(alarm.organizationId) ?? [];
    updates.push({ alarmId: alarm.id, ...decision });
    updatesByOrganization.set(alarm.organizationId, updates);
  }

  const clearedIds = new Set<string>();
  for (const [organizationId, updates] of updatesByOrganization) {
    let cleared: AlarmListItem[];
    try {
      cleared = await deps.writeAlarmState(organizationId, updates);
    } catch (err) {
      // §9.6: the organization id and the cause; never the alarm text.
      deps.logger.warn(
        `alarm lifecycle: organization ${organizationId} state write failed: ${reasonOf(err)}`,
      );
      continue;
    }
    for (const item of cleared) {
      clearedIds.add(item.id);
      // After commit — `writeAlarmState` has returned, so the transaction is
      // over; a rolled-back clear must never be announced.
      deps.broadcastCleared(item);
      const alarm = alarmsById.get(item.id);
      if (alarm) {
        await notifyCleared(deps, alarm, input.rulesById.get(alarm.ruleId));
      }
    }
  }
  return clearedIds;
}

/**
 * `true`/`false` when a fresh sample exists to compare, `null` when it is
 * stale or absent (ADR 0027: no change), or when the rule has lost its
 * asset, point, operator or threshold (plan D4: skipped with no change —
 * `evaluateThresholdRule`'s completeness guard, and the same operator
 * vocabulary it trusts).
 */
async function matchedAgainstLatestSample(
  rule: RuleRow,
  loadSample: LatestSampleLoader,
  now: Date,
): Promise<boolean | null> {
  // Plan D4: "normal" is defined by a threshold rule's operator and threshold,
  // and only by those. A `time_window` rule has no sample to compare against.
  // Gated HERE rather than trusted to the loader: `batchedLatestPointValues`
  // happens to skip non-threshold rules today, so such a rule finds no sample
  // and changes nothing — but that is the loader's shape, not a promise, and
  // the sweep must not depend on it.
  if (rule.ruleType !== "threshold") {
    return null;
  }
  if (!rule.assetId || !rule.pointKey || rule.thresholdValue === null) {
    return null;
  }
  const operator = automationRuleOperatorSchema.safeParse(rule.operator);
  if (!operator.success) {
    return null;
  }
  const sample = await loadSample(rule.assetId, rule.pointKey);
  if (!sample || !isSampleFreshEnoughToRaise(sample.time, now)) {
    return null;
  }
  return compare(sample.value, operator.data, rule.thresholdValue);
}

/**
 * Decision 9 / ruling Q5: the cleared message goes to the channels that hold
 * a `sent` row for this alarm — the raise or any step — and to nobody else.
 * The recipient read is keyed on the RULE's organization, the same value
 * every delivery row for the alarm was stamped with.
 *
 * Caught per alarm: the clear has already committed and the next tick will
 * not see this alarm again, so a read that throws here is warned rather than
 * allowed to abort the rest of the tick's clears and every step.
 */
async function notifyCleared(
  deps: AlarmLifecycleDeps,
  alarm: ActiveAlarm,
  rule: RuleRow | undefined,
): Promise<void> {
  if (!rule) {
    return;
  }
  const input = clearedDispatchInput(alarm, rule);
  if (input === null) {
    deps.logger.warn(
      `alarm lifecycle: rule ${rule.code} (${rule.id}) has no organization; alarm ${alarm.id} cleared, nobody notified`,
    );
    return;
  }
  try {
    // `F3.55` (ADR 0057 Amendment 6): both of these returns were silent — no
    // send, no row, no retry, no log line, which ruling Q-A calls worse than
    // the defect `F3.48` closed. Each warns now; NEITHER writes a delivery row,
    // and the amendment gives the different reason at each. §9.6 bounds both
    // lines to the alarm id and the rule code — never the alarm text, a
    // recipient or a channel's configuration.
    const channelIds = await deps.sentChannelIdsForAlarm(alarm.id, input.organizationId);
    if (channelIds.length === 0) {
      // An empty answer has two readings and this line has to fit both: no
      // channel is joined to the rule at all (no `rule_notifications` row —
      // what a seeded or a template-built rule has), or the raise was offered
      // and left no `sent` row. Amendment 6 separates them and says what each
      // one owes; the predicate this line states is the same either way.
      deps.logger.warn(
        `alarm lifecycle: alarm ${alarm.id} rule ${rule.code} cleared with no cleared message: no channel holds a sent row for it`,
      );
      return;
    }
    const channels = await deps.loadChannels(channelIds);
    if (channels.length === 0) {
      // Named recipients, every one disabled now: a row here would record an
      // attempt against a channel that was never asked to send.
      deps.logger.warn(
        `alarm lifecycle: alarm ${alarm.id} rule ${rule.code} cleared with no cleared message: every channel that holds a sent row for it is disabled`,
      );
      return;
    }
    await deps.dispatchToChannels(channels, input);
  } catch (err) {
    deps.logger.warn(
      `alarm lifecycle: cleared message for alarm ${alarm.id} rule ${rule.code} failed: ${reasonOf(err)}`,
    );
  }
}

type RaiseRetryPhaseInput = {
  activeAlarms: ActiveAlarm[];
  rulesById: Map<string, RuleRow>;
  clearedIds: Set<string>;
};

/** One alarm the phase may re-offer, with the input and the ledger key already built. */
type RetryCandidate = {
  alarm: ActiveAlarm;
  rule: RuleRow;
  input: DispatchInput;
  ref: RaiseKeyRef;
};

/**
 * `F3.51` — the third phase (ADR 0041 Amendment 5, ADR 0057 Amendment 5).
 *
 * A raise notification that did not send was lost for the life of the alarm.
 * Its outcome is recorded under the key `rule:alarm:severity`; the next
 * evaluation of the same rule arrives with `raised: false` and `alarmId: null`,
 * so `buildDedupeKey` produces a different key, the dispatch lands in the
 * transition-dedupe branch, writes `skipped_deduped` and sends nothing. The
 * alarm stays open, nobody is told, and the ledger row reads as a delay rather
 * than as a loss. This phase re-offers the alarm's ORIGINAL raise — the same
 * input, the same key, no event — to exactly the channels the ledger shows are
 * still owed it.
 *
 * **Between the clear and the escalation, and it is both directions.** After
 * the clear: an alarm cleared this tick has already had its "Cleared:" message,
 * and re-offering its raise afterwards would tell people about a resolved alarm
 * in the wrong order. Before the escalation: the two phases share one hourly
 * budget per channel and organization and whichever dispatches first takes it,
 * so an escalation backlog must not starve a new critical alarm's raise.
 *
 * **`now` is not a parameter, and its absence is the point.** The re-offered
 * message is the alarm's own, verbatim, with no age and no staleness marker
 * (that complaint is `F3.52`'s and is inherited, not fixed), and the only
 * instant the decision consults is `PROCESS_STARTED_AT` — a constant, not the
 * tick.
 *
 * Reads per tick: `ceil(eligible / RAISE_ATTEMPT_BATCH_SIZE)` ledger
 * statements — one before the `F3.51` review, chunked since, so a fleet under
 * 500 open eligible alarms still pays exactly one — plus one channel query per
 * distinct rule with an eligible alarm (case R13 holds the memo).
 */
export async function runRaiseRetryPhase(
  deps: AlarmLifecycleDeps,
  input: RaiseRetryPhaseInput,
): Promise<void> {
  // Reclaim first, over the WHOLE active set rather than the eligible list: an
  // acknowledged or non-notifying alarm is still open, and evicting it here
  // would forget a real loss the moment somebody acknowledged the alarm.
  deps.lostLedgerRows.retainAlarms(new Set(input.activeAlarms.map((alarm) => alarm.id)));

  const candidates: RetryCandidate[] = [];
  for (const alarm of input.activeAlarms) {
    // Cleared this tick — see the header; and owner ruling 4 (ADR 0057
    // Amendment 5's numbering, which this code follows), an acknowledged
    // alarm is skipped: somebody is already on it.
    if (input.clearedIds.has(alarm.id) || alarm.acknowledgedAt !== null) {
      continue;
    }
    const rule = input.rulesById.get(alarm.ruleId);
    if (!rule) {
      continue;
    }
    // NOT redundant with the evidence conjunct, in the one case that matters:
    // a rule that WAS `notify` when the alarm was raised and has since been
    // switched to `review` or `trace_only` has rows under the key, so it has
    // evidence, and only this gate stops it being re-offered. Deliberately
    // different from the escalation phase's ruling Q8 ("the rule's action is
    // not consulted"): a step is the organization's severity policy, whereas
    // the raise IS the action.
    if (!shouldNotify(rule.action)) {
      continue;
    }
    const dispatchInput = raiseRetryDispatchInput(alarm, rule);
    if (dispatchInput === null) {
      // §9.6: the rule code, the rule id and the alarm id — the line
      // `notifyCleared` writes, never the alarm text.
      deps.logger.warn(
        `alarm lifecycle: rule ${rule.code} (${rule.id}) has no organization; alarm ${alarm.id} raise not re-offered`,
      );
      continue;
    }
    candidates.push({
      alarm,
      rule,
      input: dispatchInput,
      ref: {
        alarmId: alarm.id,
        // The RULE's organization, which is what every delivery row for this
        // alarm was stamped with — never `alarm.organizationId`.
        organizationId: dispatchInput.organizationId,
        dedupeKey: buildDedupeKey(dispatchInput),
      },
    });
  }
  if (candidates.length === 0) {
    return;
  }

  let read: RaiseAttemptsRead;
  try {
    read = await deps.loadRaiseAttempts(candidates.map((candidate) => candidate.ref));
  } catch (err) {
    // Warn and RETURN — never fall back to treating every channel as owed.
    // Silence costs one tick; a blind re-offer costs a duplicate to every
    // channel of every open alarm. The `return` is inside the phase, so
    // `runEscalationPhase` still runs in the same tick (case R9 holds both
    // halves).
    //
    // §9.6, and the shape is a correction to this item's plan: the read is
    // phase-wide, so there is no one alarm id to name and a list of them is
    // unbounded at a few hundred open alarms. The count and the cause are what
    // a reader can act on; the per-alarm line below names ids because there it
    // is one alarm.
    deps.logger.warn(
      `alarm lifecycle: raise-retry ledger read failed for ${candidates.length} alarm(s): ${reasonOf(err)}`,
    );
    return;
  }

  // One BATCH of the read failed, not the whole of it (`F3.51` review,
  // Medium). The read is chunked at `RAISE_ATTEMPT_BATCH_SIZE`, so a statement
  // that fails costs only the alarms it bound: the rest of the fleet's rows
  // came back and are decided below, and the alarms in `read.unread` are
  // skipped exactly as a phase-wide failure would have skipped everything —
  // never treated as owed, for the reason above. §9.6: counts and the first
  // cause, no alarm id list (it is unbounded) and no alarm text.
  if (read.reasons.length > 0) {
    deps.logger.warn(
      `alarm lifecycle: raise-retry ledger read failed for ${read.reasons.length} batch(es), ` +
        `${read.unread.size} of ${candidates.length} alarm(s) not decided this tick: ${read.reasons[0] ?? ""}`,
    );
  }

  const rowsByAlarm = new Map<string, RaiseAttemptRow[]>();
  for (const row of read.rows) {
    const forAlarm = rowsByAlarm.get(row.alarmId) ?? [];
    forAlarm.push(row);
    rowsByAlarm.set(row.alarmId, forAlarm);
  }

  // One channel read per rule per tick, however many of its alarms are owed —
  // `loadStepChannels`'s cache shape, keyed on the rule id.
  const channelsByRule = new Map<string, Promise<NotificationChannelRow[]>>();
  const loadRuleChannels = (ruleId: string): Promise<NotificationChannelRow[]> => {
    let pending = channelsByRule.get(ruleId);
    if (!pending) {
      pending = deps.loadRuleChannels(ruleId);
      channelsByRule.set(ruleId, pending);
    }
    return pending;
  };

  // Warned once per tick below, not once per pair: at the cap the fleet is in
  // one state, and one line saying so is what an operator can act on.
  let refusedByTheCap = 0;

  for (const candidate of candidates) {
    // This alarm's batch did not return, so the phase decides nothing about
    // it and does not pay a channel read to find that out.
    //
    // **It is not what stops a blind re-offer, and saying so would be a false
    // claim.** An unread alarm's rows are in the batch that failed, so its
    // group below is empty, and ruling 3's evidence conjunct already reads an
    // empty group as "not owed" — the safe answer, and the same one a
    // phase-wide failure gives. What this line buys is the read: without it
    // every undecidable alarm still costs one `loadRuleChannels` per rule that
    // has no decidable alarm, which is the cost R9 refuses for the phase-wide
    // case and R16 refuses for the per-batch one. It is also the line that
    // keeps the intent explicit if the conjunct is ever revisited.
    if (read.unread.has(candidate.alarm.id)) {
      continue;
    }
    // Caught per alarm, the escalation phase's shape: one bad alarm must not
    // abort the tick, and the next tick retries this one.
    try {
      const channels = await loadRuleChannels(candidate.rule.id);
      if (channels.length === 0) {
        continue;
      }
      const owed = channelsOwedTheRaise({
        channels,
        // The organization is re-checked here rather than trusted to the
        // read: the ledger query's three `IN` lists are independent, so a row
        // for this alarm under another organization could reach the group.
        rows: (rowsByAlarm.get(candidate.alarm.id) ?? []).filter(
          (row) => row.organizationId === candidate.ref.organizationId,
        ),
        maxAttempts: MAX_EVENT_ATTEMPTS,
        processStartedAt: PROCESS_STARTED_AT,
      });
      if (owed.length === 0) {
        continue;
      }
      // The lost-row filter and the remembering are one shared call — see
      // {@link dispatchRememberingLostRows}. The key is the RAISE key, and it
      // is the only key this phase ever hands it.
      refusedByTheCap += await dispatchRememberingLostRows(deps, {
        alarmId: candidate.alarm.id,
        dedupeKey: candidate.ref.dedupeKey,
        channels: owed,
        input: candidate.input,
      });
    } catch (err) {
      deps.logger.warn(
        `alarm lifecycle: raise retry for alarm ${candidate.alarm.id} rule ${candidate.rule.code} failed: ${reasonOf(err)}`,
      );
    }
  }

  if (refusedByTheCap > 0) {
    // §9.6: counts and the cap, no ids. Each of these rows has already been
    // reported individually by `record()`'s own `logger.error`; this line says
    // the sweep has stopped being able to remember them, so those channels go
    // back to being re-offered every tick.
    deps.logger.warn(
      `alarm lifecycle: raise-retry lost-row memory is full at ${deps.lostLedgerRows.cap} entries; ` +
        `${refusedByTheCap} further lost row(s) this tick are not remembered and will be re-offered`,
    );
  }
}

/**
 * `F3.51` second review (High) — offer a dispatch only to the channels whose
 * row the ledger can still record, and remember the ones whose row did not
 * land. Returns how many losses the cap refused, for the caller's one warn.
 *
 * **Shared by both re-offering phases, because both had the same hole.** Every
 * bound the two phases lean on counts ROWS — `MAX_EVENT_ATTEMPTS` counts them
 * under the key, `isOverHourlyLimit` counts `sent` ones in the trailing hour —
 * so a channel whose insert keeps throwing has no bound at all: the ledger
 * never changes, the predicate keeps answering "still owed", and the phase
 * sends to that channel twice a minute for the life of the alarm with no trace
 * of any of it. The first review closed that on the raise path only; the
 * escalation phase discarded its outcomes and kept the loop.
 *
 * **`dedupeKey` is the caller's, and the two callers never share one.** The
 * raise-retry phase passes the alarm's RAISE key (`rule:alarm:severity`) and
 * the escalation phase passes the STEP's (`…:escalation:<n>`) — the same
 * separation `dispatch-policy.ts` states for the row accounting, for the same
 * reason: a lost step row says nothing about the raise, and the two ledger
 * reads that bound them filter on their own key. Handing this the wrong key
 * would silence a message that was never offered.
 *
 * The two callers share ONE {@link LostLedgerRows} instance, so they share its
 * cap as well as its reclaim — see the class docblock.
 */
async function dispatchRememberingLostRows(
  deps: AlarmLifecycleDeps,
  a: {
    alarmId: string;
    dedupeKey: string;
    channels: readonly NotificationChannelRow[];
    input: DispatchInput;
  },
): Promise<number> {
  const offered = a.channels.filter(
    (channel) => !deps.lostLedgerRows.has(a.alarmId, channel.id, a.dedupeKey),
  );
  if (offered.length === 0) {
    return 0;
  }
  let refusedByTheCap = 0;
  for (const outcome of await deps.dispatchToChannels(offered, a.input)) {
    // `rowLost` is true in exactly one case: an insert was attempted and it
    // threw. An exit that writes no row BY DESIGN reports `false`, and treating
    // those as losses would stop re-offering a ceiling-refused dispatch — the
    // very thing `F3.48` ruling Q1 leaves unwritten so the next tick can ask.
    if (!outcome.rowLost) {
      continue;
    }
    if (!deps.lostLedgerRows.add(a.alarmId, outcome.channelId, a.dedupeKey)) {
      refusedByTheCap += 1;
    }
  }
  return refusedByTheCap;
}

type EscalationPhaseInput = {
  activeAlarms: ActiveAlarm[];
  rulesById: Map<string, RuleRow>;
  catalog: EscalationCatalog;
  clearedIds: Set<string>;
  now: Date;
};

/**
 * Decision 6. Over the alarms still active after the clear phase and not
 * acknowledged: the organization's profile for the alarm's severity, the
 * steps whose offset has passed since `raised_at`, each sent to its channels
 * through `dispatchToChannels`, which answers a step already in the ledger
 * from the ledger (decision 10). Ruling Q8: the rule's `action` is not
 * consulted — the severity map is the organization's policy.
 *
 * A step's channels are loaded once per tick, however many alarms are due
 * for it: the id list is the cache key, so two steps naming the same
 * channels share one read too.
 *
 * **A step whose delivery row did not land is not re-offered** (`F3.51` second
 * review, High). Decision 10's idempotency is a ledger read, so it can only
 * answer from rows that exist: with a ledger that serves reads and refuses
 * inserts, `eventDeliveryBlocked` finds nothing under the step's key, never
 * blocks, and this phase re-sends the due step on every tick for the life of
 * the alarm. The outcomes are therefore fed to the same
 * {@link LostLedgerRows} the raise-retry phase uses — under the STEP's own
 * dedupe key, never the alarm's raise key, because the two accountings are
 * separate everywhere else too. See {@link dispatchRememberingLostRows}.
 */
export async function runEscalationPhase(
  deps: AlarmLifecycleDeps,
  input: EscalationPhaseInput,
): Promise<void> {
  const channelsByIds = new Map<string, Promise<NotificationChannelRow[]>>();
  const loadStepChannels = (step: EscalationStep): Promise<NotificationChannelRow[]> => {
    const key = step.channelIds.join(",");
    let pending = channelsByIds.get(key);
    if (!pending) {
      pending = step.channelIds.length === 0 ? Promise.resolve([]) : deps.loadChannels(step.channelIds);
      channelsByIds.set(key, pending);
    }
    return pending;
  };

  // Warned once per tick, not once per pair — `runRaiseRetryPhase`'s shape and
  // its reason. The wording names THIS phase: both lines quote one shared cap,
  // and an operator reading "the memory is full" has to know which accounting
  // stopped remembering.
  let refusedByTheCap = 0;

  for (const alarm of input.activeAlarms) {
    if (alarm.acknowledgedAt !== null || input.clearedIds.has(alarm.id)) {
      continue;
    }
    const rule = input.rulesById.get(alarm.ruleId);
    if (!rule) {
      continue;
    }
    const steps = input.catalog.defaults.get(escalationKey(alarm.organizationId, alarm.severity));
    if (!steps || steps.length === 0) {
      continue;
    }
    for (const stepNo of dueSteps(steps, alarm.raisedAt, input.now)) {
      const step = steps.find((candidate) => candidate.stepNo === stepNo);
      if (!step) {
        continue;
      }
      const dispatchInput = escalationDispatchInput(alarm, rule, stepNo, input.now);
      if (dispatchInput === null) {
        deps.logger.warn(
          `alarm lifecycle: rule ${rule.code} (${rule.id}) has no organization; alarm ${alarm.id} not escalated`,
        );
        break;
      }
      // Security M1: caught per step, `notifyCleared`'s shape. A channel read
      // that rejects for one alarm must not abort every later alarm's steps
      // in the tick; the next tick retries this one. §9.6: ids, the rule code
      // and the step number — never the alarm text.
      try {
        const channels = await loadStepChannels(step);
        if (channels.length === 0) {
          continue;
        }
        refusedByTheCap += await dispatchRememberingLostRows(deps, {
          alarmId: alarm.id,
          // The STEP's key, which is what `dispatchToChannels` will build from
          // this same input and what `eventDeliveryBlocked` reads. Never the
          // alarm's raise key: a lost raise row must not silence a step, and a
          // lost step row must not silence the raise.
          dedupeKey: buildDedupeKey(dispatchInput),
          channels,
          input: dispatchInput,
        });
      } catch (err) {
        deps.logger.warn(
          `alarm lifecycle: escalation step ${stepNo} for alarm ${alarm.id} rule ${rule.code} failed: ${reasonOf(err)}`,
        );
      }
    }
  }

  if (refusedByTheCap > 0) {
    // §9.6: counts and the cap, no ids — every one of these rows has already
    // been reported individually by `record()`'s own `logger.error`.
    deps.logger.warn(
      `alarm lifecycle: escalation lost-row memory is full at ${deps.lostLedgerRows.cap} entries; ` +
        `${refusedByTheCap} further lost row(s) this tick are not remembered and will be re-offered`,
    );
  }
}

/** An error's message, or its `String()` form — every phase's `catch` logs through this. */
export function reasonOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

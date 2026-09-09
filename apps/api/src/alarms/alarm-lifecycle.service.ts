import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";

import {
  alarmEscalationDefaults,
  alarmEscalationStepChannels,
  alarmEscalationSteps,
  alarms,
  assets,
  type BmsDb,
} from "@bms/db";
import type { AlarmListItem } from "@bms/shared";
import { automationRuleOperatorSchema } from "@bms/shared";

import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../database/database.tokens";
import { withTenant } from "../database/tenant-context";
import { loadEnabledChannelsByIds } from "../notifications/channel-reads";
import { ChannelsService } from "../notifications/channels.service";
import { buildDedupeKey } from "../notifications/dedupe-key";
import type { NotificationChannelRow } from "../notifications/notification-transport";
import { PROCESS_STARTED_AT } from "../notifications/notifications.config";
import type { DispatchInput } from "../notifications/notifications.service";
import { MAX_EVENT_ATTEMPTS } from "../notifications/dispatch-policy";
import { NotificationsService } from "../notifications/notifications.service";
import type { RaiseAttemptsRead } from "../notifications/raise-attempts";
import { loadRaiseAttempts } from "../notifications/raise-attempts";
import type { RaiseAttemptRow, RaiseKeyRef } from "../notifications/raise-retry";
import { LostLedgerRows, channelsOwedTheRaise } from "../notifications/raise-retry";
import { shouldNotify } from "../rules/rule-actions";
import type { LatestSampleLoader } from "../rules/rule-evaluation";
import { compare } from "../rules/rule-evaluation";
import { selectRuleRows } from "../rules/rule-reads";
import { batchedLatestPointValues } from "../rules/rule-samples";
import type { RuleRow } from "../rules/rules.types";
import { runSweepLoop } from "../scheduling/sweep-loop";
import { sleep } from "../telemetry/sleep";

import {
  type EscalationCatalog,
  type EscalationStep,
  LIFECYCLE_TICK_MS,
  type LifecycleAlarm,
  clearedDispatchInput,
  decideClear,
  dueSteps,
  escalationDispatchInput,
  escalationKey,
  raiseRetryDispatchInput,
} from "./alarm-lifecycle";
import { alarmListItemColumns, toAlarmListItem } from "./alarm-list-item";
import { isSampleFreshEnoughToRaise } from "./alarm-raise.service";
import { AlarmsGateway } from "./alarms.gateway";

/**
 * `F3.10` — the alarm lifecycle sweep (ADR 0057 decisions 4, 5, 6).
 *
 * `bms.alarms` had one closure — acknowledgement — so a transient breach
 * stayed open until a human clicked, and an acknowledged alarm whose
 * condition still held re-raised as a new row. Since migration `0066` an
 * alarm is active while `cleared_at IS NULL`, and this sweep is the one
 * writer of `cleared_at` and `normal_since` — `AlarmRaiser` stays the one
 * raiser (ADR 0033), and nothing else touches either stamp.
 *
 * **Three phases since `F3.51`, one tick.** The clear phase compares every
 * active alarm's rule against the latest fresh sample and stamps the hold or
 * the clear (`decideClear`). The raise-retry phase (`runRaiseRetryPhase`, ADR
 * 0041 Amendment 5, ADR 0057 Amendment 5) re-offers the ORIGINAL raise of a
 * still-open alarm whose raise reached nobody, to exactly the channels the
 * ledger says are still owed it. The escalation phase, over the alarms still
 * active after the clear and not acknowledged, sends each due step of the
 * organization's severity profile. The two stamps and the delivery ledger are
 * the state, so a repeated tick sends nothing twice —
 * `dispatchToChannels` asks the ledger before every event (decision 10, plan
 * D3), which is why the sweep re-dispatches every due step every tick without a
 * "sent" set of its own, and the raise retry answers the same way from
 * `channelsOwedTheRaise`.
 *
 * **One exception, and it is deliberate** (`F3.51` review, High). This class
 * holds a {@link LostLedgerRows}: the (alarm, channel, DEDUPE key) triples
 * whose delivery row did NOT land. Both re-offering phases feed it and both
 * read it — the raise retry under the alarm's raise key, the escalation under
 * each step's own key (the second review; the first wired the raise path only).
 * It is the only thing any phase remembers between
 * ticks, and this file used to say no phase remembered anything — that sentence
 * is false now. The ledger remains the only CROSS-PROCESS state: this memory is
 * in process and a restart empties it. That is the honest trade, and it is
 * forced: a bound that survived a restart would have to be a row, and a row is
 * exactly what could not be written. `PROCESS_STARTED_AT` already behaves this
 * way for the unconfigured watermark.
 *
 * **What a restart costs is one extra send per remembered pair**, not nothing.
 * The ledger still holds the same `failed` row it held before, so the first
 * tick after a restart reads every one of those pairs as owed and offers them
 * again. Under a restart LOOP — and a database refusing writes is exactly when
 * this API may be crash-looping — that replay is unbounded. See
 * {@link LostLedgerRows}.
 *
 * **Why `runLifecycleSweep` takes its dependencies.** Every read and write is
 * a function on {@link AlarmLifecycleDeps}, so the spec runs the eight cases
 * the plan lists against recording fakes at fixed instants. The class below
 * is the wiring: the two pools, the notification and channel services, the
 * gateway, and the loop.
 *
 * **Organizations, two of them per alarm (plan D12).** The alarm's state
 * writes run under the ALARM's organization — `withTenant`, the `0047`
 * policy, exactly as `AlarmRaiser` writes it. The dispatch input's
 * organization is the RULE's, as `F3.7`'s `toDispatchInput` builds it, and
 * the same value goes to `sentChannelIdsForAlarm`. On real data the two are
 * equal (`AlarmRaiser` refuses a raise where they differ), and a rule with no
 * organization is skipped with a warn rather than given one.
 *
 * **`fleetDb`, with its reasons (ADR 0043 Amendment 3, §4.3).** This is a
 * system sweep with no JWT that spans every tenant — the reason
 * `AlarmEngineService` and `HealthRollupService` give — so the alarm
 * selection, the rule rows and the escalation catalogue are fleet reads; on
 * the tenant pool the `0047` policies would return nothing and no alarm
 * would ever clear. The catalogue is read every tick, not cached (plan D13):
 * four small tables, one join, and an operator who maps a severity sees it
 * act on the next tick.
 */

/** The `bms.alarms` row the sweep works on — see `LifecycleAlarm` for the columns. */
export type ActiveAlarm = LifecycleAlarm;

/** One alarm's state write: both stamps, applied `WHERE id = $1 AND cleared_at IS NULL`. */
export type AlarmStateUpdate = {
  alarmId: string;
  normalSince: Date | null;
  clearedAt: Date | null;
};

export interface AlarmLifecycleDeps {
  /** Every active alarm with a rule (plan D4: `cleared_at IS NULL AND rule_id IS NOT NULL`). Fleet read. */
  loadActiveAlarms(): Promise<ActiveAlarm[]>;
  /** Every rule row, as `evaluateEnabledRules` reads them. Fleet read. */
  loadRules(): Promise<RuleRow[]>;
  /** The latest sample per `(asset, point)` the given rules need — `batchedLatestPointValues`. */
  loadSamples(rows: RuleRow[]): Promise<LatestSampleLoader>;
  /** The four escalation tables, read every tick (plan D13). Fleet read. */
  loadEscalation(): Promise<EscalationCatalog>;
  /**
   * Applies the updates under `withTenant(organizationId)` and returns the
   * rows that CLEARED, read back inside the same transaction as
   * `AlarmListItem`s for the broadcast.
   */
  writeAlarmState(organizationId: string, updates: AlarmStateUpdate[]): Promise<AlarmListItem[]>;
  /** `NotificationsService.sentChannelIdsForAlarm` — the cleared message's recipients (ruling Q5). */
  sentChannelIdsForAlarm(alarmId: string, organizationId: string): Promise<string[]>;
  /** The enabled channels among `ids`, as the transports see them. */
  loadChannels(ids: readonly string[]): Promise<NotificationChannelRow[]>;
  /**
   * `F3.51`: the channels joined to the rule, as the RAISE path loads them
   * (`ChannelsService.loadForRule`) — the `rule_notifications` join filtered to
   * `enabled = true`, in code order. The raise-retry phase re-offers the
   * original raise, so "the rule's channels" must have one definition and it
   * is `dispatch()`'s; a step's channels come from its profile and are a
   * different list (`loadChannels` above).
   */
  loadRuleChannels(ruleId: string): Promise<NotificationChannelRow[]>;
  /**
   * `F3.51`: `loadRaiseAttempts` from `notifications/raise-attempts.ts` —
   * every ledger row under these alarms' raise keys, in one query per batch of
   * `RAISE_ATTEMPT_BATCH_SIZE` alarms. A module function, not a service
   * method: `notifications.service.ts` stands within a few dozen lines of
   * AGENTS.md §4.5's cap and the read touches only `fleetDb`.
   *
   * It returns a {@link RaiseAttemptsRead} rather than the rows, because a
   * batch can fail on its own (`F3.51` review, Medium): `unread` names the
   * alarms whose evidence was never read, and this phase decides nothing about
   * those.
   */
  loadRaiseAttempts(refs: readonly RaiseKeyRef[]): Promise<RaiseAttemptsRead>;
  /**
   * `F3.51` review (High): the (alarm, channel, dedupe key) triples whose
   * delivery row did not land. **The one piece of state any phase keeps
   * between ticks**, and it is in process only — see
   * {@link dispatchRememberingLostRows} and {@link LostLedgerRows}. One
   * instance per `AlarmLifecycleService`, shared by the raise-retry and
   * escalation phases (their keys differ, so their entries never collide), and
   * a fresh one per case in the spec.
   */
  lostLedgerRows: LostLedgerRows;
  dispatchToChannels: NotificationsService["dispatchToChannels"];
  /** After the clear has committed — never from inside the transaction. */
  broadcastCleared(alarm: AlarmListItem): void;
  logger: Pick<Logger, "warn">;
}

/**
 * One tick. `now` is the tick's own instant (`runSweepLoop` supplies it) and
 * is the only clock: the stamps, the hold and the step offsets are all
 * measured against it, so the spec runs the whole matrix at one fixed date.
 */
export async function runLifecycleSweep(deps: AlarmLifecycleDeps, now: Date): Promise<void> {
  const activeAlarms = await deps.loadActiveAlarms();
  if (activeAlarms.length === 0) {
    return;
  }

  const rulesById = new Map((await deps.loadRules()).map((row) => [row.id, row]));
  const referencedRules = [...new Set(activeAlarms.map((alarm) => alarm.ruleId))]
    .map((ruleId) => rulesById.get(ruleId))
    .filter((row): row is RuleRow => row !== undefined);
  const [loadSample, catalog] = await Promise.all([
    deps.loadSamples(referencedRules),
    deps.loadEscalation(),
  ]);

  const clearedIds = await runClearPhase(deps, { activeAlarms, rulesById, loadSample, now });
  await runRaiseRetryPhase(deps, { activeAlarms, rulesById, clearedIds });
  await runEscalationPhase(deps, { activeAlarms, rulesById, catalog, clearedIds, now });
}

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
async function runClearPhase(deps: AlarmLifecycleDeps, input: ClearPhaseInput): Promise<Set<string>> {
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
async function runRaiseRetryPhase(
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
async function runEscalationPhase(
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

function reasonOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export interface AlarmLifecycleLoopDeps extends AlarmLifecycleDeps {
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  now: () => number;
  baseTickMs: number;
}

/**
 * The self-scheduling loop — the shared sweep-then-sleep in
 * `scheduling/sweep-loop.ts` (decision 4: never `setInterval`). The sweep
 * takes a `Date`, so the tick's `now()` is wrapped here rather than read by
 * the sweep itself.
 */
export async function runLifecycleLoop(
  deps: AlarmLifecycleLoopDeps,
  signal: AbortSignal,
): Promise<void> {
  return runSweepLoop(
    {
      sweep: (nowMs) => runLifecycleSweep(deps, new Date(nowMs)),
      sleep: deps.sleep,
      now: deps.now,
      baseTickMs: deps.baseTickMs,
      label: "alarm lifecycle",
      logger: deps.logger,
    },
    signal,
  );
}

/**
 * The scheduled host — a thin wiring shell over `runLifecycleSweep`, on
 * `HealthRollupService`'s pattern: the loop starts on module init, the
 * `AbortController` stops it on destroy, and every dependency the sweep
 * takes is one of the methods below.
 */
@Injectable()
export class AlarmLifecycleService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AlarmLifecycleService.name);
  private readonly abortController = new AbortController();
  /**
   * `F3.51` review (High) — one per service instance, because `deps()` is
   * rebuilt on every sweep and this is the one thing that must outlive a tick.
   * A module-level singleton would be shared by two instances and, worse,
   * would carry state between spec cases.
   */
  private readonly lostLedgerRows = new LostLedgerRows();

  constructor(
    // The alarm state writes and the sample read. `withTenant` sets the
    // alarm's organization on every write; `telemetry.point_values` has no
    // policy and is read on this pool with no GUC, as `evaluateEnabledRules`
    // reads it.
    @Inject(TENANT_DRIZZLE) private readonly tenantDb: BmsDb,
    // The cross-organization reads — see the class header for the reason.
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    private readonly notifications: NotificationsService,
    private readonly channels: ChannelsService,
    private readonly gateway: AlarmsGateway,
  ) {}

  onModuleInit(): void {
    void runLifecycleLoop(
      { ...this.deps(), sleep, now: () => Date.now(), baseTickMs: LIFECYCLE_TICK_MS },
      this.abortController.signal,
    ).catch((err: unknown) => {
      this.logger.warn(`alarm lifecycle loop exited: ${reasonOf(err)}`);
    });
  }

  onModuleDestroy(): void {
    this.abortController.abort();
  }

  /** One tick at `now` — the integration suite's entry point; the loop calls the same. */
  sweep(now: Date): Promise<void> {
    return runLifecycleSweep(this.deps(), now);
  }

  private deps(): AlarmLifecycleDeps {
    return {
      loadActiveAlarms: () => this.loadActiveAlarms(),
      loadRules: () => this.fleetDb.transaction((tx) => selectRuleRows(tx)),
      loadSamples: (rows) => batchedLatestPointValues(this.tenantDb, rows),
      loadEscalation: () => this.loadEscalation(),
      writeAlarmState: (organizationId, updates) => this.writeAlarmState(organizationId, updates),
      sentChannelIdsForAlarm: (alarmId, organizationId) =>
        this.notifications.sentChannelIdsForAlarm(alarmId, organizationId),
      loadChannels: async (ids) =>
        (await loadEnabledChannelsByIds(this.fleetDb, ids)).map((row) =>
          this.channels.toChannelRow(row),
        ),
      // `F3.51`: the raise path's own join, so "the rule's channels" has one
      // definition. Both lines below are one expression each and neither adds
      // a constructor parameter — `ChannelsService` and `fleetDb` are already
      // here, which is what keeps `alarm-lifecycle.integration.spec.ts`'s
      // `new AlarmLifecycleService(...)` compiling untouched.
      loadRuleChannels: (ruleId) => this.channels.loadForRule(ruleId),
      loadRaiseAttempts: (refs) => loadRaiseAttempts(this.fleetDb, refs),
      // The instance field, never a new one per sweep: `deps()` is called on
      // every tick and this must survive between them.
      lostLedgerRows: this.lostLedgerRows,
      dispatchToChannels: (channels, input) => this.notifications.dispatchToChannels(channels, input),
      broadcastCleared: (alarm) => this.gateway.broadcastCleared(alarm),
      logger: this.logger,
    };
  }

  /** Plan D4's selection, on the fleet pool (every tenant's alarms, no JWT — the class header's reason). */
  private async loadActiveAlarms(): Promise<ActiveAlarm[]> {
    const rows = await this.fleetDb
      .select({
        id: alarms.id,
        organizationId: alarms.organizationId,
        assetId: alarms.assetId,
        ruleId: alarms.ruleId,
        severity: alarms.severity,
        message: alarms.message,
        raisedAt: alarms.raisedAt,
        acknowledgedAt: alarms.acknowledgedAt,
        normalSince: alarms.normalSince,
      })
      .from(alarms)
      .where(and(isNull(alarms.clearedAt), isNotNull(alarms.ruleId)));
    // The `WHERE` already excludes a null rule id; this narrows the type the
    // driver hands back rather than trusting a cast.
    return rows.flatMap((row) => (row.ruleId === null ? [] : [{ ...row, ruleId: row.ruleId }]));
  }

  /**
   * Plan D13: `alarm_escalation_defaults ⋈ steps ⟕ step_channels`, every
   * tick, on the fleet pool (the class header's reason). A step with no
   * channel row — refused at the API (ruling Q4), but the join must not
   * assume it — comes back with an empty id list and escalates to nobody.
   */
  private async loadEscalation(): Promise<EscalationCatalog> {
    const rows = await this.fleetDb
      .select({
        organizationId: alarmEscalationDefaults.organizationId,
        severity: alarmEscalationDefaults.severity,
        stepId: alarmEscalationSteps.id,
        stepNo: alarmEscalationSteps.stepNo,
        afterMinutes: alarmEscalationSteps.afterMinutes,
        channelId: alarmEscalationStepChannels.channelId,
      })
      .from(alarmEscalationDefaults)
      .innerJoin(
        alarmEscalationSteps,
        eq(alarmEscalationSteps.profileId, alarmEscalationDefaults.profileId),
      )
      .leftJoin(
        alarmEscalationStepChannels,
        eq(alarmEscalationStepChannels.stepId, alarmEscalationSteps.id),
      )
      .orderBy(alarmEscalationSteps.stepNo);

    const stepsByKey = new Map<string, Map<string, { stepNo: number; afterMinutes: number; channelIds: string[] }>>();
    for (const row of rows) {
      const key = escalationKey(row.organizationId, row.severity);
      const steps = stepsByKey.get(key) ?? new Map();
      const step = steps.get(row.stepId) ?? {
        stepNo: row.stepNo,
        afterMinutes: row.afterMinutes,
        channelIds: [],
      };
      if (row.channelId !== null) {
        step.channelIds.push(row.channelId);
      }
      steps.set(row.stepId, step);
      stepsByKey.set(key, steps);
    }
    const defaults = new Map<string, readonly EscalationStep[]>();
    for (const [key, steps] of stepsByKey) {
      defaults.set(key, [...steps.values()]);
    }
    return { defaults };
  }

  /**
   * One tenant transaction per organization: every update `WHERE id = $1
   * AND cleared_at IS NULL` — the sweep is the only writer of the stamp, so
   * the guard is against a row that cleared between the read and this write
   * on a slow tick, never against a concurrent sweep (one loop, sweep-then-
   * sleep). The cleared rows are read back with `alarmListItemColumns`
   * (plan D9) inside the same transaction; the caller broadcasts them after
   * it commits.
   */
  private async writeAlarmState(
    organizationId: string,
    updates: AlarmStateUpdate[],
  ): Promise<AlarmListItem[]> {
    return withTenant(this.tenantDb, organizationId, async (tx) => {
      const clearedIds: string[] = [];
      for (const update of updates) {
        const written = await tx
          .update(alarms)
          .set({ normalSince: update.normalSince, clearedAt: update.clearedAt })
          .where(and(eq(alarms.id, update.alarmId), isNull(alarms.clearedAt)))
          .returning({ id: alarms.id });
        if (update.clearedAt !== null && written.length > 0) {
          clearedIds.push(update.alarmId);
        }
      }
      if (clearedIds.length === 0) {
        return [];
      }
      const rows = await tx
        .select(alarmListItemColumns)
        .from(alarms)
        .innerJoin(assets, eq(alarms.assetId, assets.id))
        .where(inArray(alarms.id, clearedIds));
      return rows.map((row) => toAlarmListItem(row));
    });
  }
}

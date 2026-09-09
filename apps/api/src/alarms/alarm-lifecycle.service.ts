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

import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../database/database.tokens";
import { withTenant } from "../database/tenant-context";
import { loadEnabledChannelsByIds } from "../notifications/channel-reads";
import { ChannelsService } from "../notifications/channels.service";
import { ClosedCeilings } from "../notifications/closed-ceilings";
import type { NotificationChannelRow } from "../notifications/notification-transport";
import { NotificationsService } from "../notifications/notifications.service";
import type { RaiseAttemptsRead } from "../notifications/raise-attempts";
import { loadRaiseAttempts } from "../notifications/raise-attempts";
import type { RaiseKeyRef } from "../notifications/raise-retry";
import { LostLedgerRows } from "../notifications/raise-retry";
import type { LatestSampleLoader } from "../rules/rule-evaluation";
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
  escalationKey,
} from "./alarm-lifecycle";
import {
  reasonOf,
  runClearPhase,
  runEscalationPhase,
  runRaiseRetryPhase,
} from "./alarm-lifecycle-phases";
import { alarmListItemColumns, toAlarmListItem } from "./alarm-list-item";
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
 * **All three phase bodies live in `alarm-lifecycle-phases.ts`**, moved there
 * unchanged when this file reached 991 of AGENTS.md §4.5's 1000-line cap. The
 * order below is the whole of the sweep; the phases themselves take
 * {@link AlarmLifecycleDeps} and are called nowhere else.
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
 * **`F3.53` adds a second in-process memory, and the two are opposites — read
 * the lifetime, not the shape.** {@link LostLedgerRows} is state BETWEEN ticks
 * and deliberately survives them: it is the bound on a re-offer whose ledger
 * row could not be written, so forgetting it would restore the unbounded
 * re-offer it exists to stop, which is why it needs a cap and a `retainAlarms`
 * reclaim and why it hangs off the class. The {@link ClosedCeilings} memo lives
 * INSIDE one tick and deliberately does not survive it: it caches an answer
 * that is only true of one trailing hour, so letting it outlive the sweep would
 * be the defect rather than the feature — it is a `const` in
 * {@link runLifecycleSweep} and it has no cap, because its lifetime IS its
 * bound.
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
   * `dispatchRememberingLostRows` in `alarm-lifecycle-phases.ts` and
   * {@link LostLedgerRows}. One
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
 *
 * **`F3.53` — the ceiling memo is created here and dies here** (ADR 0041
 * Amendment 7 ruling 2). One {@link ClosedCeilings} per call, handed to the two
 * re-offering phases and to nothing else, with no TTL and no eviction cap
 * because it never outlives this function: the window IS the tick, which is
 * `F3.51` ruling 3's structural condition rather than another clock constant.
 * A `const` in this body is the whole of that guarantee — a field on the class
 * below, or a module-level instance, would answer a later tick from a trailing
 * hour that has already moved.
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

  // The tick's memory of which ceilings have already refused. The clear phase
  // deliberately does not get it: a cleared message has no next tick to be
  // postponed to — see `dispatchRememberingLostRows`.
  const closedCeilings = new ClosedCeilings();

  const clearedIds = await runClearPhase(deps, { activeAlarms, rulesById, loadSample, now });
  await runRaiseRetryPhase(deps, { activeAlarms, rulesById, clearedIds, closedCeilings });
  await runEscalationPhase(deps, {
    activeAlarms,
    rulesById,
    catalog,
    clearedIds,
    now,
    closedCeilings,
  });
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
      // `F3.53` — the third argument is the tick's `ClosedCeilings` and it MUST
      // be forwarded (ADR 0041 Amendment 7). This line read
      // `(channels, input) => …dispatchToChannels(channels, input)` and dropped
      // it: the memo was created, threaded through both phases, and never
      // delivered, while every sweep spec stayed green because each replaces
      // `deps.dispatchToChannels` with its own fake. A two-parameter function is
      // assignable to the three-parameter type, so `tsc` reports nothing either.
      // `alarm-lifecycle.integration.spec.ts`'s I1 is the only gate on this
      // line; it patches the service instance, which works because this arrow
      // resolves the method at call time.
      dispatchToChannels: (channels, input, closedCeilings) =>
        this.notifications.dispatchToChannels(channels, input, closedCeilings),
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

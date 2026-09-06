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
import type { NotificationChannelRow } from "../notifications/notification-transport";
import { NotificationsService } from "../notifications/notifications.service";
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
 * **Two phases, one tick, no state but the rows.** The clear phase compares
 * every active alarm's rule against the latest fresh sample and stamps the
 * hold or the clear (`decideClear`); the escalation phase, over the alarms
 * still active after that and not acknowledged, sends each due step of the
 * organization's severity profile. Neither phase remembers anything between
 * ticks: the two stamps and the delivery ledger are the whole state, so a
 * restart loses nothing and a repeated tick sends nothing twice —
 * `dispatchToChannels` asks the ledger before every event (decision 10,
 * plan D3), which is why the sweep re-dispatches every due step every tick
 * without a "sent" set of its own.
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
    const channelIds = await deps.sentChannelIdsForAlarm(alarm.id, input.organizationId);
    if (channelIds.length === 0) {
      return;
    }
    const channels = await deps.loadChannels(channelIds);
    if (channels.length === 0) {
      return;
    }
    await deps.dispatchToChannels(channels, input);
  } catch (err) {
    deps.logger.warn(
      `alarm lifecycle: cleared message for alarm ${alarm.id} rule ${rule.code} failed: ${reasonOf(err)}`,
    );
  }
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
      const channels = await loadStepChannels(step);
      if (channels.length === 0) {
        continue;
      }
      await deps.dispatchToChannels(channels, dispatchInput);
    }
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

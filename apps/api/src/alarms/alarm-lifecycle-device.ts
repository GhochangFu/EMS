import type { AlarmListItem } from "@bms/shared";

import {
  DEVICE_ALARM_CLEAR_HOLD_SECONDS,
  organizationHostReporting,
  rtuCommsEligible,
  rtuHostReporting,
} from "../device-health/device-alarm-rule";
import { stateOf, type RtuHealthRow } from "../device-health/device-health.reads";
import type { HostBeat } from "../device-health/device-state";
import type { ClosedCeilings } from "../notifications/closed-ceilings";
import { buildDedupeKey, SYSTEM_RULE_TOKEN } from "../notifications/dedupe-key";
import type { NotificationChannelRow } from "../notifications/notification-transport";
import { STEP_MAX_LATENESS_MS } from "../notifications/notifications.config";

import {
  type ClearDecision,
  type EscalationCatalog,
  type LifecycleAlarm,
  type LifecycleRule,
  clearedDispatchInput,
  decideClear,
  dueSteps,
  escalationDispatchInput,
  escalationKey,
  escalationStart,
  stepIsTooLate,
} from "./alarm-lifecycle";
import { dispatchRememberingLostRows, reasonOf } from "./alarm-lifecycle-phases";
import type { AlarmLifecycleDeps, AlarmStateUpdate } from "./alarm-lifecycle.service";

/**
 * `F3.16` / ADR 0127 decisions 6, 11, 13, 16 and 18 — the lifecycle sweep over
 * device alarms (`source` `rtu_comms` or `ingest_host`), which have no asset
 * and no rule. A file of its own because `alarm-lifecycle-phases.ts` stands at
 * AGENTS.md §4.5's cap. `runLifecycleSweep` calls {@link runDeviceLifecycle}
 * after the three rule phases, in the same tick and with the same
 * `ClosedCeilings`; the sweep stays the one writer of `cleared_at` (ADR 0057).
 *
 * **The clear is ADR 0057 decision 5's hold, unchanged.** `decideClear` over
 * `normal_since`, with {@link DEVICE_ALARM_CLEAR_HOLD_SECONDS} (120 s,
 * decision 16) in the rule's hold's place; only the evidence differs
 * ({@link deviceAlarmEvidence}):
 *
 * - `rtu_comms` is **normal** while the RTU's decision-11 state is Online and
 *   it has been heard since the alarm was raised ("cleared when data returns",
 *   decision 5) — the second half because a host restart gives every RTU a fresh
 *   window and reads a still-silent one Online. Stale, Offline or not heard
 *   since is a **fault**, which restarts the hold. A stale host is a fault too:
 *   its states are frozen (decision 6), so nothing clears while it is down and
 *   the 120 s are counted on a live host. The RTU no longer monitored, deleted,
 *   or now edge-served (decision 18) is **gone**: the alarm cannot stand, and
 *   clears at once.
 * - `ingest_host` is **normal** while the host serving the organization's
 *   monitored RTUs is fresh on the database clock, a **fault** while it is not,
 *   and **gone** when the organization has no monitored RTU left.
 *
 * "Continuously for 120 s" is therefore the stamp: the first normal tick sets
 * `normal_since` to the tick's `now`, any fault tick nulls it, and the tick at
 * which `now − normal_since ≥ 120 s` clears. Nothing is held in memory.
 *
 * **Escalation (decision 13)** is `runEscalationPhase`'s, per alarm: the
 * organization's profile for the alarm's severity, each due step to its
 * channels while unacknowledged, through `dispatchRememberingLostRows` (the
 * ledger answers "already sent"). The dispatch input is built by the same
 * `escalationDispatchInput` with a {@link systemRule}: `ruleId` null, so the key
 * reads `system:<alarm>:<severity>:escalation:<n>`. No profile, no message. The
 * raise-retry phase never sees a device alarm: `loadActiveAlarms` selects rule
 * alarms only, and a device alarm's raise notifies nobody (decision 13).
 */

/** One open device alarm, as `AlarmLifecycleService.loadActiveDeviceAlarms` selects it. */
export type DeviceLifecycleAlarm = Omit<LifecycleAlarm, "assetId" | "ruleId"> & {
  assetId: null;
  ruleId: null;
  source: "rtu_comms" | "ingest_host";
  rtuId: string | null;
};

/** The monitored RTUs and the ingest hosts, read once per tick, with the database clock. */
export type DeviceHealthSnapshot = {
  readonly rows: readonly RtuHealthRow[];
  readonly hosts: readonly HostBeat[];
  readonly dbNowMs: number;
};

export type DeviceEvidence = "gone" | "fault" | "normal";

/** The rule a device alarm's dispatch input is built from: no id, the `system` token, the alarm's own organization. */
export function systemRule(organizationId: string): LifecycleRule {
  return { id: null, code: SYSTEM_RULE_TOKEN, organizationId, severity: null };
}

/** Decision 16's evidence for one device alarm (see the file header). */
export function deviceAlarmEvidence(alarm: DeviceLifecycleAlarm, snapshot: DeviceHealthSnapshot): DeviceEvidence {
  if (alarm.source === "ingest_host") {
    const ofOrganization = snapshot.rows.filter((row) => row.organizationId === alarm.organizationId);
    const reporting = organizationHostReporting(ofOrganization, snapshot.hosts, snapshot.dbNowMs);
    if (reporting === null) return "gone";
    return reporting ? "normal" : "fault";
  }
  const row = snapshot.rows.find((candidate) => candidate.rtuId === alarm.rtuId);
  if (!rtuCommsEligible(row) || row.organizationId !== alarm.organizationId) {
    return "gone";
  }
  const hostsByKey = new Map(snapshot.hosts.map((h) => [h.hostKey, h]));
  if (!rtuHostReporting(row, hostsByKey, snapshot.dbNowMs)) {
    return "fault";
  }
  const heardSinceRaise = row.lastSeenMs !== null && row.lastSeenMs >= alarm.raisedAt.getTime();
  return stateOf(row, hostsByKey) === "online" && heardSinceRaise ? "normal" : "fault";
}

/** The write for one device alarm this tick, or `null`: `decideClear` with the 120 s hold, or an immediate clear when gone. */
export function decideDeviceClear(alarm: DeviceLifecycleAlarm, evidence: DeviceEvidence, now: Date): ClearDecision {
  if (evidence === "gone") {
    return { normalSince: alarm.normalSince ?? now, clearedAt: now };
  }
  return decideClear({
    matched: evidence === "fault",
    normalSince: alarm.normalSince,
    clearHoldSeconds: DEVICE_ALARM_CLEAR_HOLD_SECONDS,
    now,
  });
}

/** Clear, then escalate, the tick's device alarms. */
export async function runDeviceLifecycle(
  deps: AlarmLifecycleDeps,
  input: {
    alarms: DeviceLifecycleAlarm[];
    catalog: EscalationCatalog;
    now: Date;
    closedCeilings: ClosedCeilings;
  },
): Promise<void> {
  const snapshot = await deps.loadDeviceHealth();
  const clearedIds = await runDeviceClearPhase(deps, input.alarms, snapshot, input.now);
  await runDeviceEscalationPhase(deps, { ...input, clearedIds });
}

/** `runClearPhase`'s shape: decide every alarm, write once per organization, broadcast and notify after commit. */
async function runDeviceClearPhase(
  deps: AlarmLifecycleDeps,
  alarms: readonly DeviceLifecycleAlarm[],
  snapshot: DeviceHealthSnapshot,
  now: Date,
): Promise<Set<string>> {
  const updatesByOrganization = new Map<string, AlarmStateUpdate[]>();
  for (const alarm of alarms) {
    const decision = decideDeviceClear(alarm, deviceAlarmEvidence(alarm, snapshot), now);
    if (decision === null) continue;
    const updates = updatesByOrganization.get(alarm.organizationId) ?? [];
    updates.push({ alarmId: alarm.id, ...decision });
    updatesByOrganization.set(alarm.organizationId, updates);
  }

  const alarmsById = new Map(alarms.map((alarm) => [alarm.id, alarm]));
  const clearedIds = new Set<string>();
  for (const [organizationId, updates] of updatesByOrganization) {
    let cleared: AlarmListItem[];
    try {
      cleared = await deps.writeAlarmState(organizationId, updates);
    } catch (err) {
      deps.logger.warn(`alarm lifecycle: organization ${organizationId} device alarm state write failed: ${reasonOf(err)}`);
      continue;
    }
    for (const item of cleared) {
      clearedIds.add(item.id);
      deps.broadcastCleared(item);
      const alarm = alarmsById.get(item.id);
      // `F4.359` (plan D12): a suppressed alarm clears silently.
      if (alarm && alarm.suppressedAt === null) await notifyDeviceCleared(deps, alarm);
    }
  }
  return clearedIds;
}

/**
 * The cleared message to the channels holding a `sent` row for the alarm (ADR 0057 ruling Q5) —
 * for a device alarm, the escalation steps it reached. Silent when there are none: an
 * organization with no profile is the ordinary case (decision 13), not a fault worth a warn per clear.
 */
async function notifyDeviceCleared(deps: AlarmLifecycleDeps, alarm: DeviceLifecycleAlarm): Promise<void> {
  const input = clearedDispatchInput(alarm, systemRule(alarm.organizationId));
  if (input === null) return;
  try {
    const channelIds = await deps.sentChannelIdsForAlarm(alarm.id, alarm.organizationId);
    if (channelIds.length === 0) return;
    const channels = await deps.loadChannels(channelIds);
    if (channels.length === 0) return;
    await deps.dispatchToChannels(channels, input);
  } catch (err) {
    deps.logger.warn(`alarm lifecycle: cleared message for device alarm ${alarm.id} failed: ${reasonOf(err)}`);
  }
}

/** `runEscalationPhase` for device alarms: the profile for `(organization, severity)`, each due step once (the ledger). */
async function runDeviceEscalationPhase(
  deps: AlarmLifecycleDeps,
  input: {
    alarms: readonly DeviceLifecycleAlarm[];
    catalog: EscalationCatalog;
    clearedIds: Set<string>;
    now: Date;
    closedCeilings: ClosedCeilings;
  },
): Promise<void> {
  const channelsByIds = new Map<string, Promise<NotificationChannelRow[]>>();
  const loadStepChannels = (channelIds: readonly string[]): Promise<NotificationChannelRow[]> => {
    const key = channelIds.join(",");
    let pending = channelsByIds.get(key);
    if (!pending) {
      pending = channelIds.length === 0 ? Promise.resolve([]) : deps.loadChannels(channelIds);
      channelsByIds.set(key, pending);
    }
    return pending;
  };

  for (const alarm of input.alarms) {
    // `F4.359`: never while suppressed; the clock from the lift (D11).
    if (alarm.acknowledgedAt !== null || input.clearedIds.has(alarm.id) || alarm.suppressedAt !== null) continue;
    const steps = input.catalog.defaults.get(escalationKey(alarm.organizationId, alarm.severity));
    if (!steps || steps.length === 0) continue;
    for (const stepNo of dueSteps(steps, escalationStart(alarm), input.now)) {
      const step = steps.find((candidate) => candidate.stepNo === stepNo);
      if (!step) continue;
      const stale = stepIsTooLate({
        raisedAt: escalationStart(alarm),
        afterMinutes: step.afterMinutes,
        now: input.now,
        maxLatenessMs: STEP_MAX_LATENESS_MS,
      });
      const dispatchInput = escalationDispatchInput(alarm, systemRule(alarm.organizationId), stepNo, input.now, stale);
      if (dispatchInput === null) break;
      try {
        const channels = await loadStepChannels(step.channelIds);
        if (channels.length === 0) continue;
        // The lost-row cap's tick warning is `runEscalationPhase`'s; a device step that
        // overflows it is re-offered next tick, the documented fail-open of that memory.
        await dispatchRememberingLostRows(deps, {
          alarmId: alarm.id,
          dedupeKey: buildDedupeKey(dispatchInput),
          channels,
          input: dispatchInput,
          closedCeilings: input.closedCeilings,
        });
      } catch (err) {
        deps.logger.warn(
          `alarm lifecycle: escalation step ${stepNo} for device alarm ${alarm.id} failed: ${reasonOf(err)}`,
        );
      }
    }
  }
}

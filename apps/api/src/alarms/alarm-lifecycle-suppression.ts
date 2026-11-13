import type { AlarmListItem } from "@bms/shared";

import type { LifecycleAlarm } from "./alarm-lifecycle";
import type { DeviceLifecycleAlarm } from "./alarm-lifecycle-device";
import { reasonOf } from "./alarm-lifecycle-phases";
import type { AlarmLifecycleDeps, AlarmSuppressionUpdate } from "./alarm-lifecycle.service";
import type { CoverAlarm } from "./maintenance-cover.reads";

/**
 * `F4.359` U8 — the sweep's first phase: maintenance-window suppression
 * (ADR 0131 decisions 7, 8, 9; plan D5, D12, D13).
 *
 * **A reconciler, not an event handler** (D5). Each tick reads the cover of every
 * active alarm once (`resolveMaintenanceCover`, one fleet read) and compares it
 * with the row: covered and not stamped → stamp with the first covering window;
 * stamped and not covered → lift, which writes `unsuppressed_at` and restarts the
 * escalation clock (plan Q2). Stamped and still covered — by the stamping window
 * or another (decision 9) — writes nothing. So a raise-path miss, a missed tick
 * or a window that starts or ends by time heals on the next tick, and the window
 * routes need emit nothing.
 *
 * **One write per organization**, under its tenant, as `runClearPhase` writes; a
 * failing organization warns once and the next still runs. Each changed row the
 * write reads back is broadcast as a `suppression` event after it commits (D13).
 *
 * **What it hands on is the tick's state, and the two directions differ.** A
 * stamp decision is applied to the returned alarms even when its write failed:
 * the cover says a window holds the alarm, so the later phases must not notify
 * about it this tick — nothing may leak. A lift is applied only when its row came
 * back changed: until the row says the window has let go, the alarm stays quiet.
 *
 * **Never `ingest_host`** (decision 5; `alarms_suppressed_shape_check` refuses
 * it): such an alarm is not handed to the cover and is never stamped, whatever a
 * cover answers. A cover read that fails changes nothing this tick.
 */
export async function runSuppressionPhase(
  deps: AlarmLifecycleDeps,
  input: {
    ruleAlarms: readonly LifecycleAlarm[];
    deviceAlarms: readonly DeviceLifecycleAlarm[];
    now: Date;
  },
): Promise<{ ruleAlarms: LifecycleAlarm[]; deviceAlarms: DeviceLifecycleAlarm[] }> {
  const all: readonly (LifecycleAlarm | DeviceLifecycleAlarm)[] = [...input.ruleAlarms, ...input.deviceAlarms];
  const unchanged = { ruleAlarms: [...input.ruleAlarms], deviceAlarms: [...input.deviceAlarms] };
  if (all.length === 0) return unchanged;

  let cover: ReadonlyMap<string, string>;
  try {
    cover = await deps.resolveMaintenanceCover(all.flatMap((alarm) => coverAlarmOf(alarm) ?? []));
  } catch (err) {
    deps.logger.warn(`alarm lifecycle: maintenance cover read failed, suppression unchanged this tick: ${reasonOf(err)}`);
    return unchanged;
  }

  const updatesByOrganization = new Map<string, AlarmSuppressionUpdate[]>();
  for (const alarm of all) {
    const windowId = isIngestHost(alarm) ? undefined : cover.get(alarm.id);
    let update: AlarmSuppressionUpdate | null = null;
    if (alarm.suppressedAt === null && windowId !== undefined) {
      update = { kind: "stamp", alarmId: alarm.id, windowId, at: input.now };
    } else if (alarm.suppressedAt !== null && windowId === undefined) {
      update = { kind: "lift", alarmId: alarm.id, at: input.now };
    }
    if (update === null) continue;
    const updates = updatesByOrganization.get(alarm.organizationId) ?? [];
    updates.push(update);
    updatesByOrganization.set(alarm.organizationId, updates);
  }

  const stamped = new Set<string>();
  const lifted = new Set<string>();
  for (const [organizationId, updates] of updatesByOrganization) {
    const lifts = new Set<string>();
    for (const update of updates) {
      if (update.kind === "stamp") stamped.add(update.alarmId);
      else lifts.add(update.alarmId);
    }
    let changed: AlarmListItem[];
    try {
      changed = await deps.writeAlarmSuppression(organizationId, updates);
    } catch (err) {
      deps.logger.warn(`alarm lifecycle: organization ${organizationId} suppression write failed: ${reasonOf(err)}`);
      continue;
    }
    for (const item of changed) {
      if (lifts.has(item.id)) lifted.add(item.id);
      deps.broadcastSuppression(item);
    }
  }

  const apply = <T extends LifecycleAlarm | DeviceLifecycleAlarm>(alarm: T): T => {
    if (stamped.has(alarm.id)) return { ...alarm, suppressedAt: input.now };
    if (lifted.has(alarm.id)) return { ...alarm, suppressedAt: null, unsuppressedAt: input.now };
    return alarm;
  };
  return { ruleAlarms: input.ruleAlarms.map(apply), deviceAlarms: input.deviceAlarms.map(apply) };
}

function isIngestHost(alarm: LifecycleAlarm | DeviceLifecycleAlarm): boolean {
  return "source" in alarm && alarm.source === "ingest_host";
}

/** What the cover read needs of one alarm, or `null` for one it can never cover. */
function coverAlarmOf(alarm: LifecycleAlarm | DeviceLifecycleAlarm): (CoverAlarm & { readonly id: string }) | null {
  const { id, organizationId } = alarm;
  if (!("source" in alarm)) {
    return { id, source: "rule", organizationId, assetId: alarm.assetId, ruleId: alarm.ruleId };
  }
  if (alarm.source === "rtu_comms" && alarm.rtuId !== null) {
    return { id, source: "rtu_comms", organizationId, rtuId: alarm.rtuId };
  }
  return null;
}

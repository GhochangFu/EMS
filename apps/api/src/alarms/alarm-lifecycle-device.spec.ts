import type { RtuHealthRow } from "../device-health/device-health.reads";
import type { HostBeat } from "../device-health/device-state";
import { buildDedupeKey } from "../notifications/dedupe-key";
import { escalationKey } from "./alarm-lifecycle";
import type { DeviceHealthSnapshot, DeviceLifecycleAlarm } from "./alarm-lifecycle-device";
import { runLifecycleSweep } from "./alarm-lifecycle.service";
import {
  assert,
  C1,
  C2,
  fakeDeps,
  NOW,
  ORG_A,
  ORG_B,
  secondsBefore,
} from "./alarm-lifecycle.service.spec";

/**
 * `F3.16` (plan B4, ADR 0127 decisions 6, 11, 13, 16, 18) — the lifecycle
 * sweep over device alarms, on `alarm-lifecycle.service.spec.ts`'s fixture.
 * Assertions live here; the sibling `.test` is the Vitest entry point.
 *
 * The clear is ADR 0057 decision 5's hold on `normal_since`, with the
 * decision-11 state as its evidence: an `rtu_comms` alarm is "normal" while its
 * RTU reads Online and has been heard since the raise, an `ingest_host` alarm
 * while the organization's host is fresh. 120 s of normal clears it. An RTU no
 * longer monitored, now edge-served, or deleted clears at once. A stale host is
 * a fault for every RTU alarm it serves: the hold restarts, nothing clears.
 *
 * The database clock and the tick's `now` are both {@link NOW}; the host beat
 * 5 s before it is fresh, 31 s before it stale (30 s bound).
 */

const HOST = "ingest-1";
const RTU = "rtu-1";

function host(lastBeatSecondsAgo = 5): HostBeat {
  return { hostKey: HOST, lastBeatMs: NOW.getTime() - lastBeatSecondsAgo * 1000, healthySinceMs: NOW.getTime() - 3_600_000 };
}

/** A monitored, cloud-served RTU with a 60 s window, last heard `silentSeconds` before the host's beat. */
function rtuRow(silentSeconds: number, overrides: Partial<RtuHealthRow> = {}): RtuHealthRow {
  return {
    rtuId: RTU,
    organizationId: ORG_A,
    code: "RTU-1",
    displayName: "Pump house 1",
    edgeServed: false,
    hostKey: HOST,
    lastSeenMs: NOW.getTime() - 5000 - silentSeconds * 1000,
    monitoredSinceMs: NOW.getTime() - 7_200_000,
    windowSeconds: 60,
    clockSkewSeconds: null,
    clockSkewAtMs: null,
    ...overrides,
  };
}

function snapshot(rows: RtuHealthRow[], hosts: HostBeat[] = [host()]): DeviceHealthSnapshot {
  return { rows, hosts, dbNowMs: NOW.getTime() };
}

function commsAlarm(overrides: Partial<DeviceLifecycleAlarm> = {}): DeviceLifecycleAlarm {
  return {
    id: "device-1",
    organizationId: ORG_A,
    assetId: null,
    ruleId: null,
    source: "rtu_comms",
    rtuId: RTU,
    severity: "warning",
    message: "Communication lost: Pump house 1",
    // Raised 10 min ago; the RTU rows above were heard after that unless a case says otherwise.
    raisedAt: secondsBefore(600),
    acknowledgedAt: null,
    normalSince: null,
    ...overrides,
  };
}

function hostAlarm(overrides: Partial<DeviceLifecycleAlarm> = {}): DeviceLifecycleAlarm {
  return commsAlarm({
    id: "device-host",
    source: "ingest_host",
    rtuId: null,
    severity: "critical",
    message: "Ingest host not reporting",
    ...overrides,
  });
}

const writesOf = (recorded: ReturnType<typeof fakeDeps>["recorded"]) => JSON.stringify(recorded.writes);

/** D1: Online and heard since the raise starts the hold at `now`; 119 s in, nothing is written; at 120 s it clears. */
export async function assertAnRtuAlarmClearsAfter120SecondsOnline(): Promise<void> {
  const health = snapshot([rtuRow(1)]);

  const first = fakeDeps({ alarms: [], rules: [], deviceAlarms: [commsAlarm()], deviceHealth: health });
  await runLifecycleSweep(first.deps, NOW);
  const [startWrite] = first.recorded.writes;
  assert(
    first.recorded.writes.length === 1 &&
      startWrite?.organizationId === ORG_A &&
      startWrite.updates[0]?.normalSince?.getTime() === NOW.getTime() &&
      startWrite.updates[0].clearedAt === null,
    `D1: expected the hold stamped at now under ORG_A, got ${writesOf(first.recorded)}`,
  );

  const running = fakeDeps({
    alarms: [],
    rules: [],
    deviceAlarms: [commsAlarm({ normalSince: secondsBefore(119) })],
    deviceHealth: health,
  });
  await runLifecycleSweep(running.deps, NOW);
  assert(running.recorded.writes.length === 0, `D1: 119 s into the hold nothing is written, got ${writesOf(running.recorded)}`);

  const due = fakeDeps({
    alarms: [],
    rules: [],
    deviceAlarms: [commsAlarm({ normalSince: secondsBefore(120) })],
    deviceHealth: health,
  });
  await runLifecycleSweep(due.deps, NOW);
  assert(
    due.recorded.writes[0]?.updates[0]?.clearedAt?.getTime() === NOW.getTime(),
    `D1: at 120 s the alarm clears at now, got ${writesOf(due.recorded)}`,
  );
  assert(
    due.recorded.broadcasts.length === 1 && due.recorded.broadcasts[0]?.id === "device-1",
    `D1: the clear is broadcast once, got ${JSON.stringify(due.recorded.broadcasts.map((b) => b.id))}`,
  );
}

/** D2: Stale (40 s of a 60 s window) resets a running hold; Online with no sample since the raise is not normal either. */
export async function assertStaleOrNotHeardSinceTheRaiseIsNotNormal(): Promise<void> {
  const stale = fakeDeps({
    alarms: [],
    rules: [],
    deviceAlarms: [commsAlarm({ normalSince: secondsBefore(60) })],
    deviceHealth: snapshot([rtuRow(40)]),
  });
  await runLifecycleSweep(stale.deps, NOW);
  const [update] = stale.recorded.writes[0]?.updates ?? [];
  assert(
    update?.normalSince === null && update.clearedAt === null,
    `D2: a Stale RTU resets the hold, got ${writesOf(stale.recorded)}`,
  );

  // A host restart gives every RTU a fresh window (decision 11), so a silent RTU reads Online —
  // but it has not been heard since the alarm was raised, so its data has not returned (decision 5).
  const restarted = fakeDeps({
    alarms: [],
    rules: [],
    deviceAlarms: [commsAlarm({ raisedAt: secondsBefore(60) })],
    deviceHealth: snapshot([rtuRow(600)], [{ ...host(), healthySinceMs: NOW.getTime() - 10_000 }]),
  });
  await runLifecycleSweep(restarted.deps, NOW);
  assert(restarted.recorded.writes.length === 0, `D2: no hold without a sample since the raise, got ${writesOf(restarted.recorded)}`);
}

/** D3 (decision 6): a stale host keeps the RTU alarm open — the hold restarts, nothing clears, however long. */
export async function assertAStaleHostKeepsRtuAlarmsOpen(): Promise<void> {
  const { deps, recorded } = fakeDeps({
    alarms: [],
    rules: [],
    deviceAlarms: [commsAlarm({ normalSince: secondsBefore(600) })],
    deviceHealth: snapshot([rtuRow(1)], [host(31)]),
  });
  await runLifecycleSweep(deps, NOW);
  const [update] = recorded.writes[0]?.updates ?? [];
  assert(
    update?.normalSince === null && update.clearedAt === null && recorded.broadcasts.length === 0,
    `D3: a stale host resets the hold and clears nothing, got ${writesOf(recorded)}`,
  );
}

/** D4: an RTU no longer monitored (or deleted), or now edge-served, clears at once — no hold. */
export async function assertAnRtuThatLeftMonitoringClearsAtOnce(): Promise<void> {
  for (const [label, rows] of [
    ["not monitored or deleted", []],
    ["edge-served", [rtuRow(600, { edgeServed: true })]],
  ] as const) {
    const { deps, recorded } = fakeDeps({
      alarms: [],
      rules: [],
      deviceAlarms: [commsAlarm()],
      deviceHealth: snapshot([...rows]),
    });
    await runLifecycleSweep(deps, NOW);
    assert(
      recorded.writes[0]?.updates[0]?.clearedAt?.getTime() === NOW.getTime(),
      `D4 (${label}): expected an immediate clear at now, got ${writesOf(recorded)}`,
    );
  }
}

/** D5: the host alarm clears after 120 s fresh; a stale host resets its hold; an organization with no monitored RTU clears it at once. */
export async function assertTheHostAlarmClearsAfter120SecondsFresh(): Promise<void> {
  const fresh = fakeDeps({
    alarms: [],
    rules: [],
    deviceAlarms: [hostAlarm({ normalSince: secondsBefore(120) })],
    deviceHealth: snapshot([rtuRow(600)]),
  });
  await runLifecycleSweep(fresh.deps, NOW);
  assert(
    fresh.recorded.writes[0]?.updates[0]?.clearedAt?.getTime() === NOW.getTime(),
    `D5: 120 s fresh clears the host alarm, got ${writesOf(fresh.recorded)}`,
  );

  const stale = fakeDeps({
    alarms: [],
    rules: [],
    deviceAlarms: [hostAlarm({ normalSince: secondsBefore(119) })],
    deviceHealth: snapshot([rtuRow(600)], [host(31)]),
  });
  await runLifecycleSweep(stale.deps, NOW);
  const [update] = stale.recorded.writes[0]?.updates ?? [];
  assert(update?.normalSince === null && update.clearedAt === null, `D5: a stale host resets the hold, got ${writesOf(stale.recorded)}`);

  const gone = fakeDeps({
    alarms: [],
    rules: [],
    deviceAlarms: [hostAlarm({ organizationId: ORG_B })],
    deviceHealth: snapshot([rtuRow(600)]),
  });
  await runLifecycleSweep(gone.deps, NOW);
  assert(
    gone.recorded.writes[0]?.organizationId === ORG_B && gone.recorded.writes[0].updates[0]?.clearedAt !== null,
    `D5: an organization with no monitored RTU clears its host alarm at once, got ${writesOf(gone.recorded)}`,
  );
}

/**
 * D6 (decision 13): an unacknowledged device alarm escalates through its organization's profile
 * for its severity — `ruleId` null, `system` in the key; acknowledged, or with no profile mapped,
 * nothing is sent. The once-only is the ledger's (`dispatchToChannels`), proved in the integration suite.
 */
export async function assertADeviceAlarmEscalatesThroughTheProfile(): Promise<void> {
  const catalog = {
    defaults: new Map([[escalationKey(ORG_A, "warning"), [{ stepNo: 1, afterMinutes: 1, channelIds: [C1.id] }]]]),
  };
  const health = snapshot([rtuRow(600)]);
  const due = fakeDeps({ alarms: [], rules: [], deviceAlarms: [commsAlarm()], deviceHealth: health, catalog });
  await runLifecycleSweep(due.deps, NOW);
  const [only] = due.recorded.dispatches;
  assert(
    due.recorded.dispatches.length === 1 &&
      only?.channels.map((c) => c.id).join() === C1.id &&
      only.input.ruleId === null &&
      only.input.ruleCode === "system" &&
      only.input.organizationId === ORG_A &&
      only.input.alarmId === "device-1" &&
      only.input.event?.kind === "escalation" &&
      buildDedupeKey(only.input) === "system:device-1:warning:escalation:1",
    `D6: expected step 1 to C1 with ruleId null under system:device-1:warning:escalation:1, got ${JSON.stringify(due.recorded.dispatches)}`,
  );

  const acked = fakeDeps({
    alarms: [],
    rules: [],
    deviceAlarms: [commsAlarm({ acknowledgedAt: secondsBefore(30) })],
    deviceHealth: health,
    catalog,
  });
  await runLifecycleSweep(acked.deps, NOW);
  assert(acked.recorded.dispatches.length === 0, `D6: an acknowledged alarm does not escalate, got ${acked.recorded.dispatches.length}`);

  const noProfile = fakeDeps({
    alarms: [],
    rules: [],
    deviceAlarms: [hostAlarm({ normalSince: null })],
    deviceHealth: snapshot([rtuRow(600)], [host(31)]),
    catalog,
  });
  await runLifecycleSweep(noProfile.deps, NOW);
  assert(
    noProfile.recorded.dispatches.length === 0 && noProfile.recorded.channelLoads.length === 0,
    `D6: no profile for (ORG_A, critical) sends nothing, got ${JSON.stringify(noProfile.recorded.dispatches)}`,
  );
}

/** D7: the raise-retry phase never sees a device alarm (it has no rule raise to re-offer). */
export async function assertTheRaiseRetrySkipsDeviceAlarms(): Promise<void> {
  const { deps, recorded } = fakeDeps({
    alarms: [],
    rules: [],
    deviceAlarms: [commsAlarm()],
    deviceHealth: snapshot([rtuRow(600)]),
  });
  await runLifecycleSweep(deps, NOW);
  assert(
    recorded.raiseAttemptReads.length === 0 && recorded.ruleChannelReads.length === 0,
    `D7: no raise-attempt or rule-channel read for a device alarm, got ${JSON.stringify(recorded.raiseAttemptReads)}`,
  );
}

/** D8: a cleared device alarm tells the channels holding a sent row for it, with ruleId null — and nobody else. */
export async function assertAClearedDeviceAlarmTellsItsSentChannels(): Promise<void> {
  const { deps, recorded } = fakeDeps({
    alarms: [],
    rules: [],
    deviceAlarms: [commsAlarm({ normalSince: secondsBefore(120) })],
    deviceHealth: snapshot([rtuRow(1)]),
    sentChannelIds: [C2.id],
  });
  await runLifecycleSweep(deps, NOW);
  const [only] = recorded.dispatches;
  assert(
    recorded.dispatches.length === 1 &&
      only?.channels.map((c) => c.id).join() === C2.id &&
      only.input.ruleId === null &&
      only.input.event?.kind === "cleared" &&
      only.input.message === "Cleared: Communication lost: Pump house 1",
    `D8: expected one cleared message to C2 with ruleId null, got ${JSON.stringify(recorded.dispatches)}`,
  );
}

import type { RtuHealthRow } from "../device-health/device-health.reads";
import { buildDedupeKey } from "../notifications/dedupe-key";
import type { RaiseAttemptRow } from "../notifications/raise-retry";
import { type EscalationCatalog, type LifecycleAlarm, escalationKey } from "./alarm-lifecycle";
import type { DeviceHealthSnapshot, DeviceLifecycleAlarm } from "./alarm-lifecycle-device";
import { runSuppressionPhase } from "./alarm-lifecycle-suppression";
import { runLifecycleSweep } from "./alarm-lifecycle.service";
import {
  C1,
  NOW,
  ORG_A,
  ORG_B,
  alarmRow,
  assert,
  fakeDeps,
  ruleRow,
  secondsBefore,
  twoStepCatalog,
} from "./alarm-lifecycle.service.spec";

/**
 * `F4.359` U8 (ADR 0131 decisions 7, 8, 9; plan D5, D12, D13) — the sweep's
 * suppression phase over fakes at fixed instants. Assertions live here; the
 * sibling `.test` is the Vitest entry point (ADR 0014).
 *
 * The phase is a reconciler: each tick, an active alarm the cover names and the
 * row does not carry is stamped, and a stamped alarm the cover no longer names
 * is lifted. What the fakes cannot see — the two `WHERE` guards and the
 * read-back — is `alarm-lifecycle.integration.spec.ts`'s claim.
 *
 * New cases go here rather than into the 945-line raise-retry spec (plan U8).
 *
 * **Cases 8–16 are U9: the later phases obey the stamps** (ADR 0131 decisions 6,
 * 8; plan Q3, D10, D11, D12), each driven through `runLifecycleSweep` so the
 * suppression phase's hand-off is part of what is asserted. Each negative case
 * carries its positive twin — the same fixture unsuppressed does dispatch — so
 * none can pass on a phase that sends nothing at all.
 */

const W1 = "aaaaaaaa-0000-4000-8000-000000000001";
const W2 = "aaaaaaaa-0000-4000-8000-000000000002";

export function deviceRow(overrides: Partial<DeviceLifecycleAlarm> = {}): DeviceLifecycleAlarm {
  return {
    id: "device-1",
    organizationId: ORG_A,
    assetId: null,
    ruleId: null,
    source: "rtu_comms",
    rtuId: "rtu-1",
    severity: "warning",
    message: "Communication lost: Pump house 1",
    raisedAt: secondsBefore(600),
    acknowledgedAt: null,
    normalSince: null,
    suppressedAt: null,
    unsuppressedAt: null,
    ...overrides,
  };
}

const sameInstant = (a: Date | null | undefined, b: Date): boolean => a?.getTime() === b.getTime();

/** 1. An active, unstamped alarm the cover names is stamped with that window, and broadcast once. */
export async function assertACoveredAlarmIsStamped(): Promise<void> {
  const alarm = alarmRow();
  const { deps, recorded } = fakeDeps({ alarms: [alarm], rules: [], cover: new Map([[alarm.id, W1]]) });
  const out = await runSuppressionPhase(deps, { ruleAlarms: [alarm], deviceAlarms: [], now: NOW });

  assert(recorded.suppressionWrites.length === 1, `one write, got ${recorded.suppressionWrites.length}`);
  const [write] = recorded.suppressionWrites;
  const [update] = write?.updates ?? [];
  assert(write?.organizationId === ORG_A, "the write runs under the alarm's organization");
  assert(
    write?.updates.length === 1 && update?.kind === "stamp" && update.alarmId === alarm.id && update.windowId === W1,
    `one stamp by W1, got ${JSON.stringify(write?.updates)}`,
  );
  assert(update !== undefined && sameInstant(update.at, NOW), "stamped at the tick's now");
  assert(
    recorded.suppressionBroadcasts.length === 1 && recorded.suppressionBroadcasts[0]?.id === alarm.id,
    `one suppression broadcast, got ${recorded.suppressionBroadcasts.length}`,
  );
  assert(sameInstant(out.ruleAlarms[0]?.suppressedAt, NOW), "the returned alarm carries the stamp");
}

/** 2. A stamped alarm with no cover is lifted: `unsuppressedAt = now`, the window id kept, one broadcast. */
export async function assertAnUncoveredStampIsLifted(): Promise<void> {
  const alarm = alarmRow({ suppressedAt: secondsBefore(3600) });
  const { deps, recorded } = fakeDeps({ alarms: [alarm], rules: [] });
  const out = await runSuppressionPhase(deps, { ruleAlarms: [alarm], deviceAlarms: [], now: NOW });

  const [update] = recorded.suppressionWrites[0]?.updates ?? [];
  assert(
    recorded.suppressionWrites.length === 1 && update?.kind === "lift" && update.alarmId === alarm.id,
    `one lift, got ${JSON.stringify(recorded.suppressionWrites)}`,
  );
  assert(update !== undefined && sameInstant(update.at, NOW), "lifted at the tick's now (the new escalation clock)");
  assert(!("windowId" in (update ?? {})), "a lift writes no window id: the stamping window is kept as history (D12)");
  const [broadcast] = recorded.suppressionBroadcasts;
  assert(
    recorded.suppressionBroadcasts.length === 1 && broadcast?.suppressed === false && broadcast.unsuppressedAt === NOW.toISOString(),
    `one suppression broadcast of the lifted row, got ${JSON.stringify(recorded.suppressionBroadcasts)}`,
  );
  const lifted = out.ruleAlarms[0];
  assert(lifted?.suppressedAt === null, "the returned alarm is no longer suppressed");
  assert(sameInstant(lifted?.unsuppressedAt, NOW), "the returned alarm has unsuppressedAt = now");
}

/** 3. Two windows covered it and one ended: the other still covers it, so nothing is written (decision 9). */
export async function assertOneOfTwoWindowsEndingWritesNothing(): Promise<void> {
  // Stamped by W1, which ended; W2 (a later start) still covers it.
  const alarm = alarmRow({ suppressedAt: secondsBefore(3600) });
  const { deps, recorded } = fakeDeps({ alarms: [alarm], rules: [], cover: new Map([[alarm.id, W2]]) });
  const out = await runSuppressionPhase(deps, { ruleAlarms: [alarm], deviceAlarms: [], now: NOW });

  assert(recorded.suppressionWrites.length === 0, `no write, got ${JSON.stringify(recorded.suppressionWrites)}`);
  assert(recorded.suppressionBroadcasts.length === 0, "no broadcast");
  assert(out.ruleAlarms[0] === alarm, "the alarm is handed on unchanged, still suppressed");
}

/** 4. No active window and no stamped alarm: one cover read, and `writeAlarmSuppression` is never called. */
export async function assertAQuietFleetCostsOneRead(): Promise<void> {
  const rule = alarmRow();
  const device = deviceRow();
  const { deps, recorded } = fakeDeps({ alarms: [rule], rules: [], deviceAlarms: [device] });
  await runSuppressionPhase(deps, { ruleAlarms: [rule], deviceAlarms: [device], now: NOW });

  assert(recorded.coverReads.length === 1, `one cover read, got ${recorded.coverReads.length}`);
  assert(
    JSON.stringify(recorded.coverReads[0]) === JSON.stringify([rule.id, device.id]),
    `the one read asks about both kinds, got ${JSON.stringify(recorded.coverReads)}`,
  );
  assert(recorded.suppressionWrites.length === 0, "no write");
  assert(recorded.suppressionBroadcasts.length === 0, "no broadcast");
}

/** 5. Organization A's write throws: B's still lands; A is warned once; A's stamp still applies (nothing leaks). */
export async function assertAFailingOrganizationDoesNotStopTheNext(): Promise<void> {
  const a1 = alarmRow({ id: "alarm-a1" });
  const a2 = alarmRow({ id: "alarm-a2", suppressedAt: secondsBefore(600) });
  const b1 = alarmRow({ id: "alarm-b1", organizationId: ORG_B });
  const base = fakeDeps({ alarms: [a1, a2, b1], rules: [] });
  const { deps, recorded } = fakeDeps({
    alarms: [a1, a2, b1],
    rules: [],
    cover: new Map([
      [a1.id, W1],
      [b1.id, W2],
    ]),
    writeAlarmSuppression: (organizationId, updates) =>
      organizationId === ORG_A ? Promise.reject(new Error("tenant write refused")) : base.deps.writeAlarmSuppression(organizationId, updates),
  });
  const out = await runSuppressionPhase(deps, { ruleAlarms: [a1, a2, b1], deviceAlarms: [], now: NOW });

  assert(
    JSON.stringify(recorded.suppressionWrites.map((w) => w.organizationId)) === JSON.stringify([ORG_A, ORG_B]),
    `A was tried and B still ran, got ${JSON.stringify(recorded.suppressionWrites.map((w) => w.organizationId))}`,
  );
  const warns = recorded.warnings.filter((w) => w.includes(ORG_A));
  assert(warns.length === 1 && recorded.warnings.length === 1, `A is warned once, got ${JSON.stringify(recorded.warnings)}`);
  assert(
    recorded.suppressionBroadcasts.length === 1 && recorded.suppressionBroadcasts[0]?.id === b1.id,
    `only B's landed row is broadcast, got ${JSON.stringify(recorded.suppressionBroadcasts.map((b) => b.id))}`,
  );
  const byId = new Map(out.ruleAlarms.map((alarm) => [alarm.id, alarm]));
  assert(sameInstant(byId.get(a1.id)?.suppressedAt, NOW), "A's stamp decision applies though its write failed: nothing may leak");
  assert(
    byId.get(a2.id)?.suppressedAt !== null && byId.get(a2.id)?.unsuppressedAt === null,
    "A's lift does not apply: its write did not land",
  );
  assert(sameInstant(byId.get(b1.id)?.suppressedAt, NOW), "B's stamp landed");
}

/** 6. An `ingest_host` alarm is never stamped, whatever the cover says. */
export async function assertAnIngestHostAlarmIsNeverStamped(): Promise<void> {
  const host = deviceRow({ id: "device-host", source: "ingest_host", rtuId: null });
  const { deps, recorded } = fakeDeps({ alarms: [], rules: [], deviceAlarms: [host], cover: new Map([[host.id, W1]]) });
  const out = await runSuppressionPhase(deps, { ruleAlarms: [], deviceAlarms: [host], now: NOW });

  assert(recorded.suppressionWrites.length === 0, `no write, got ${JSON.stringify(recorded.suppressionWrites)}`);
  assert(!(recorded.coverReads[0] ?? []).includes(host.id), "the cover is not even asked about it");
  assert(out.deviceAlarms[0]?.suppressedAt === null, "the returned alarm is unstamped");
}

/** 7. An alarm lifted earlier and covered again by a later window takes the new window's id. */
export async function assertARecoveredAlarmTakesTheNewWindow(): Promise<void> {
  const lifted: LifecycleAlarm = alarmRow({ suppressedAt: null, unsuppressedAt: secondsBefore(1800) });
  const { deps, recorded } = fakeDeps({ alarms: [lifted], rules: [], cover: new Map([[lifted.id, W2]]) });
  const out = await runSuppressionPhase(deps, { ruleAlarms: [lifted], deviceAlarms: [], now: NOW });

  const [update] = recorded.suppressionWrites[0]?.updates ?? [];
  assert(update?.kind === "stamp" && update.windowId === W2, `stamped by the later window, got ${JSON.stringify(update)}`);
  assert(recorded.suppressionBroadcasts[0]?.maintenanceWindowId === W2, "the broadcast row names the new window");
  assert(sameInstant(out.ruleAlarms[0]?.suppressedAt, NOW), "suppressed again");
}

// --- U9: the phases obey the stamps ------------------------------------------

const minutesAfter = (minutes: number, from: Date = NOW): Date => new Date(from.getTime() + minutes * 60_000);
const RAISE_KEY = buildDedupeKey({ ruleId: "rule-1", alarmId: "alarm-1", severity: "warning" });

function raiseRow(overrides: Partial<RaiseAttemptRow> = {}): RaiseAttemptRow {
  return { alarmId: "alarm-1", organizationId: ORG_A, channelId: C1.id, status: "failed", attemptedAt: secondsBefore(3600), ...overrides };
}

/** One step at 15 min → c1, for `(ORG_A, warning)`. */
function fifteenMinuteStep(): EscalationCatalog {
  return { defaults: new Map([[escalationKey(ORG_A, "warning"), [{ stepNo: 1, afterMinutes: 15, channelIds: [C1.id] }]]]) };
}

/** A monitored RTU silent for an hour behind a fresh host: an `rtu_comms` alarm on it is a fault and never clears. */
function silentRtu(): DeviceHealthSnapshot {
  const row: RtuHealthRow = {
    rtuId: "rtu-1",
    organizationId: ORG_A,
    code: "RTU-1",
    displayName: "Pump house 1",
    edgeServed: false,
    hostKey: "ingest-1",
    lastSeenMs: NOW.getTime() - 3_600_000,
    monitoredSinceMs: NOW.getTime() - 7_200_000,
    windowSeconds: 60,
    clockSkewSeconds: null,
    clockSkewAtMs: null,
  };
  return { rows: [row], hosts: [{ hostKey: "ingest-1", lastBeatMs: NOW.getTime() - 5000, healthySinceMs: NOW.getTime() - 3_600_000 }], dbNowMs: NOW.getTime() };
}

const escalations = (recorded: ReturnType<typeof fakeDeps>["recorded"]) =>
  recorded.dispatches.filter((d) => d.input.event?.kind === "escalation");
const raises = (recorded: ReturnType<typeof fakeDeps>["recorded"]) =>
  recorded.dispatches.filter((d) => d.input.event === undefined);

/** 8. A suppressed alarm with a due step sends nothing (so writes no ledger row); unsuppressed, the same step goes. */
export async function assertASuppressedAlarmDoesNotEscalate(): Promise<void> {
  const suppressed = alarmRow({ raisedAt: secondsBefore(600), suppressedAt: secondsBefore(600) });
  const quiet = fakeDeps({ alarms: [suppressed], rules: [ruleRow()], catalog: twoStepCatalog(), cover: new Map([[suppressed.id, W1]]) });
  await runLifecycleSweep(quiet.deps, NOW);
  assert(quiet.recorded.dispatches.length === 0, `nothing is dispatched, got ${quiet.recorded.dispatches.length}`);

  const twin = fakeDeps({ alarms: [alarmRow({ raisedAt: secondsBefore(600) })], rules: [ruleRow()], catalog: twoStepCatalog() });
  await runLifecycleSweep(twin.deps, NOW);
  assert(escalations(twin.recorded).length === 2, `the twin escalates both due steps, got ${escalations(twin.recorded).length}`);
}

/** 9. A suppressed alarm holding a `failed` raise row is not re-offered; unsuppressed, it is. */
export async function assertASuppressedAlarmsRaiseIsNotReoffered(): Promise<void> {
  const suppressed = alarmRow({ suppressedAt: secondsBefore(60) });
  const quiet = fakeDeps({ alarms: [suppressed], rules: [ruleRow()], raiseAttempts: [raiseRow()], cover: new Map([[suppressed.id, W1]]) });
  await runLifecycleSweep(quiet.deps, NOW);
  assert(quiet.recorded.dispatches.length === 0, `not re-offered, got ${quiet.recorded.dispatches.length}`);
  assert(quiet.recorded.raiseAttemptReads.length === 0, "and its ledger is not even read");

  const twin = fakeDeps({ alarms: [alarmRow()], rules: [ruleRow()], raiseAttempts: [raiseRow()] });
  await runLifecycleSweep(twin.deps, NOW);
  assert(raises(twin.recorded).length === 1, `the twin is re-offered, got ${raises(twin.recorded).length}`);
}

/** 10. A suppressed alarm clears: the `cleared` broadcast goes out, nobody is sent the cleared message. */
export async function assertASuppressedAlarmClearsSilently(): Promise<void> {
  const nonMatching = { time: secondsBefore(5), value: 50, unit: "kW" };
  const holdDone = { normalSince: secondsBefore(200) };
  const suppressed = alarmRow({ ...holdDone, suppressedAt: secondsBefore(600) });
  const quiet = fakeDeps({
    alarms: [suppressed],
    rules: [ruleRow()],
    sample: nonMatching,
    sentChannelIds: [C1.id],
    cover: new Map([[suppressed.id, W1]]),
  });
  await runLifecycleSweep(quiet.deps, NOW);
  assert(
    quiet.recorded.broadcasts.length === 1 && quiet.recorded.broadcasts[0]?.id === suppressed.id,
    `the clear is broadcast, got ${quiet.recorded.broadcasts.length}`,
  );
  assert(quiet.recorded.dispatches.length === 0, `dispatchToChannels is not called, got ${quiet.recorded.dispatches.length}`);
  assert(quiet.recorded.sentReads.length === 0, "nor is the cleared message's recipient list read");

  const twin = fakeDeps({ alarms: [alarmRow(holdDone)], rules: [ruleRow()], sample: nonMatching, sentChannelIds: [C1.id] });
  await runLifecycleSweep(twin.deps, NOW);
  assert(
    twin.recorded.dispatches.filter((d) => d.input.event?.kind === "cleared").length === 1,
    "the twin's cleared message goes to the channel holding a sent row",
  );
}

/**
 * 11. Lifted this tick, unacknowledged, a `notify` rule, one joined channel with
 * no row: the withheld raise goes out in the same tick, with the raise key and
 * `reoffered`. The next tick, with a `sent` row now under the key, sends nothing.
 */
export async function assertALiftedAlarmIsSentTheWithheldRaise(): Promise<void> {
  const stamped = alarmRow({ raisedAt: secondsBefore(3600), suppressedAt: secondsBefore(3600) });
  const lift = fakeDeps({ alarms: [stamped], rules: [ruleRow()], ruleChannels: () => [C1] });
  await runLifecycleSweep(lift.deps, NOW);
  const [sent] = raises(lift.recorded);
  assert(lift.recorded.suppressionWrites[0]?.updates[0]?.kind === "lift", "the alarm is lifted first");
  assert(raises(lift.recorded).length === 1 && lift.recorded.dispatches.length === 1, `one dispatch, got ${lift.recorded.dispatches.length}`);
  assert(sent !== undefined && buildDedupeKey(sent.input) === RAISE_KEY, `under the raise key, got ${sent ? buildDedupeKey(sent.input) : "none"}`);
  assert(sent?.input.reoffered === true && sent.input.raised, "as the re-offered raise");
  assert(sent?.channels.length === 1 && sent.channels[0]?.id === C1.id, "to the one joined channel");

  const returned = alarmRow({ raisedAt: secondsBefore(3600), unsuppressedAt: NOW });
  const next = fakeDeps({
    alarms: [returned],
    rules: [ruleRow()],
    ruleChannels: () => [C1],
    raiseAttempts: [raiseRow({ status: "sent", attemptedAt: NOW })],
  });
  await runLifecycleSweep(next.deps, minutesAfter(0.5));
  assert(next.recorded.dispatches.length === 0, `the next tick sends nothing, got ${next.recorded.dispatches.length}`);
}

/** 12. Lifted, but the channel holds a `sent` raise row from before the window: nothing (plan Q3). */
export async function assertARaiseSentBeforeTheWindowIsNotRepeated(): Promise<void> {
  const stamped = alarmRow({ raisedAt: secondsBefore(3600), suppressedAt: secondsBefore(1800) });
  const { deps, recorded } = fakeDeps({
    alarms: [stamped],
    rules: [ruleRow()],
    ruleChannels: () => [C1],
    raiseAttempts: [raiseRow({ status: "sent" })],
  });
  await runLifecycleSweep(deps, NOW);
  assert(recorded.raiseAttemptReads.length === 1, "the ledger is asked");
  assert(recorded.dispatches.length === 0, `nothing is sent, got ${recorded.dispatches.length}`);
}

/** 13. Lifted, but acknowledged: neither the raise nor a step (ADR 0057 Amendment 5 ruling 4). */
export async function assertAnAcknowledgedLiftedAlarmGetsNothing(): Promise<void> {
  const stamped = alarmRow({ raisedAt: secondsBefore(3600), suppressedAt: secondsBefore(3600), acknowledgedAt: secondsBefore(1800) });
  const lift = fakeDeps({ alarms: [stamped], rules: [ruleRow()], ruleChannels: () => [C1], catalog: twoStepCatalog() });
  await runLifecycleSweep(lift.deps, NOW);
  assert(lift.recorded.suppressionWrites[0]?.updates[0]?.kind === "lift", "it is lifted");
  assert(lift.recorded.dispatches.length === 0, `nothing on the lift tick, got ${lift.recorded.dispatches.length}`);

  const later = fakeDeps({
    alarms: [{ ...stamped, suppressedAt: null, unsuppressedAt: NOW }],
    rules: [ruleRow()],
    ruleChannels: () => [C1],
    catalog: twoStepCatalog(),
  });
  await runLifecycleSweep(later.deps, minutesAfter(10));
  assert(later.recorded.dispatches.length === 0, `nor ten minutes later, got ${later.recorded.dispatches.length}`);
}

/** 14. Raised 3 days ago, lifted now, a step at 15 min: not due 14 min after the lift; due and NOT stale at 15. */
export async function assertTheEscalationClockRestartsAtTheLift(): Promise<void> {
  const returned = alarmRow({ raisedAt: secondsBefore(3 * 86_400), unsuppressedAt: NOW });
  const at14 = fakeDeps({ alarms: [returned], rules: [ruleRow()], catalog: fifteenMinuteStep() });
  await runLifecycleSweep(at14.deps, minutesAfter(14));
  assert(escalations(at14.recorded).length === 0, `not due at 14 min, got ${escalations(at14.recorded).length}`);

  const at15 = fakeDeps({ alarms: [returned], rules: [ruleRow()], catalog: fifteenMinuteStep() });
  await runLifecycleSweep(at15.deps, minutesAfter(15));
  const [step] = escalations(at15.recorded);
  assert(escalations(at15.recorded).length === 1, `due at 15 min, got ${escalations(at15.recorded).length}`);
  assert(step?.input.event?.kind === "escalation" && step.input.event.stale === undefined, "and not stale");
  assert(
    step?.input.message.endsWith("unacknowledged for 15 min (escalation step 1)") ?? false,
    `the minutes count from the lift, got ${step?.input.message ?? "none"}`,
  );
}

/**
 * 15. A step sent before the window is not sent again. The ledger refuses it
 * inside `dispatchToChannels`, and that works only because the step re-offered
 * after the lift carries the SAME key it was sent under — no epoch (plan Q3, not
 * the rejected alternative). The real refusal is the integration claim for 14.
 */
export async function assertAStepSentBeforeTheWindowKeepsItsKey(): Promise<void> {
  const returned = alarmRow({ raisedAt: secondsBefore(3 * 86_400), unsuppressedAt: NOW });
  const { deps, recorded } = fakeDeps({ alarms: [returned], rules: [ruleRow()], catalog: twoStepCatalog() });
  await runLifecycleSweep(deps, minutesAfter(1));
  const keys = escalations(recorded).map((d) => buildDedupeKey(d.input));
  assert(JSON.stringify(keys) === JSON.stringify([`${RAISE_KEY}:escalation:1`]), `step 1 only, under its own key, got ${JSON.stringify(keys)}`);
}

/** 16. A device alarm: suppressed, it does not escalate (8); lifted, its clock restarts at the lift (14). */
export async function assertADeviceAlarmObeysTheStamps(): Promise<void> {
  const health = silentRtu();
  const suppressed = deviceRow({ raisedAt: secondsBefore(600), suppressedAt: secondsBefore(600) });
  const quiet = fakeDeps({ alarms: [], rules: [], deviceAlarms: [suppressed], deviceHealth: health, catalog: twoStepCatalog(), cover: new Map([[suppressed.id, W1]]) });
  await runLifecycleSweep(quiet.deps, NOW);
  assert(quiet.recorded.dispatches.length === 0, `a suppressed device alarm does not escalate, got ${quiet.recorded.dispatches.length}`);
  const twin = fakeDeps({ alarms: [], rules: [], deviceAlarms: [deviceRow({ raisedAt: secondsBefore(600) })], deviceHealth: health, catalog: twoStepCatalog() });
  await runLifecycleSweep(twin.deps, NOW);
  assert(escalations(twin.recorded).length === 2, `the twin does, got ${escalations(twin.recorded).length}`);

  const returned = deviceRow({ raisedAt: secondsBefore(3 * 86_400), unsuppressedAt: NOW });
  const at14 = fakeDeps({ alarms: [], rules: [], deviceAlarms: [returned], deviceHealth: health, catalog: fifteenMinuteStep() });
  await runLifecycleSweep(at14.deps, minutesAfter(14));
  assert(escalations(at14.recorded).length === 0, `not due 14 min after the lift, got ${escalations(at14.recorded).length}`);
  const at15 = fakeDeps({ alarms: [], rules: [], deviceAlarms: [returned], deviceHealth: health, catalog: fifteenMinuteStep() });
  await runLifecycleSweep(at15.deps, minutesAfter(15));
  const [step] = escalations(at15.recorded);
  assert(step?.input.event?.kind === "escalation" && step.input.event.stale === undefined, "due at 15 min and not stale");
}

/** 16b. A suppressed device alarm that clears sends no cleared message (plan D12). */
export async function assertASuppressedDeviceAlarmClearsSilently(): Promise<void> {
  // No RTU row: the alarm is "gone" and clears at once.
  const suppressed = deviceRow({ suppressedAt: secondsBefore(600) });
  const { deps, recorded } = fakeDeps({ alarms: [], rules: [], deviceAlarms: [suppressed], sentChannelIds: [C1.id], cover: new Map([[suppressed.id, W1]]) });
  await runLifecycleSweep(deps, NOW);
  assert(recorded.broadcasts.length === 1, "the clear is broadcast");
  assert(recorded.dispatches.length === 0 && recorded.sentReads.length === 0, "and nobody is told");
  const twin = fakeDeps({ alarms: [], rules: [], deviceAlarms: [deviceRow()], sentChannelIds: [C1.id] });
  await runLifecycleSweep(twin.deps, NOW);
  assert(twin.recorded.dispatches.length === 1, "the twin's cleared message goes out");
}

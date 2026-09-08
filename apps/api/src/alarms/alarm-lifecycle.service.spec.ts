import type { AlarmListItem } from "@bms/shared";

import type { NotificationChannelRow } from "../notifications/notification-transport";
import type { DispatchInput } from "../notifications/notifications.service";
import type { RaiseAttemptRow, RaiseKeyRef } from "../notifications/raise-retry";
import { LostLedgerRows } from "../notifications/raise-retry";
import type { RuleRow } from "../rules/rules.types";
import {
  type EscalationCatalog,
  type LifecycleAlarm,
  LIFECYCLE_TICK_MS,
  escalationKey,
} from "./alarm-lifecycle";
import {
  type AlarmLifecycleDeps,
  type AlarmLifecycleLoopDeps,
  type AlarmStateUpdate,
  runLifecycleLoop,
  runLifecycleSweep,
} from "./alarm-lifecycle.service";

/**
 * `F3.10` U7 — `runLifecycleSweep` over fakes (ADR 0057 decisions 5, 6, 9;
 * plan D4, D12, D13). Assertions live here; the sibling `.test` is the Vitest
 * entry point (ADR 0014).
 *
 * Every dependency is a recording fake and `now` is an argument, so the eight
 * cases the plan lists run against fixed instants with no database, no
 * socket and no transport. What the fakes cannot see — the real `WHERE` of
 * the alarm selection, the `cleared_at IS NULL` guard on the update, the
 * escalation join and the ledger reads inside `dispatchToChannels` — is
 * proved in `alarm-lifecycle.integration.spec.ts`.
 *
 * The `broadcastCleared` assertion U5 deferred here: no spec constructs
 * `AlarmsGateway` with a fake namespace, so the gateway call is asserted
 * through the deps fake (case 2), after the write and once per cleared row.
 *
 * **`F3.51` exports the fixture, not the cases.** `fakeDeps` and the rows
 * below are the sweep's only fixture, and the raise-retry phase needs the same
 * one; `alarm-lifecycle-raise-retry.spec.ts` imports them rather than growing
 * this file past AGENTS.md §4.5's 1000-line cap, the way
 * `notifications.events.spec.ts` imports `fakeDb` and `input` from
 * `notifications.service.spec.ts`.
 *
 * **Twelve of the thirteen cases below are unchanged; the thirteenth is not,
 * and saying "unchanged" would be a false sentence in this docblock.**
 * `testUnmappedSeverityAndOrganizationlessRule` had one count widened from one
 * warn to two: an org-less rule is now refused by two phases and each says so
 * once. Everything else is untouched, because with owner ruling 3's evidence
 * conjunct an empty ledger owes nobody and a default `fakeDeps` retries
 * nothing — which also means **not one of these cases gates the raise-retry
 * phase**. `alarm-lifecycle-raise-retry.spec.ts` is the whole of that gate, and
 * its own docblock states the same correction.
 */

export function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

export const NOW = new Date("2026-09-06T12:00:00.000Z");
export const ORG_A = "11111111-1111-4111-8111-111111111111";
export const ORG_B = "22222222-2222-4222-8222-222222222222";

export function secondsBefore(seconds: number, from: Date = NOW): Date {
  return new Date(from.getTime() - seconds * 1000);
}

export function alarmRow(overrides: Partial<LifecycleAlarm> = {}): LifecycleAlarm {
  return {
    id: "alarm-1",
    organizationId: ORG_A,
    assetId: "asset-1",
    ruleId: "rule-1",
    severity: "warning",
    message: "Feeder overload: kw = 150 (gt 100)",
    raisedAt: secondsBefore(61),
    acknowledgedAt: null,
    normalSince: null,
    ...overrides,
  };
}

export function ruleRow(overrides: Partial<RuleRow> = {}): RuleRow {
  return {
    id: "rule-1",
    code: "RULE-1",
    name: "Feeder overload",
    description: null,
    category: "safety",
    ruleType: "threshold",
    source: "operator_rule",
    enabled: true,
    organizationId: ORG_A,
    assetOrganizationId: ORG_A,
    assetId: "asset-1",
    assetCode: "ASSET-1",
    assetName: "Feeder 1",
    siteName: "Site A",
    assetDomain: "electrical",
    pointKey: "kw",
    operator: "gt",
    thresholdValue: 100,
    severity: "warning",
    clearHoldSeconds: null,
    condition: { window: "latest" },
    action: { type: "notify", target: "Operations" },
    lastEvaluatedAt: null,
    lifecycleStatus: "published",
    publishedAt: null,
    archivedAt: null,
    duplicatedFromRuleId: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

export function channelRow(id: string, code: string): NotificationChannelRow {
  return {
    id,
    code,
    name: code,
    kind: "webhook",
    organizationId: ORG_A,
    config: { url: "https://hooks.example.com/x" },
    secret: null,
    secretState: "none",
    enabled: true,
    updatedAt: new Date("2020-01-01T00:00:00.000Z"),
  };
}

export const C1 = channelRow("cccccccc-0000-4000-8000-000000000001", "c1");
export const C2 = channelRow("cccccccc-0000-4000-8000-000000000002", "c2");

type Sample = { time: Date; value: number; unit: string | null } | null;

export type Recorded = {
  writes: { organizationId: string; updates: AlarmStateUpdate[] }[];
  dispatches: { channels: NotificationChannelRow[]; input: DispatchInput }[];
  broadcasts: AlarmListItem[];
  sentReads: { alarmId: string; organizationId: string }[];
  channelLoads: string[][];
  /** `F3.51`: the refs of every `loadRaiseAttempts` call, one entry per call. */
  raiseAttemptReads: RaiseKeyRef[][];
  /** `F3.51`: every rule id `loadRuleChannels` was called with, in order — the memo's gate. */
  ruleChannelLoads: string[];
  warnings: string[];
};

/** The catalogue with one profile mapped for `(ORG_A, warning)`: step 1 at 1 min → c1, step 2 at 5 min → c2. */
export function twoStepCatalog(organizationId = ORG_A, severity = "warning"): EscalationCatalog {
  return {
    defaults: new Map([
      [
        escalationKey(organizationId, severity),
        [
          { stepNo: 1, afterMinutes: 1, channelIds: [C1.id] },
          { stepNo: 2, afterMinutes: 5, channelIds: [C2.id] },
        ],
      ],
    ]),
  };
}

export function fakeDeps(opts: {
  alarms: LifecycleAlarm[];
  rules: RuleRow[];
  /** One sample for every `(asset, point)`, or a function of them. */
  sample?: Sample | ((assetId: string, pointKey: string) => Sample);
  catalog?: EscalationCatalog;
  sentChannelIds?: string[];
  /** What `loadChannels` returns for any id list; defaults to the rows whose ids were asked for. */
  channels?: NotificationChannelRow[];
  writeAlarmState?: AlarmLifecycleDeps["writeAlarmState"];
  /** Replaces the recording `loadChannels` — for the case where one read rejects. */
  loadChannels?: AlarmLifecycleDeps["loadChannels"];
  /**
   * `F3.51`: the ledger rows under the raise keys. Defaults to `[]`, and with
   * the evidence conjunct that means nobody is owed — which is why the
   * thirteen cases below did not change when the phase was added.
   */
  raiseAttempts?: RaiseAttemptRow[];
  /** Replaces the recording `loadRaiseAttempts` — for the case where the read rejects. */
  loadRaiseAttempts?: AlarmLifecycleDeps["loadRaiseAttempts"];
  /** `F3.51`: the channels joined to a rule; defaults to both known rows for every rule. */
  ruleChannels?: (ruleId: string) => NotificationChannelRow[];
  /**
   * `F3.51` review: the lost-row memory. Defaults to a FRESH instance per
   * fixture — a case that needs it to survive two sweeps passes one in, and no
   * case can be polluted by another's losses.
   */
  lostLedgerRows?: LostLedgerRows;
}): { deps: AlarmLifecycleDeps; recorded: Recorded } {
  const recorded: Recorded = {
    writes: [],
    dispatches: [],
    broadcasts: [],
    sentReads: [],
    channelLoads: [],
    raiseAttemptReads: [],
    ruleChannelLoads: [],
    warnings: [],
  };
  const byId = new Map(opts.alarms.map((alarm) => [alarm.id, alarm]));
  const known = [C1, C2];

  const deps: AlarmLifecycleDeps = {
    loadActiveAlarms: () => Promise.resolve(opts.alarms),
    loadRules: () => Promise.resolve(opts.rules),
    loadSamples: () =>
      Promise.resolve(async (assetId: string, pointKey: string) =>
        typeof opts.sample === "function"
          ? opts.sample(assetId, pointKey)
          : (opts.sample ?? null),
      ),
    loadEscalation: () => Promise.resolve(opts.catalog ?? { defaults: new Map() }),
    writeAlarmState:
      opts.writeAlarmState ??
      ((organizationId, updates) => {
        recorded.writes.push({ organizationId, updates });
        // The real write returns the cleared rows as `AlarmListItem`s,
        // read back inside the same transaction.
        return Promise.resolve(
          updates
            .filter((update) => update.clearedAt !== null)
            .map((update) => {
              const alarm = byId.get(update.alarmId);
              if (!alarm) throw new Error(`fake: unknown alarm ${update.alarmId}`);
              return {
                id: alarm.id,
                assetId: alarm.assetId,
                ruleKey: "RULE-1",
                ruleId: alarm.ruleId,
                severity: alarm.severity,
                message: alarm.message,
                raisedAt: alarm.raisedAt.toISOString(),
                acknowledgedAt: alarm.acknowledgedAt?.toISOString() ?? null,
                acknowledgedBy: null,
                clearedAt: update.clearedAt?.toISOString() ?? null,
                assetCode: "ASSET-1",
                assetName: "Feeder 1",
                siteName: "Site A",
              };
            }),
        );
      }),
    sentChannelIdsForAlarm: (alarmId, organizationId) => {
      recorded.sentReads.push({ alarmId, organizationId });
      return Promise.resolve(opts.sentChannelIds ?? []);
    },
    loadChannels: (ids) => {
      recorded.channelLoads.push([...ids]);
      if (opts.loadChannels) {
        return opts.loadChannels(ids);
      }
      return Promise.resolve(opts.channels ?? known.filter((row) => ids.includes(row.id)));
    },
    loadRuleChannels: (ruleId) => {
      recorded.ruleChannelLoads.push(ruleId);
      return Promise.resolve(opts.ruleChannels ? opts.ruleChannels(ruleId) : known);
    },
    loadRaiseAttempts: (refs) => {
      recorded.raiseAttemptReads.push([...refs]);
      return opts.loadRaiseAttempts
        ? opts.loadRaiseAttempts(refs)
        : // Every batch returned: nothing unread, nothing to warn about. A case
          // that needs a half-failed read supplies its own `loadRaiseAttempts`.
          Promise.resolve({
            rows: opts.raiseAttempts ?? [],
            unread: new Set<string>(),
            reasons: [],
          });
    },
    lostLedgerRows: opts.lostLedgerRows ?? new LostLedgerRows(),
    dispatchToChannels: (channels, input) => {
      recorded.dispatches.push({ channels: [...channels], input });
      return Promise.resolve(
        channels.map((channel) => ({
          status: "sent" as const,
          error: null,
          channelId: channel.id,
          // The default fake's row always lands. A case that needs a lost row
          // wraps this — R17 does.
          rowLost: false,
        })),
      );
    },
    broadcastCleared: (alarm) => {
      recorded.broadcasts.push(alarm);
    },
    logger: { warn: (message: string) => recorded.warnings.push(message) } as never,
  };
  return { deps, recorded };
}

const freshNonMatching: Sample = { time: secondsBefore(5), value: 50, unit: "kW" };
const freshMatching: Sample = { time: secondsBefore(5), value: 150, unit: "kW" };

/** 1. A fresh non-matching sample starts the hold: one `normal_since` write, nothing else. */
async function testFirstNonMatchingSampleStartsTheHold(): Promise<void> {
  const { deps, recorded } = fakeDeps({
    alarms: [alarmRow()],
    rules: [ruleRow()],
    sample: freshNonMatching,
  });
  await runLifecycleSweep(deps, NOW);

  assert(recorded.writes.length === 1, `one organization write, got ${recorded.writes.length}`);
  const write = recorded.writes[0];
  assert(write?.organizationId === ORG_A, "the write runs under the ALARM's organization");
  assert(
    write?.updates.length === 1 &&
      write.updates[0]?.alarmId === "alarm-1" &&
      write.updates[0].normalSince === NOW &&
      write.updates[0].clearedAt === null,
    `one update { normalSince: now, clearedAt: null }, got ${JSON.stringify(write?.updates)}`,
  );
  assert(recorded.dispatches.length === 0, "nothing is dispatched while the hold runs");
  assert(recorded.broadcasts.length === 0, "nothing is broadcast while the hold runs");
  assert(recorded.sentReads.length === 0, "the cleared recipients are not read while the hold runs");
  assert(recorded.warnings.length === 0, `no warning, got ${recorded.warnings.join(" | ")}`);
}

/** 2. The hold elapsed: cleared, broadcast once with the returned row, and the cleared message to the `sent` channels only. */
async function testHoldElapsedClearsBroadcastsAndNotifiesSentChannels(): Promise<void> {
  const since = secondsBefore(120);
  const { deps, recorded } = fakeDeps({
    alarms: [alarmRow({ normalSince: since })],
    rules: [ruleRow()],
    sample: freshNonMatching,
    sentChannelIds: [C1.id],
  });
  await runLifecycleSweep(deps, NOW);

  const update = recorded.writes[0]?.updates[0];
  assert(
    recorded.writes.length === 1 &&
      update?.alarmId === "alarm-1" &&
      update.clearedAt === NOW &&
      update.normalSince === since,
    `one update { clearedAt: now } keeping the stamp, got ${JSON.stringify(recorded.writes)}`,
  );
  assert(
    recorded.broadcasts.length === 1 &&
      recorded.broadcasts[0]?.id === "alarm-1" &&
      recorded.broadcasts[0].clearedAt === NOW.toISOString(),
    `broadcastCleared once with the row writeAlarmState returned, got ${JSON.stringify(recorded.broadcasts)}`,
  );
  assert(
    recorded.sentReads.length === 1 &&
      recorded.sentReads[0]?.alarmId === "alarm-1" &&
      recorded.sentReads[0].organizationId === ORG_A,
    `sentChannelIdsForAlarm(alarm, RULE org) once, got ${JSON.stringify(recorded.sentReads)}`,
  );
  assert(
    recorded.channelLoads.length === 1 && recorded.channelLoads[0]?.join(",") === C1.id,
    `the channels loaded are exactly the sent ids, got ${JSON.stringify(recorded.channelLoads)}`,
  );
  const dispatch = recorded.dispatches[0];
  assert(recorded.dispatches.length === 1, `one dispatch, got ${recorded.dispatches.length}`);
  assert(
    dispatch?.input.event?.kind === "cleared" && dispatch.input.alarmId === "alarm-1",
    `event.kind cleared for the alarm, got ${JSON.stringify(dispatch?.input.event)}`,
  );
  assert(
    dispatch?.channels.length === 1 && dispatch.channels[0]?.id === C1.id,
    "dispatched to exactly the channels loaded for the sent ids",
  );
  assert(dispatch?.input.organizationId === ORG_A, "D12: the dispatch carries the rule's organization");
  assert(dispatch?.input.severity === "warning", "the alarm's severity");

  // With no `sent` row for the alarm nobody is told (ruling Q5), and no
  // channel read is made for an empty id list.
  const none = fakeDeps({
    alarms: [alarmRow({ normalSince: since })],
    rules: [ruleRow()],
    sample: freshNonMatching,
    sentChannelIds: [],
  });
  await runLifecycleSweep(none.deps, NOW);
  assert(none.recorded.broadcasts.length === 1, "the clear is still broadcast");
  assert(none.recorded.dispatches.length === 0, "no sent channel, no cleared message");
  assert(none.recorded.channelLoads.length === 0, "no channel read for an empty recipient list");
}

/** 3. A stale sample (or none) changes nothing — ADR 0027. */
async function testStaleSampleChangesNothing(): Promise<void> {
  const stale = fakeDeps({
    alarms: [alarmRow({ normalSince: secondsBefore(600) })],
    rules: [ruleRow({ clearHoldSeconds: 30 })],
    sample: { time: secondsBefore(16 * 60), value: 50, unit: "kW" },
  });
  await runLifecycleSweep(stale.deps, NOW);
  assert(stale.recorded.writes.length === 0, "a 16-minute-old sample writes nothing");
  assert(stale.recorded.dispatches.length === 0, "and dispatches nothing");
  assert(stale.recorded.broadcasts.length === 0, "and broadcasts nothing");

  const missing = fakeDeps({
    alarms: [alarmRow({ normalSince: secondsBefore(600) })],
    rules: [ruleRow({ clearHoldSeconds: 30 })],
    sample: null,
  });
  await runLifecycleSweep(missing.deps, NOW);
  assert(missing.recorded.writes.length === 0, "no sample writes nothing");
}

/** 4. An unacknowledged alarm 61 s old escalates step 1 to its channel; step 2 at 5 min is not due. */
async function testDueStepIsDispatchedToItsChannels(): Promise<void> {
  const { deps, recorded } = fakeDeps({
    alarms: [alarmRow({ raisedAt: secondsBefore(61) })],
    rules: [ruleRow()],
    sample: freshMatching,
    catalog: twoStepCatalog(),
  });
  await runLifecycleSweep(deps, NOW);

  assert(recorded.writes.length === 0, "a matching sample with no stamp writes nothing");
  assert(recorded.dispatches.length === 1, `one dispatch (step 1), got ${recorded.dispatches.length}`);
  const dispatch = recorded.dispatches[0];
  assert(
    dispatch?.input.event?.kind === "escalation" && dispatch.input.event.step === 1,
    `event { kind: "escalation", step: 1 }, got ${JSON.stringify(dispatch?.input.event)}`,
  );
  assert(
    dispatch?.channels.length === 1 && dispatch.channels[0]?.id === C1.id,
    `step 1 goes to c1 only, got ${dispatch?.channels.map((c) => c.code).join(",")}`,
  );
  assert(
    recorded.channelLoads.length === 1 && recorded.channelLoads[0]?.join(",") === C1.id,
    `only step 1's channels are loaded, got ${JSON.stringify(recorded.channelLoads)}`,
  );
  assert(dispatch?.input.alarmId === "alarm-1", "the alarm id rides on the input");
  assert(
    dispatch?.input.message.endsWith("unacknowledged for 1 min (escalation step 1)"),
    `D14 body, got "${dispatch?.input.message}"`,
  );

  // Ruling Q8: the rule's `action` is not consulted. A `review` rule
  // escalates exactly as a `notify` one does.
  const review = fakeDeps({
    alarms: [alarmRow({ raisedAt: secondsBefore(61) })],
    rules: [ruleRow({ action: { type: "review", target: "Operations" } })],
    sample: freshMatching,
    catalog: twoStepCatalog(),
  });
  await runLifecycleSweep(review.deps, NOW);
  assert(review.recorded.dispatches.length === 1, "escalation ignores the rule's action (Q8)");
}

/**
 * 4b. `F3.48`: a due step is re-offered on **every** tick, not only the tick it
 * became due on.
 *
 * This is the leg `F3.48` rests on and shipped without. Ruling Q1 (ADR 0057
 * Amendment 2) makes a ceiling-refused step retry by writing no ledger row, so
 * the key survives — but "the key survives" only delivers a retry if the sweep
 * offers the step again. Nothing asserted that. The post-merge review found the
 * gap: `alarm-lifecycle.integration.spec.ts`'s second tick asserts only
 * ABSENCES — no second row, no second send — which pass identically whether the
 * sweep re-dispatches and the ledger dedupes it, or the sweep never dispatches
 * at all. It is the only place in the repository that ran two ticks over one
 * alarm, so the retry had no gate anywhere.
 *
 * A unit case rather than an integration one, and deliberately: the claim is
 * about `runEscalationPhase`'s offer, not about the ledger, and
 * `isOverHourlyLimit` reads the wall clock rather than the tick's instant —
 * which is what made this awkward to state against Postgres and is why it was
 * skipped. Here the fake records every dispatch and two ticks cost nothing.
 *
 * The mutation this kills: any guard that offers a step only while it is
 * freshly due — for example skipping a step more than one tick overdue.
 * `dueSteps` itself stays green under that change, because it is `elapsed >=
 * afterMinutes` and never stops being true.
 */
async function testADueStepIsReofferedOnEveryTick(): Promise<void> {
  const { deps, recorded } = fakeDeps({
    alarms: [alarmRow({ raisedAt: secondsBefore(61) })],
    rules: [ruleRow()],
    sample: freshMatching,
    catalog: twoStepCatalog(),
  });

  await runLifecycleSweep(deps, NOW);
  assert(recorded.dispatches.length === 1, `the first tick offers step 1, got ${recorded.dispatches.length}`);

  // One tick later. The alarm is unchanged — still active, still
  // unacknowledged — which is the state a ceiling-refused step leaves behind,
  // because ruling Q1 writes no row for it.
  await runLifecycleSweep(deps, new Date(NOW.getTime() + LIFECYCLE_TICK_MS));
  assert(
    recorded.dispatches.length === 2,
    `F3.48: the same due step is offered again on the next tick — that offer IS the ` +
      `retry — got ${recorded.dispatches.length} dispatches`,
  );
  const second = recorded.dispatches[1];
  assert(
    second?.input.event?.kind === "escalation" && second.input.event.step === 1,
    `and it is the same step, got ${JSON.stringify(second?.input.event)}`,
  );

  // Still only step 1: step 2 is due at 5 min and this tick is at 91 s. A
  // second dispatch of step 1 must not be read as the clock having moved on.
  assert(
    recorded.dispatches.every((d) => d.input.event?.kind === "escalation" && d.input.event.step === 1),
    "no step became due that was not due before",
  );
}

/** 5. Acknowledged, or cleared this very tick: no escalation. */
async function testAcknowledgedOrJustClearedAlarmsDoNotEscalate(): Promise<void> {
  const acknowledged = fakeDeps({
    alarms: [alarmRow({ raisedAt: secondsBefore(600), acknowledgedAt: secondsBefore(300) })],
    rules: [ruleRow()],
    sample: freshMatching,
    catalog: twoStepCatalog(),
  });
  await runLifecycleSweep(acknowledged.deps, NOW);
  assert(
    acknowledged.recorded.dispatches.length === 0,
    "acknowledgement stops the clock — no step is dispatched",
  );

  const clearedNow = fakeDeps({
    alarms: [alarmRow({ raisedAt: secondsBefore(600), normalSince: secondsBefore(120) })],
    rules: [ruleRow()],
    sample: freshNonMatching,
    catalog: twoStepCatalog(),
    sentChannelIds: [C1.id],
  });
  await runLifecycleSweep(clearedNow.deps, NOW);
  assert(
    clearedNow.recorded.dispatches.length === 1 &&
      clearedNow.recorded.dispatches[0]?.input.event?.kind === "cleared",
    `an alarm cleared this tick sends its cleared message and no step, got ${JSON.stringify(
      clearedNow.recorded.dispatches.map((d) => d.input.event),
    )}`,
  );
}

/** 6. No mapping for `(organization, severity)`: nothing. A rule with no organization: one warn, nothing. */
async function testUnmappedSeverityAndOrganizationlessRule(): Promise<void> {
  const unmapped = fakeDeps({
    alarms: [alarmRow({ raisedAt: secondsBefore(600), severity: "critical" })],
    rules: [ruleRow()],
    sample: freshMatching,
    catalog: twoStepCatalog(ORG_A, "warning"),
  });
  await runLifecycleSweep(unmapped.deps, NOW);
  assert(unmapped.recorded.dispatches.length === 0, "an unmapped severity escalates nowhere");
  assert(unmapped.recorded.warnings.length === 0, "and that is not a warning — decision 8");

  const orgless = fakeDeps({
    alarms: [alarmRow({ raisedAt: secondsBefore(61) })],
    rules: [ruleRow({ organizationId: null })],
    sample: freshMatching,
    catalog: twoStepCatalog(),
  });
  await runLifecycleSweep(orgless.deps, NOW);
  assert(orgless.recorded.dispatches.length === 0, "a rule with no organization dispatches nothing");
  // `F3.51` widened this count from one to two, and it is the only assertion
  // in this file the third phase changed. Two phases now refuse this alarm for
  // the same reason and each says so once: the raise retry cannot re-offer it
  // and the escalation cannot step it. Both lines are §9.6-shaped, so the
  // assertion is over every line rather than over the first.
  assert(
    orgless.recorded.warnings.length === 2 &&
      orgless.recorded.warnings.every(
        (line) => line.includes("rule-1") && line.includes("alarm-1"),
      ),
    `one warn per refusing phase, each naming the rule and the alarm ids, got ${JSON.stringify(
      orgless.recorded.warnings,
    )}`,
  );
  assert(
    orgless.recorded.warnings.every((line) => !line.includes("Feeder overload")),
    "§9.6: the warns carry no alarm text",
  );

  // The clear itself is the ALARM's fact and still happens; only the message
  // is skipped, with the same warn.
  const orglessClear = fakeDeps({
    alarms: [alarmRow({ normalSince: secondsBefore(120) })],
    rules: [ruleRow({ organizationId: null })],
    sample: freshNonMatching,
    sentChannelIds: [C1.id],
  });
  await runLifecycleSweep(orglessClear.deps, NOW);
  assert(
    orglessClear.recorded.writes[0]?.updates[0]?.clearedAt === NOW,
    "the alarm still clears under its own organization",
  );
  assert(orglessClear.recorded.broadcasts.length === 1, "and is still broadcast");
  assert(orglessClear.recorded.dispatches.length === 0, "but nobody is told");
  assert(orglessClear.recorded.warnings.length === 1, "one warn for the skipped message");
}

/** 7. One organization's write throws: warned, and the other organization is still written. */
async function testOneOrganizationFailingDoesNotStopTheOther(): Promise<void> {
  const written: string[] = [];
  const { deps, recorded } = fakeDeps({
    alarms: [
      alarmRow({ id: "alarm-a", organizationId: ORG_A, assetId: "asset-a", ruleId: "rule-a" }),
      alarmRow({ id: "alarm-b", organizationId: ORG_B, assetId: "asset-b", ruleId: "rule-b" }),
    ],
    rules: [
      ruleRow({ id: "rule-a", code: "RULE-A", organizationId: ORG_A, assetId: "asset-a" }),
      ruleRow({ id: "rule-b", code: "RULE-B", organizationId: ORG_B, assetId: "asset-b" }),
    ],
    sample: freshNonMatching,
    writeAlarmState: (organizationId) => {
      if (organizationId === ORG_A) {
        return Promise.reject(new Error("tenant write refused"));
      }
      written.push(organizationId);
      return Promise.resolve([]);
    },
  });
  await runLifecycleSweep(deps, NOW);

  assert(
    recorded.warnings.length === 1 &&
      recorded.warnings[0]?.includes(ORG_A) === true &&
      recorded.warnings[0].includes("tenant write refused"),
    `one warn naming the organization and the cause, got ${JSON.stringify(recorded.warnings)}`,
  );
  assert(
    written.join(",") === ORG_B,
    `the second organization is still written, got [${written.join(",")}]`,
  );
}

/** 8. Two bands on one asset (ADR 0033 decision 4): one non-matching sample clears both. */
async function testTwoBandsClearOnOneSample(): Promise<void> {
  const since = secondsBefore(120);
  const { deps, recorded } = fakeDeps({
    alarms: [
      alarmRow({ id: "alarm-warn", ruleId: "rule-warn", severity: "warning", normalSince: since }),
      alarmRow({ id: "alarm-crit", ruleId: "rule-crit", severity: "critical", normalSince: since }),
    ],
    rules: [
      ruleRow({ id: "rule-warn", code: "RULE-WARN", thresholdValue: 100 }),
      ruleRow({ id: "rule-crit", code: "RULE-CRIT", thresholdValue: 200, severity: "critical" }),
    ],
    sample: { time: secondsBefore(5), value: 50, unit: "kW" },
  });
  await runLifecycleSweep(deps, NOW);

  assert(recorded.writes.length === 1, `one write for the one organization, got ${recorded.writes.length}`);
  const ids = recorded.writes[0]?.updates.map((u) => u.alarmId).sort().join(",");
  assert(ids === "alarm-crit,alarm-warn", `both alarms in the one write, got ${ids}`);
  assert(
    recorded.writes[0]?.updates.every((u) => u.clearedAt === NOW) === true,
    "both are cleared at now",
  );
  assert(recorded.broadcasts.length === 2, `two broadcasts, got ${recorded.broadcasts.length}`);
}

/** Plan D4: a rule that has lost its asset, point, operator or threshold is skipped with no change; so is a rule the alarm cannot find. */
async function testIncompleteOrMissingRuleIsSkipped(): Promise<void> {
  const incomplete = fakeDeps({
    alarms: [alarmRow({ normalSince: secondsBefore(600) })],
    rules: [ruleRow({ operator: null })],
    sample: freshNonMatching,
  });
  await runLifecycleSweep(incomplete.deps, NOW);
  assert(incomplete.recorded.writes.length === 0, "no operator: no write");

  const unknownOperator = fakeDeps({
    alarms: [alarmRow({ normalSince: secondsBefore(600) })],
    rules: [ruleRow({ operator: "between" })],
    sample: freshNonMatching,
  });
  await runLifecycleSweep(unknownOperator.deps, NOW);
  assert(unknownOperator.recorded.writes.length === 0, "an operator outside the vocabulary: no write");

  const missing = fakeDeps({
    alarms: [alarmRow({ ruleId: "rule-gone", normalSince: secondsBefore(600) })],
    rules: [ruleRow()],
    sample: freshNonMatching,
  });
  await runLifecycleSweep(missing.deps, NOW);
  assert(missing.recorded.writes.length === 0, "a rule the sweep cannot find: no write");
  assert(missing.recorded.dispatches.length === 0, "and no escalation");
}

/** Plan D4 / review 1: the clear phase compares threshold rules only — a `time_window` rule with a fresh sample writes nothing. */
async function testNonThresholdRuleNeverClears(): Promise<void> {
  // Deliberately COMPLETE in the threshold shape (asset, point, operator,
  // threshold), so only the `ruleType` gate stands between the rule and a
  // `compare`. The sample loader happens to skip non-threshold rules today;
  // the sweep must not depend on that.
  const { deps, recorded } = fakeDeps({
    alarms: [alarmRow({ normalSince: secondsBefore(600) })],
    rules: [ruleRow({ ruleType: "time_window", condition: { days: ["mon"], startTime: "08:00", endTime: "17:00" } })],
    sample: freshNonMatching,
  });
  await runLifecycleSweep(deps, NOW);

  assert(recorded.writes.length === 0, `a time_window rule writes nothing, got ${JSON.stringify(recorded.writes)}`);
  assert(recorded.dispatches.length === 0, "and dispatches nothing");
  assert(recorded.broadcasts.length === 0, "and broadcasts nothing");
}

/** Security M1: one alarm's step failing is warned and the next alarm's step is still dispatched. */
async function testOneStepFailingDoesNotStopTheNextAlarm(): Promise<void> {
  // Two alarms on two severities, each mapped to its own one-step profile, so
  // the two steps load different channel lists: the first read rejects, the
  // second must still be dispatched.
  const catalog: EscalationCatalog = {
    defaults: new Map([
      [escalationKey(ORG_A, "warning"), [{ stepNo: 1, afterMinutes: 1, channelIds: [C1.id] }]],
      [escalationKey(ORG_A, "critical"), [{ stepNo: 1, afterMinutes: 1, channelIds: [C2.id] }]],
    ]),
  };
  const { deps, recorded } = fakeDeps({
    alarms: [
      alarmRow({ id: "alarm-a", ruleId: "rule-a", severity: "warning", raisedAt: secondsBefore(61) }),
      alarmRow({ id: "alarm-b", ruleId: "rule-b", severity: "critical", raisedAt: secondsBefore(61) }),
    ],
    rules: [
      ruleRow({ id: "rule-a", code: "RULE-A" }),
      ruleRow({ id: "rule-b", code: "RULE-B", severity: "critical" }),
    ],
    sample: freshMatching,
    catalog,
    loadChannels: (ids) =>
      ids.includes(C1.id)
        ? Promise.reject(new Error("channel read refused"))
        : Promise.resolve([C2]),
  });
  await runLifecycleSweep(deps, NOW);

  assert(
    recorded.dispatches.length === 1 &&
      recorded.dispatches[0]?.input.alarmId === "alarm-b" &&
      recorded.dispatches[0].channels[0]?.id === C2.id,
    `the second alarm's step is still dispatched, got ${JSON.stringify(
      recorded.dispatches.map((d) => d.input.alarmId),
    )}`,
  );
  assert(recorded.warnings.length === 1, `one warn, got ${JSON.stringify(recorded.warnings)}`);
  const warning = recorded.warnings[0] ?? "";
  assert(
    warning.includes("alarm-a") && warning.includes("RULE-A") && warning.includes("step 1"),
    `the warn names the alarm id, the rule code and the step, got "${warning}"`,
  );
  assert(warning.includes("channel read refused"), "and carries the cause");
  assert(!warning.includes("Feeder overload"), "§9.6: the warn carries no alarm text");
}

/** The loop hands the tick's own `now()` to the sweep as a `Date`, and sweeps before it sleeps. */
async function testLoopPassesTheTicksNowToTheSweep(): Promise<void> {
  const tick = 1_788_700_000_000;
  const controller = new AbortController();
  const events: string[] = [];
  const { deps, recorded } = fakeDeps({
    alarms: [alarmRow()],
    rules: [ruleRow()],
    sample: { time: new Date(tick - 5_000), value: 50, unit: "kW" },
  });
  const loopDeps: AlarmLifecycleLoopDeps = {
    ...deps,
    loadActiveAlarms: () => {
      events.push("sweep");
      return deps.loadActiveAlarms();
    },
    sleep: () => {
      events.push("sleep");
      controller.abort();
      return Promise.resolve();
    },
    now: () => tick,
    baseTickMs: 1,
  };
  await runLifecycleLoop(loopDeps, controller.signal);

  assert(events.join(",") === "sweep,sleep", `sweep before sleep, got ${events.join(",")}`);
  assert(
    recorded.writes[0]?.updates[0]?.normalSince?.getTime() === tick,
    `the sweep saw new Date(now()), got ${String(recorded.writes[0]?.updates[0]?.normalSince)}`,
  );
}

export async function runAlarmLifecycleServiceTests(): Promise<void> {
  await testFirstNonMatchingSampleStartsTheHold();
  await testHoldElapsedClearsBroadcastsAndNotifiesSentChannels();
  await testStaleSampleChangesNothing();
  await testDueStepIsDispatchedToItsChannels();
  await testADueStepIsReofferedOnEveryTick();
  await testAcknowledgedOrJustClearedAlarmsDoNotEscalate();
  await testUnmappedSeverityAndOrganizationlessRule();
  await testOneOrganizationFailingDoesNotStopTheOther();
  await testTwoBandsClearOnOneSample();
  await testIncompleteOrMissingRuleIsSkipped();
  await testNonThresholdRuleNeverClears();
  await testOneStepFailingDoesNotStopTheNextAlarm();
  await testLoopPassesTheTicksNowToTheSweep();
}

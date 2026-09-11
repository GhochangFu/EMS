import { randomUUID } from "node:crypto";

import { and, eq, is, isNull, TransactionRollbackError } from "drizzle-orm";

import {
  alarmEscalationDefaults,
  alarmEscalationProfiles,
  alarmEscalationStepChannels,
  alarmEscalationSteps,
  alarmSeverities,
  alarms,
  automationRules,
  notificationChannels,
  notificationDeliveries,
  pointValues,
} from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import { ChannelsService } from "../notifications/channels.service";
import { ClosedCeilings } from "../notifications/closed-ceilings";
import type {
  DeliveryResult,
  NotificationMessage,
  NotificationTransport,
} from "../notifications/notification-transport";
import { buildConfig } from "../notifications/notifications.config";
import type { DispatchInput } from "../notifications/notifications.service";
import { NotificationsService } from "../notifications/notifications.service";
import { createFixtureAssets, fixtureLocation } from "../testing/integration-fixtures";
import { AlarmLifecycleService } from "./alarm-lifecycle.service";
import { type AlarmRaiseRule, AlarmRaiser } from "./alarm-raise.service";
import type { AlarmsGateway } from "./alarms.gateway";
import { AlarmsService } from "./alarms.service";

/**
 * `F3.10` U7 — the lifecycle sweep against a real database (ADR 0057
 * decisions 2, 5, 6, 9, 10).
 *
 * The unit spec proves the decisions over fakes; this proves what the fakes
 * cannot see — the alarm selection's `WHERE`, the `cleared_at IS NULL` guard
 * on the update, the escalation join, `batchedLatestPointValues` picking the
 * latest sample, `alarms_open_per_rule_uidx` under its `0066` predicate, and
 * the ledger reads inside `dispatchToChannels` and `sentChannelIdsForAlarm`.
 * `now` is injected into every sweep, so no scenario waits out a hold.
 *
 * Every scenario runs inside one transaction ended with `tx.rollback()`
 * (`alarm-raise.integration.spec.ts`'s isolation): the sweep's tenant writes
 * and the notification ledger both go through the same handle, so the
 * services see their own rows and the database is untouched afterwards —
 * `alarms_rule_id_fk` (`NO ACTION`) and `notification_deliveries.alarm_id`
 * would otherwise dictate a delete order by hand.
 *
 * The fixture severity is its own code, inserted here: the sweep reads every
 * active alarm in the database, and a profile mapped for a seeded severity
 * would escalate every seeded alarm of that severity into this transaction.
 * A code no seeded alarm carries keeps the escalation phase's rows to the
 * fixture's own.
 *
 * Every service is constructed with `new` (§4.6: no Nest module here). The
 * transport is the storm-control fake, so every send is a `sent` row and a
 * captured message.
 *
 * **`F3.51` exports the harness and the fixture helpers.**
 * `alarm-lifecycle-raise-retry.integration.spec.ts` drives them for the sweep's
 * third phase: with its three scenarios inline this file reached 978 of
 * AGENTS.md §4.5's 1000-line cap, and the isolation, the severity code and the
 * transaction shape are worth sharing rather than re-inventing. `buildHarness`
 * gained two options for it — a transport that can refuse, and a rate ceiling —
 * and both default to exactly what the three scenarios below always built.
 */

/** No seeded alarm carries this code, so only the fixture's alarms escalate. */
export const SEVERITY = "f310_lifecycle";

const ACTOR: Pick<JwtPayload, "sub" | "email"> = {
  sub: "00000000-0000-4000-8000-00000000f310",
  email: "f3.10-lifecycle@bms.local",
};

export function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

export async function withRollback(
  db: BmsDb,
  run: Parameters<BmsDb["transaction"]>[0],
): Promise<void> {
  await db.transaction(run).catch((err: unknown) => {
    // `is()`, not `instanceof` — see `alarm-raise.integration.spec.ts`.
    if (!is(err, TransactionRollbackError)) {
      throw err;
    }
  });
}

export function secondsAfter(seconds: number, from: Date): Date {
  return new Date(from.getTime() + seconds * 1000);
}

type Deps = ConstructorParameters<typeof NotificationsService>;

export type Harness = {
  lifecycle: AlarmLifecycleService;
  raiser: AlarmRaiser;
  alarmsService: AlarmsService;
  /** `F3.51`: the raise path's own entry point, for planting an alarm's ORIGINAL raise. */
  notifications: NotificationsService;
  /** Every message the fake transport was handed, in order — including one it then refused. */
  sent: NotificationMessage[];
  /** Every alarm id `broadcastCleared` was called with, in order. */
  clearedBroadcasts: string[];
};

/**
 * `F3.51`'s two knobs. Both default to today's behaviour, so the three
 * scenarios written for `F3.10` build the same harness they always did.
 */
export type HarnessOptions = {
  /**
   * `false` makes the transport THROW for that message, which
   * `dispatchToChannel` step 3 records as `failed` — the undelivered raise this
   * item exists to retry. The message is still pushed to `sent`, so the array
   * keeps meaning "handed to the transport".
   */
  sendSucceeds?: (message: NotificationMessage) => boolean;
  /**
   * `isOverHourlyLimit` is `count >= ratePerHour`, so **0 refuses every
   * dispatch on this harness, on an empty ledger, for ever**.
   *
   * It is set on the config object rather than through
   * `buildConfig({ NOTIFY_RATE_LIMIT_PER_HOUR: "0" })`, and that is a
   * correction to this item's plan: `buildConfig` keeps only a rate `> 0` and
   * falls back to the 60/hour default at 0, so the plan's spelling would have
   * built a harness that refuses nothing and an I2 that proves nothing.
   */
  ratePerHour?: number;
};

/** The services, all over the one transaction handle, with a recording gateway and transport. */
export function buildHarness(db: BmsDb, options: HarnessOptions = {}): Harness {
  const sent: NotificationMessage[] = [];
  const transport: NotificationTransport = {
    kind: "webhook",
    send: (message): Promise<DeliveryResult> => {
      sent.push(message);
      if (options.sendSucceeds && !options.sendSucceeds(message)) {
        return Promise.reject(new Error("F3.51 fixture transport refused"));
      }
      return Promise.resolve({ status: "sent", error: null });
    },
  };
  const channels = new ChannelsService(
    db,
    db,
    { decrypt: () => ({}) } as unknown as ConstructorParameters<typeof ChannelsService>[2],
    {} as unknown as ConstructorParameters<typeof ChannelsService>[3],
  );
  const notifications = new NotificationsService(
    db,
    channels,
    transport as unknown as Deps[2],
    transport as unknown as Deps[3],
    transport as unknown as Deps[4],
    // The ceiling is not what this asserts; the seeded database is busy
    // enough that the default could turn a step into `skipped_rate_limited`.
    {
      ...buildConfig({ NOTIFY_RATE_LIMIT_PER_HOUR: "1000" }),
      ...(options.ratePerHour === undefined ? {} : { ratePerHour: options.ratePerHour }),
    },
  );
  const clearedBroadcasts: string[] = [];
  const gateway = {
    broadcastAcknowledged: () => undefined,
    broadcastCleared: (alarm: { id: string }) => {
      clearedBroadcasts.push(alarm.id);
    },
  } as unknown as AlarmsGateway;

  return {
    lifecycle: new AlarmLifecycleService(db, db, notifications, channels, gateway),
    raiser: new AlarmRaiser(db),
    alarmsService: new AlarmsService(db, db, gateway),
    notifications,
    sent,
    clearedBroadcasts,
  };
}

export async function insertFixtureSeverity(db: BmsDb): Promise<void> {
  await db
    .insert(alarmSeverities)
    .values({ code: SEVERITY, label: "F3.10 lifecycle", tone: "warning", rank: 27 })
    .onConflictDoNothing();
}

export async function insertFixtureRule(
  db: BmsDb,
  args: {
    assetId: string;
    organizationId: string;
    pointKey: string;
    thresholdValue: number;
    clearHoldSeconds: number | null;
    /**
     * `F3.51`: the stored `action`. The column defaults to `{}`, which
     * `asAction` narrows to `trace_only`, so a fixture rule notifies NOBODY
     * unless this is set — and the raise-retry phase consults `shouldNotify`.
     * Left unset for the three `F3.10` scenarios, whose phases do not read it
     * (ruling Q8), so their fixture is byte-identical to what it was.
     */
    action?: Record<string, unknown>;
  },
): Promise<AlarmRaiseRule> {
  const code = `F310_${randomUUID().slice(0, 8)}`;
  const name = `F3.10 lifecycle fixture ${code}`;
  const [row] = await db
    .insert(automationRules)
    .values({
      code,
      name,
      category: "safety",
      ruleType: "threshold",
      organizationId: args.organizationId,
      assetId: args.assetId,
      pointKey: args.pointKey,
      operator: "gt",
      thresholdValue: args.thresholdValue,
      severity: SEVERITY,
      clearHoldSeconds: args.clearHoldSeconds,
      ...(args.action === undefined ? {} : { action: args.action }),
    })
    .returning({ id: automationRules.id });
  if (!row) {
    throw new Error("the fixture rule was not inserted");
  }
  return {
    id: row.id,
    code,
    name,
    severity: SEVERITY,
    organizationId: args.organizationId,
    pointKey: args.pointKey,
    alarmMessage: null,
    unit: "kW",
  };
}

async function insertSample(
  db: BmsDb,
  assetId: string,
  pointKey: string,
  value: number,
  time: Date,
): Promise<void> {
  await db.insert(pointValues).values({ time, assetId, pointKey, value, unit: "kW" });
}

/**
 * Raises through `AlarmRaiser` and reads `raised_at` back: the database
 * stamps it with its own `now()`, and every step offset is measured from it,
 * so the scenarios take their `t0` from the row rather than from this
 * process's clock.
 */
async function raise(
  db: BmsDb,
  harness: Harness,
  assetId: string,
  organizationId: string,
  rule: AlarmRaiseRule,
  value: number,
): Promise<{ id: string; raisedAt: Date }> {
  const result = await harness.raiser.raise(assetId, organizationId, rule, value);
  assert(result.raised && result.alarmId !== null, `the raise for ${rule.code} must succeed`);
  const alarmId = result.alarmId as string;
  const [row] = await stateOf(db, alarmId);
  assert(row !== undefined, "the raised alarm is readable");
  return { id: alarmId, raisedAt: (row as AlarmState).raisedAt };
}

export type AlarmState = {
  raisedAt: Date;
  acknowledgedAt: Date | null;
  clearedAt: Date | null;
  normalSince: Date | null;
};

export async function stateOf(db: BmsDb, alarmId: string): Promise<AlarmState[]> {
  return db
    .select({
      raisedAt: alarms.raisedAt,
      acknowledgedAt: alarms.acknowledgedAt,
      clearedAt: alarms.clearedAt,
      normalSince: alarms.normalSince,
    })
    .from(alarms)
    .where(eq(alarms.id, alarmId));
}

async function expectState(
  db: BmsDb,
  alarmId: string,
  expected: { normalSince: Date | null; clearedAt: Date | null },
  label: string,
): Promise<void> {
  const [row] = await stateOf(db, alarmId);
  assert(row !== undefined, `${label}: the alarm row exists`);
  const state = row as AlarmState;
  assert(
    sameInstant(state.normalSince, expected.normalSince),
    `${label}: normal_since should be ${String(expected.normalSince?.toISOString() ?? null)}, got ${String(
      state.normalSince?.toISOString() ?? null,
    )}`,
  );
  assert(
    sameInstant(state.clearedAt, expected.clearedAt),
    `${label}: cleared_at should be ${String(expected.clearedAt?.toISOString() ?? null)}, got ${String(
      state.clearedAt?.toISOString() ?? null,
    )}`,
  );
}

function sameInstant(a: Date | null, b: Date | null): boolean {
  if (a === null || b === null) return a === b;
  return a.getTime() === b.getTime();
}

/** Rows on one channel under one dedupe key, with their statuses. */
export async function deliveriesByKey(
  db: BmsDb,
  channelId: string,
  dedupeKey: string,
): Promise<string[]> {
  const rows = await db
    .select({ status: notificationDeliveries.status })
    .from(notificationDeliveries)
    .where(
      and(eq(notificationDeliveries.channelId, channelId), eq(notificationDeliveries.dedupeKey, dedupeKey)),
    );
  return rows.map((row) => row.status);
}

async function activeAlarmCount(db: BmsDb, assetId: string, ruleId: string): Promise<number> {
  const rows = await db
    .select({ id: alarms.id })
    .from(alarms)
    .where(and(eq(alarms.assetId, assetId), eq(alarms.ruleId, ruleId), isNull(alarms.clearedAt)));
  return rows.length;
}

/**
 * Decisions 2, 3 and 5 end to end: a stale sample never clears; a matching
 * one leaves an unstamped alarm alone; the first fresh non-matching sample
 * stamps `normal_since`; the hold is respected to the second and a matching
 * sample inside it resets the stamp; at the hold the alarm clears, is
 * broadcast once, and tells nobody (no `sent` row exists for it); and the
 * same condition then opens a NEW alarm — `alarms_open_per_rule_uidx` under
 * its `0066` predicate.
 */
export async function assertClearsAfterTheHoldAndReopens(db: BmsDb): Promise<void> {
  await withRollback(db, async (tx) => {
    await insertFixtureSeverity(tx);
    const loc = await fixtureLocation(tx);
    const [assetId] = await createFixtureAssets(tx, 1, "F310", loc);
    const pointKey = `f310_lifecycle_${randomUUID().slice(0, 8)}`;
    const rule = await insertFixtureRule(tx, {
      assetId,
      organizationId: loc.organizationId,
      pointKey,
      thresholdValue: 100,
      clearHoldSeconds: 30,
    });
    const harness = buildHarness(tx);

    const alarm = await raise(tx, harness, assetId, loc.organizationId, rule, 150);
    const t0 = alarm.raisedAt;

    // A 20-minute-old non-matching sample and nothing fresher: stale, no change.
    await insertSample(tx, assetId, pointKey, 50, secondsAfter(-20 * 60, t0));
    await harness.lifecycle.sweep(t0);
    await expectState(tx, alarm.id, { normalSince: null, clearedAt: null }, "stale sample");

    // A fresh matching sample with no stamp: nothing to write.
    await insertSample(tx, assetId, pointKey, 150, t0);
    await harness.lifecycle.sweep(t0);
    await expectState(tx, alarm.id, { normalSince: null, clearedAt: null }, "fresh matching sample");

    // The first fresh non-matching sample stamps the hold at the tick's now.
    const t1 = secondsAfter(10, t0);
    await insertSample(tx, assetId, pointKey, 50, t1);
    await harness.lifecycle.sweep(t1);
    await expectState(tx, alarm.id, { normalSince: t1, clearedAt: null }, "hold started");

    // 29 s into a 30 s hold: no write at all.
    await harness.lifecycle.sweep(secondsAfter(29, t1));
    await expectState(tx, alarm.id, { normalSince: t1, clearedAt: null }, "hold running");

    // A matching sample inside the hold resets the stamp — even at the
    // boundary tick, the latest sample decides.
    await insertSample(tx, assetId, pointKey, 150, secondsAfter(20, t1));
    await harness.lifecycle.sweep(secondsAfter(30, t1));
    await expectState(tx, alarm.id, { normalSince: null, clearedAt: null }, "hold reset by a match");

    // Back to normal: the hold restarts, and at 30 s the alarm clears.
    const t2 = secondsAfter(40, t1);
    await insertSample(tx, assetId, pointKey, 50, t2);
    await harness.lifecycle.sweep(t2);
    await expectState(tx, alarm.id, { normalSince: t2, clearedAt: null }, "hold restarted");
    await harness.lifecycle.sweep(secondsAfter(29, t2));
    await expectState(tx, alarm.id, { normalSince: t2, clearedAt: null }, "hold running again");
    const t3 = secondsAfter(30, t2);
    await harness.lifecycle.sweep(t3);
    await expectState(tx, alarm.id, { normalSince: t2, clearedAt: t3 }, "cleared at the hold");

    assert(
      harness.clearedBroadcasts.join(",") === alarm.id,
      `broadcastCleared once, after the commit, for the cleared alarm; got [${harness.clearedBroadcasts.join(",")}]`,
    );
    assert(
      harness.sent.length === 0,
      `no channel holds a sent row for this alarm, so nobody is told (ruling Q5); got ${harness.sent.length} sends`,
    );

    // A later tick does not re-clear or re-broadcast: the alarm has left the selection.
    await harness.lifecycle.sweep(secondsAfter(60, t3));
    await expectState(tx, alarm.id, { normalSince: t2, clearedAt: t3 }, "a cleared alarm is left alone");
    assert(harness.clearedBroadcasts.length === 1, "and is not broadcast again");

    // Decision 2: the same condition now opens a NEW alarm.
    const reopened = await harness.raiser.raise(assetId, loc.organizationId, rule, 150);
    assert(
      reopened.raised && reopened.alarmId !== null && reopened.alarmId !== alarm.id,
      "once cleared, the same (asset, rule) raises a new row — the 0066 index predicate",
    );
    assert(
      (await activeAlarmCount(tx, assetId, rule.id)) === 1,
      "exactly one active alarm per (asset, rule)",
    );

    tx.rollback();
  });
}

/**
 * Decisions 6, 9 and 10 with ruling Q5 and PR 1's review item (b): step 1 is
 * sent once and answered from the ledger on the next tick; acknowledgement
 * stops the clock, so step 2 never goes; the cleared message reaches the
 * channel that holds a `sent` row for the alarm and NOT the channel that
 * holds only a `skipped_unconfigured` row — deleting the `status = 'sent'`
 * predicate in `sentChannelIdsForAlarm` reddens the last assertion.
 */
export async function assertEscalatesOnceAndTellsSentChannelsOnly(db: BmsDb): Promise<void> {
  await withRollback(db, async (tx) => {
    await insertFixtureSeverity(tx);
    const loc = await fixtureLocation(tx);
    const [assetId] = await createFixtureAssets(tx, 1, "F310", loc);
    const pointKey = `f310_escalation_${randomUUID().slice(0, 8)}`;
    const rule = await insertFixtureRule(tx, {
      assetId,
      organizationId: loc.organizationId,
      pointKey,
      thresholdValue: 100,
      clearHoldSeconds: 30,
    });

    const suffix = randomUUID().slice(0, 8);
    const [c1, c2] = await tx
      .insert(notificationChannels)
      .values([
        {
          organizationId: loc.organizationId,
          code: `f310-c1-${suffix}`,
          name: "F3.10 step channel",
          kind: "webhook",
          config: { url: "https://hooks.example.com/f310" },
        },
        {
          organizationId: loc.organizationId,
          code: `f310-c2-${suffix}`,
          name: "F3.10 bystander channel",
          kind: "webhook",
          config: { url: "https://hooks.example.com/f310" },
        },
      ])
      .returning({ id: notificationChannels.id });
    assert(c1 !== undefined && c2 !== undefined, "two fixture channels");
    const [profile] = await tx
      .insert(alarmEscalationProfiles)
      .values({ organizationId: loc.organizationId, code: `f310-p1-${suffix}`, name: "F3.10 profile" })
      .returning({ id: alarmEscalationProfiles.id });
    assert(profile !== undefined, "the fixture profile");
    const steps = await tx
      .insert(alarmEscalationSteps)
      .values([
        { profileId: profile.id, stepNo: 1, afterMinutes: 1 },
        { profileId: profile.id, stepNo: 2, afterMinutes: 5 },
      ])
      .returning({ id: alarmEscalationSteps.id, stepNo: alarmEscalationSteps.stepNo });
    await tx
      .insert(alarmEscalationStepChannels)
      .values(steps.map((step) => ({ stepId: step.id, channelId: c1.id })));
    await tx
      .insert(alarmEscalationDefaults)
      .values({ organizationId: loc.organizationId, severity: SEVERITY, profileId: profile.id });

    const harness = buildHarness(tx);
    const alarm = await raise(tx, harness, assetId, loc.organizationId, rule, 150);
    const t0 = alarm.raisedAt;
    await insertSample(tx, assetId, pointKey, 150, t0);

    // The raise's own deliveries, as the raise path would have left them:
    // `sent` on c1, and on c2 only a refusal (an unconfigured transport).
    const raiseKey = `${rule.id}:${alarm.id}:${SEVERITY}`;
    await tx.insert(notificationDeliveries).values([
      {
        organizationId: loc.organizationId,
        ruleId: rule.id,
        alarmId: alarm.id,
        channelId: c1.id,
        status: "sent",
        dedupeKey: raiseKey,
      },
      {
        organizationId: loc.organizationId,
        ruleId: rule.id,
        alarmId: alarm.id,
        channelId: c2.id,
        status: "skipped_unconfigured",
        dedupeKey: raiseKey,
      },
    ]);

    // Step 1 at 1 min: due at +61 s, sent once, keyed and attributed.
    const stepOneKey = `${raiseKey}:escalation:1`;
    await harness.lifecycle.sweep(secondsAfter(61, t0));
    assert(
      (await deliveriesByKey(tx, c1.id, stepOneKey)).join(",") === "sent",
      `one sent row keyed ...:escalation:1 on the step channel, got [${(
        await deliveriesByKey(tx, c1.id, stepOneKey)
      ).join(",")}]`,
    );
    assert(harness.sent.length === 1, `the transport was handed step 1 once, got ${harness.sent.length}`);
    assert(
      harness.sent[0]?.subject === `escalation 1 · ${SEVERITY}: ${rule.code}` &&
        harness.sent[0].body.endsWith("unacknowledged for 1 min (escalation step 1)") &&
        harness.sent[0].alarmId === alarm.id,
      `D14 subject and body, attributed to the alarm; got ${JSON.stringify({
        subject: harness.sent[0]?.subject,
        body: harness.sent[0]?.body,
      })}`,
    );
    assert(
      (await deliveriesByKey(tx, c2.id, stepOneKey)).length === 0,
      "the bystander channel is not on the step",
    );

    // The next tick: answered from the ledger, no new row, no send.
    await harness.lifecycle.sweep(secondsAfter(90, t0));
    assert(
      (await deliveriesByKey(tx, c1.id, stepOneKey)).length === 1,
      "a second tick adds no row under step 1's key (decision 10)",
    );
    assert(harness.sent.length === 1, "and reaches the transport no second time");

    // Acknowledgement stops the clock: step 2 at 5 min never goes.
    await harness.alarmsService.acknowledge(alarm.id, ACTOR, "F3.10 integration acknowledgement");
    await harness.lifecycle.sweep(secondsAfter(301, t0));
    assert(
      (await deliveriesByKey(tx, c1.id, `${raiseKey}:escalation:2`)).length === 0,
      "an acknowledged alarm is not escalated (ruling Q4)",
    );
    assert(harness.sent.length === 1, "nothing else reached the transport");
    await expectState(tx, alarm.id, { normalSince: null, clearedAt: null }, "acknowledged, still active");

    // Then it clears: the cleared message goes to c1 (holds `sent` rows) and
    // not to c2 (holds only the refusal) — ruling Q5, review item (b).
    const t3 = secondsAfter(400, t0);
    await insertSample(tx, assetId, pointKey, 50, t3);
    await harness.lifecycle.sweep(t3);
    await expectState(tx, alarm.id, { normalSince: t3, clearedAt: null }, "hold started");
    const t4 = secondsAfter(30, t3);
    await harness.lifecycle.sweep(t4);
    await expectState(tx, alarm.id, { normalSince: t3, clearedAt: t4 }, "cleared");

    const clearedKey = `${raiseKey}:cleared`;
    assert(
      (await deliveriesByKey(tx, c1.id, clearedKey)).join(",") === "sent",
      `one sent row keyed ...:cleared on the channel that holds the alarm's sent rows, got [${(
        await deliveriesByKey(tx, c1.id, clearedKey)
      ).join(",")}]`,
    );
    assert(
      (await deliveriesByKey(tx, c2.id, clearedKey)).length === 0,
      "the channel holding only a skipped_unconfigured row for the alarm gets NO cleared message — " +
        "sentChannelIdsForAlarm's status = 'sent' predicate",
    );
    assert(
      harness.sent.length === 2 && harness.sent[1]?.subject === `cleared · ${SEVERITY}: ${rule.code}`,
      `the cleared message reached the transport once, got ${JSON.stringify(
        harness.sent.map((m) => m.subject),
      )}`,
    );
    assert(
      harness.clearedBroadcasts.join(",") === alarm.id,
      `broadcastCleared once for the alarm, got [${harness.clearedBroadcasts.join(",")}]`,
    );

    tx.rollback();
  });
}

/**
 * `F3.53` I1 — **the sweep's ceiling memo really reaches
 * `NotificationsService`, and this is the only case in the repository that can
 * say so** (ADR 0041 Amendment 7).
 *
 * `AlarmLifecycleDeps.dispatchToChannels` is typed
 * `NotificationsService["dispatchToChannels"]`, so it widened with the method —
 * but the ADAPTER that satisfies it, the arrow in
 * `AlarmLifecycleService.deps()`, is hand-written and dropped the third
 * argument. Left that way the memo is created by `runLifecycleSweep`, threaded
 * through both re-offering phases, and never delivered.
 *
 * **Nothing else catches that.** Every sweep spec — the five fake-deps suites
 * and `alarm-lifecycle-closed-ceilings.spec.ts` with them — replaces
 * `deps.dispatchToChannels` with its own function, so not one of them executes
 * the adapter. `tsc` is silent too: a two-parameter function is assignable to a
 * three-parameter type. The gate has to be the real Nest wiring against a real
 * database, which is this file.
 *
 * The wrapper patches the SERVICE INSTANCE rather than the deps, and that is
 * what makes the case honest: the adapter resolves
 * `this.notifications.dispatchToChannels` at call time, so an own property on
 * the instance is what the production line will find. It delegates to the
 * original, so the step really sends and the assertion below is paired with the
 * `sent` row that proves the dispatch happened at all.
 *
 * **Mutation:** the adapter written back to `(channels, input) => …(channels,
 * input)` → the recorded third argument is `undefined` and this reddens, while
 * the whole of `src/alarms` without a database stays green.
 */
export async function assertTheSweepHandsItsCeilingMemoToTheService(db: BmsDb): Promise<void> {
  await withRollback(db, async (tx) => {
    await insertFixtureSeverity(tx);
    const loc = await fixtureLocation(tx);
    const [assetId] = await createFixtureAssets(tx, 1, "F310", loc);
    const pointKey = `f353_memo_${randomUUID().slice(0, 8)}`;
    const rule = await insertFixtureRule(tx, {
      assetId,
      organizationId: loc.organizationId,
      pointKey,
      thresholdValue: 100,
      clearHoldSeconds: 30,
    });

    // The escalation profile fixture of the scenario above: one channel, one
    // profile, step 1 at one minute, mapped for the fixture severity so no
    // seeded alarm can escalate into this transaction.
    const suffix = randomUUID().slice(0, 8);
    const [channel] = await tx
      .insert(notificationChannels)
      .values({
        organizationId: loc.organizationId,
        code: `f353-c1-${suffix}`,
        name: "F3.53 step channel",
        kind: "webhook",
        config: { url: "https://hooks.example.com/f353" },
      })
      .returning({ id: notificationChannels.id });
    assert(channel !== undefined, "the fixture channel");
    const [profile] = await tx
      .insert(alarmEscalationProfiles)
      .values({ organizationId: loc.organizationId, code: `f353-p1-${suffix}`, name: "F3.53 profile" })
      .returning({ id: alarmEscalationProfiles.id });
    assert(profile !== undefined, "the fixture profile");
    const steps = await tx
      .insert(alarmEscalationSteps)
      .values([{ profileId: profile.id, stepNo: 1, afterMinutes: 1 }])
      .returning({ id: alarmEscalationSteps.id });
    await tx
      .insert(alarmEscalationStepChannels)
      .values(steps.map((step) => ({ stepId: step.id, channelId: channel.id })));
    await tx
      .insert(alarmEscalationDefaults)
      .values({ organizationId: loc.organizationId, severity: SEVERITY, profileId: profile.id });

    const harness = buildHarness(tx);
    const offered: { input: DispatchInput; memo: ClosedCeilings | undefined }[] = [];
    const original = harness.notifications.dispatchToChannels.bind(harness.notifications);
    harness.notifications.dispatchToChannels = (channels, input, closedCeilings) => {
      offered.push({ input, memo: closedCeilings });
      return original(channels, input, closedCeilings);
    };

    const alarm = await raise(tx, harness, assetId, loc.organizationId, rule, 150);
    const t0 = alarm.raisedAt;
    await insertSample(tx, assetId, pointKey, 150, t0);

    // Step 1 is due at +61 s. The sweep spans every tenant, so the dispatches
    // are filtered to this fixture's alarm rather than counted.
    await harness.lifecycle.sweep(secondsAfter(61, t0));

    const stepOneKey = `${rule.id}:${alarm.id}:${SEVERITY}:escalation:1`;
    assert(
      (await deliveriesByKey(tx, channel.id, stepOneKey)).join(",") === "sent",
      `I1: the step really went — one sent row under ...:escalation:1, got [${(
        await deliveriesByKey(tx, channel.id, stepOneKey)
      ).join(",")}]`,
    );
    const mine = offered.filter((call) => call.input.alarmId === alarm.id);
    assert(
      mine.length === 1,
      `I1: one dispatch for the fixture alarm reached the service, got ${mine.length}`,
    );
    assert(
      mine[0]?.memo instanceof ClosedCeilings,
      `I1: and the sweep's memo reached it through the adapter, got ${String(mine[0]?.memo)}`,
    );

    tx.rollback();
  });
}

/**
 * ADR 0033 decision 4's bands, seen from the clear side: two rules on one
 * point (warning above 100, critical above 200), both open, both cleared by
 * one reading that holds below the lower band for the hold.
 */
export async function assertTwoBandsClearOnOneSample(db: BmsDb): Promise<void> {
  await withRollback(db, async (tx) => {
    await insertFixtureSeverity(tx);
    const loc = await fixtureLocation(tx);
    const [assetId] = await createFixtureAssets(tx, 1, "F310", loc);
    const pointKey = `f310_bands_${randomUUID().slice(0, 8)}`;
    const lower = await insertFixtureRule(tx, {
      assetId,
      organizationId: loc.organizationId,
      pointKey,
      thresholdValue: 100,
      clearHoldSeconds: 30,
    });
    const upper = await insertFixtureRule(tx, {
      assetId,
      organizationId: loc.organizationId,
      pointKey,
      thresholdValue: 200,
      clearHoldSeconds: null, // the 120 s default
    });
    const harness = buildHarness(tx);

    const lowerAlarm = await raise(tx, harness, assetId, loc.organizationId, lower, 250);
    const upperAlarm = await raise(tx, harness, assetId, loc.organizationId, upper, 250);
    const t0 = upperAlarm.raisedAt;

    const t1 = secondsAfter(10, t0);
    await insertSample(tx, assetId, pointKey, 50, t1);
    await harness.lifecycle.sweep(t1);
    await expectState(tx, lowerAlarm.id, { normalSince: t1, clearedAt: null }, "lower band stamped");
    await expectState(tx, upperAlarm.id, { normalSince: t1, clearedAt: null }, "upper band stamped");

    // Each band clears on ITS rule's hold: 30 s for the lower, 120 s default for the upper.
    const t2 = secondsAfter(30, t1);
    await harness.lifecycle.sweep(t2);
    await expectState(tx, lowerAlarm.id, { normalSince: t1, clearedAt: t2 }, "lower band cleared at 30 s");
    await expectState(tx, upperAlarm.id, { normalSince: t1, clearedAt: null }, "upper band still holding");
    const t3 = secondsAfter(120, t1);
    await harness.lifecycle.sweep(t3);
    await expectState(tx, upperAlarm.id, { normalSince: t1, clearedAt: t3 }, "upper band cleared at 120 s");

    assert(
      [...harness.clearedBroadcasts].sort().join(",") === [lowerAlarm.id, upperAlarm.id].sort().join(","),
      `both alarms broadcast once each, got [${harness.clearedBroadcasts.join(",")}]`,
    );

    tx.rollback();
  });
}

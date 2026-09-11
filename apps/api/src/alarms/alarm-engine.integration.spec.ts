import { randomUUID } from "node:crypto";

import { and, eq, is, sql, TransactionRollbackError } from "drizzle-orm";

import {
  alarms,
  automationRules,
  notificationChannels,
  notificationDeliveries,
  ruleNotifications,
} from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { TelemetryReading } from "@bms/shared";

import { ChannelsService } from "../notifications/channels.service";
import type {
  DeliveryResult,
  NotificationMessage,
  NotificationTransport,
} from "../notifications/notification-transport";
import { buildConfig } from "../notifications/notifications.config";
import { NotificationsService } from "../notifications/notifications.service";
import { createFixtureAssets, fixtureLocation } from "../testing/integration-fixtures";
import { until } from "../testing/until";
import { TelemetryBroadcastHub } from "../telemetry/telemetry-broadcast.hub";
import { AlarmEngineService } from "./alarm-engine.service";
import type { AlarmRaiseResult } from "./alarm-raise.service";
import { AlarmRaiser } from "./alarm-raise.service";

/**
 * `F3.7` — the streaming path against a real database.
 *
 * The unit sibling (`alarm-engine.service.spec.ts`) holds the decision the
 * batch loop makes. What only a database can hold is the other half: the cache
 * `SELECT` this unit widened actually reads `automation_rules.action`, so a
 * stored `{ "type": "notify" }` reaches `notifyOnRaise` through the real
 * projection rather than through a hand-built row. A fake `db` would assert
 * that against itself.
 *
 * Same isolation as `alarm-raise.integration.spec.ts`: one transaction,
 * `tx.rollback()` last rather than a manual `DELETE` (`alarms_rule_id_fk` is
 * `NO ACTION`, so a test rule cannot be deleted ahead of the alarm it raised).
 * Every ledger read is filtered by the fixture's rule id, never counted
 * table-wide — `F4.71` records this family colliding with the
 * `*.rls.integration` suites under parallel load.
 */

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function withRollback(
  db: BmsDb,
  run: Parameters<BmsDb["transaction"]>[0],
): Promise<void> {
  await db.transaction(run).catch((err: unknown) => {
    // `is()`, not `instanceof`: pnpm can resolve `drizzle-orm` to more than one
    // physical copy across the workspace — see the note in
    // `alarm-raise.integration.spec.ts`, where this was caught the hard way.
    if (!is(err, TransactionRollbackError)) {
      throw err;
    }
  });
}

type NotificationsDeps = ConstructorParameters<typeof NotificationsService>;

type DeliveryRow = {
  id: string;
  status: string;
  alarmId: string | null;
  dedupeKey: string | null;
  organizationId: string;
};

/** Every ledger row for ONE rule — never a table-wide count (`F4.71`). */
async function deliveriesForRule(db: BmsDb, ruleId: string): Promise<DeliveryRow[]> {
  return db
    .select({
      id: notificationDeliveries.id,
      status: notificationDeliveries.status,
      alarmId: notificationDeliveries.alarmId,
      dedupeKey: notificationDeliveries.dedupeKey,
      organizationId: notificationDeliveries.organizationId,
    })
    .from(notificationDeliveries)
    .where(eq(notificationDeliveries.ruleId, ruleId));
}

/**
 * The real `NotificationsService` on the caller's transaction, with a
 * recording transport in all three slots.
 *
 * Stand-ins as in `rules/evaluate-enabled-rules.integration.spec.ts`: the only
 * `ChannelsService` method a dispatch reaches is `loadForRule`, a plain
 * `fleetDb` join that touches neither the crypto service nor access control,
 * so slots 2 and 3 are unused rather than a gate being bypassed. The transport
 * is fake for a stronger reason than speed — the fixture channel is a
 * `webhook`, and `WebhookTransport` would make a real request.
 */
function realNotificationsOn(db: BmsDb): {
  notifications: NotificationsService;
  sent: NotificationMessage[];
} {
  const sent: NotificationMessage[] = [];
  const transport: NotificationTransport = {
    kind: "webhook",
    send: (message): Promise<DeliveryResult> => {
      sent.push(message);
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
    transport as unknown as NotificationsDeps[2],
    transport as unknown as NotificationsDeps[3],
    transport as unknown as NotificationsDeps[4],
    // 1000/hour: the ceiling is not what this asserts, and the seeded database
    // is busy enough that the default could turn a real dispatch into a
    // `skipped_rate_limited` row and make the failure read as a missing call.
    buildConfig({ NOTIFY_RATE_LIMIT_PER_HOUR: "1000" }),
  );
  return { notifications, sent };
}

/**
 * A published threshold rule the engine's cache will load, carrying a stored
 * `action`.
 *
 * `999_999` is `insertTestRule`'s threshold from
 * `alarm-raise.integration.spec.ts` and for its reason: no real telemetry
 * sample can reach it, so the live simulator can never match this rule
 * concurrently with the test. The code carries a `randomUUID()` slice because
 * `(organization_id, code)` is unique — two workers on this file would
 * otherwise block on an uncommitted duplicate key rather than run.
 */
async function insertNotifyRule(
  db: BmsDb,
  input: { assetId: string; organizationId: string; pointKey: string },
): Promise<{ ruleId: string; code: string }> {
  const code = `F37_T3_STREAM_${randomUUID().slice(0, 8).toUpperCase()}`;
  const [row] = await db
    .insert(automationRules)
    .values({
      organizationId: input.organizationId,
      code,
      name: `F3.7 task 3 integration test — ${code}`,
      category: "safety",
      ruleType: "threshold",
      assetId: input.assetId,
      pointKey: input.pointKey,
      operator: "gte",
      thresholdValue: 999_999,
      severity: "warning",
      // The column this unit adds to the cache `SELECT`. Everything below is
      // the default the engine already read; this is the new fact.
      action: { type: "notify", target: "t" },
    })
    .returning({ id: automationRules.id });
  if (!row) {
    throw new Error(`failed to insert the fixture rule ${code}`);
  }
  return { ruleId: row.id, code };
}

/**
 * `F3.7` — one reading above the threshold opens an alarm and sends once; the
 * same reading again opens nothing and sends nothing.
 *
 * **The second emit is the owner's Q2 ruling (2026-09-06)** and is the "does
 * not fire when it should not" direction §4.6 asks for. The streaming engine
 * re-observes every open alarm on every batch — 5 batches/minute against 118
 * open rules on the dev database — so a dispatch per observation would be
 * 35,400 ledger rows an hour per channel. The engine dispatches only on
 * `raised === true`; the on-demand sweep is the asymmetric half and records
 * its refusals (`rules/evaluate-enabled-rules.integration.spec.ts`).
 */
export async function assertStreamingRaiseDispatchesOnce(db: BmsDb): Promise<void> {
  await withRollback(db, async (tx) => {
    const loc = await fixtureLocation(tx);
    const [assetId] = await createFixtureAssets(tx, 1, "F37T3", loc);
    if (!assetId) {
      throw new Error("createFixtureAssets returned no asset");
    }

    const pointKey = "f37_t3_stream_point";
    const { ruleId, code } = await insertNotifyRule(tx, {
      assetId,
      organizationId: loc.organizationId,
      pointKey,
    });

    const [channel] = await tx
      .insert(notificationChannels)
      .values({
        organizationId: loc.organizationId,
        code: `f37-t3-${randomUUID().slice(0, 18)}`,
        name: "F3.7 task 3 integration fixture",
        kind: "webhook",
        config: { url: "https://hooks.example.com/x" },
        enabled: true,
      })
      .returning({ id: notificationChannels.id });
    if (!channel) {
      throw new Error("failed to insert the fixture notification channel");
    }
    await tx.insert(ruleNotifications).values({ ruleId, channelId: channel.id });

    const { notifications, sent } = realNotificationsOn(tx);
    // The real raiser (ADR 0033's one writer of `bms.alarms`), wrapped so the
    // spec can see what it reported. The wrapper is the only way to observe
    // the second batch's refusal: nothing else changes when a raise dedupes.
    const raiser = new AlarmRaiser(tx);
    const raises: AlarmRaiseResult[] = [];
    const recording = {
      raise: async (...args: Parameters<AlarmRaiser["raise"]>): Promise<AlarmRaiseResult> => {
        const result = await raiser.raise(...args);
        raises.push(result);
        return result;
      },
    } as unknown as AlarmRaiser;

    const hub = new TelemetryBroadcastHub();
    // `tx` in the fleetDb slot: the cache `SELECT` must see the uncommitted
    // fixture rule, which only this connection can (the AlarmEnrichmentService
    // pattern). It reads every published threshold rule in the database as
    // well, and matches none of them — the fixture asset is transaction-local,
    // so no other rule can share its (assetId, pointKey).
    const engine = new AlarmEngineService(hub, tx, recording, notifications);
    engine.onModuleInit();

    const reading = (): TelemetryReading => ({
      time: new Date().toISOString(),
      assetId,
      pointKey,
      value: 1_000_000,
      unit: null,
    });

    // --- first batch: the transition ----------------------------------------
    hub.emitReadings([reading()]);

    await until(async () => (await deliveriesForRule(tx, ruleId)).length === 1, {
      timeoutMs: 15_000,
      label: "the streaming raise's delivery row",
    });

    const openAlarms = await tx
      .select({ id: alarms.id })
      .from(alarms)
      .where(and(eq(alarms.assetId, assetId), eq(alarms.ruleId, ruleId)));
    assert(
      openAlarms.length === 1,
      `the streaming batch must have opened exactly 1 alarm, found ${openAlarms.length}`,
    );
    const alarmId = openAlarms[0]?.id;

    const afterFirst = await deliveriesForRule(tx, ruleId);
    const first = afterFirst[0];
    assert(first !== undefined, "the delivery row disappeared");
    assert(
      first.status === "sent",
      `a genuine transition must be recorded as sent, got ${first.status}`,
    );
    assert(
      first.alarmId === alarmId,
      `the delivery must name the alarm that opened (${String(alarmId)}), got ${String(first.alarmId)}`,
    );
    assert(
      first.dedupeKey === `${ruleId}:${String(alarmId)}:warning`,
      `the dedupe key must be ruleId:alarmId:severity, got ${String(first.dedupeKey)}`,
    );
    assert(
      first.organizationId === loc.organizationId,
      `the delivery is filed under the rule's own organization, got ${first.organizationId}`,
    );
    const sentForRule = (): NotificationMessage[] =>
      sent.filter((message) => message.ruleId === ruleId);
    assert(
      sentForRule().length === 1,
      `the transport must have seen exactly 1 message for rule ${code}, got ${sentForRule().length}`,
    );

    // --- second batch: the same plant, already alarmed (owner ruling Q2) -----
    // Emitted only now, after the first `until` resolved: two batches in flight
    // together could both see no open alarm and both raise.
    hub.emitReadings([reading()]);

    await until(() => raises.length === 2, {
      timeoutMs: 15_000,
      label: "the second batch's raise",
    });
    assert(
      raises[1]?.raised === false,
      "the second batch must have been refused by alarms_open_per_rule_uidx — otherwise " +
        "this asserts nothing about the guard",
    );

    // A negative needs a point after which a dispatch could no longer land.
    // With `raised: false` the dispatch chain is exactly two queries deep —
    // `loadForRule`'s SELECT, then `record()`'s INSERT — and pg serialises
    // every query on this one connection in issue order. One macrotask turn
    // (the fire-and-forget call is synchronous after the raise resolves) plus
    // three sequential round trips therefore complete after both of them.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    for (let i = 0; i < 3; i += 1) {
      await tx.execute(sql`SELECT 1`);
    }

    const afterSecond = await deliveriesForRule(tx, ruleId);
    assert(
      afterSecond.length === 1,
      `re-observing an open alarm must write NO further ledger row on the streaming ` +
        `path (owner ruling Q2), found ${afterSecond.length} rows for rule ${code}`,
    );
    assert(
      sentForRule().length === 1,
      `re-observing an open alarm must send nothing further; the transport has now seen ` +
        `${sentForRule().length} messages for rule ${code}`,
    );

    // Last, and only now: every query this assertion started was issued on
    // this connection before the round trips above returned, so nothing is
    // still in flight to land on a released connection.
    tx.rollback();
  });
}

import { randomUUID } from "node:crypto";

import { and, eq, is, TransactionRollbackError } from "drizzle-orm";

import {
  alarms,
  automationRules,
  notificationChannels,
  notificationDeliveries,
  pointValues,
  ruleExecutions,
  ruleNotifications,
} from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import { AlarmRaiser } from "../alarms/alarm-raise.service";
import type { AlarmsGateway } from "../alarms/alarms.gateway";
import { ChannelsService } from "../notifications/channels.service";
import type {
  DeliveryResult,
  NotificationMessage,
  NotificationTransport,
} from "../notifications/notification-transport";
import { buildConfig } from "../notifications/notifications.config";
import { NotificationsService } from "../notifications/notifications.service";
import { RulesService } from "./rules.service";
import { createFixtureAssets, fixtureLocation } from "../testing/integration-fixtures";
import { until } from "../testing/until";
import type { VocabulariesService } from "../vocabularies/vocabularies.service";

/**
 * `F3.6` task 5 / ADR 0033 decision 2 — `evaluateEnabledRules` raises
 * unscoped even when the caller's `assetIds` narrows what comes back.
 *
 * Same isolation as `alarm-raise.integration.spec.ts`: one transaction per
 * assertion, ended with `tx.rollback()` rather than manual `DELETE` — the
 * `alarms_rule_id_fk` `NO ACTION` FK (migration 0032) means a test rule
 * cannot be deleted ahead of the alarm it raised, and a transaction already
 * orders that correctly by never committing either.
 *
 * Fixture assets are built inside that transaction rather than read off the
 * seed with `SELECT id FROM bms.assets LIMIT 2` — the read this file used to do
 * was recorded as a race in `vitest.config.ts` at `F2.5`, having failed once
 * with `automation_rules_asset_id_fkey` on a full parallel run. See
 * `../testing/integration-fixtures.ts`.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function stubGateway(): AlarmsGateway {
  return { broadcastCreated: () => undefined } as unknown as AlarmsGateway;
}

function stubVocabularies(): VocabulariesService {
  return {
    assertRuleCategory: async () => undefined,
    assertAlarmSeverity: async () => undefined,
  } as unknown as VocabulariesService;
}

const ACTOR: Pick<JwtPayload, "sub" | "email"> = {
  sub: "00000000-0000-4000-8000-000000000000",
  email: "integration-test@bms.local",
};

async function withRollback(
  db: BmsDb,
  run: Parameters<BmsDb["transaction"]>[0],
): Promise<void> {
  await db.transaction(run).catch((err: unknown) => {
    if (!is(err, TransactionRollbackError)) {
      throw err;
    }
  });
}

async function insertMatchingFixture(
  db: BmsDb,
  assetId: string,
  suffix: string,
  organizationId: string,
  sampleTime: Date = new Date(),
  // `F3.7`: the stored `action` blob. The default is the column's own default,
  // so the two `F3.6` fixtures above keep the `trace_only` `asAction` falls
  // back to and notify nobody, exactly as they did before this parameter.
  action: unknown = {},
): Promise<{ ruleId: string }> {
  const pointKey = `f36_task5_test_point_${suffix}`;
  await db.insert(pointValues).values({
    time: sampleTime,
    assetId,
    pointKey,
    value: 600_000,
    unit: null,
  });

  const [rule] = await db
    .insert(automationRules)
    .values({
      // E7.1b: stamp the rule's org so `evaluateEnabledRules` resolves a real
      // tenant GUC rather than skipping the rule as un-orgd.
      organizationId,
      code: `F36_TASK5_TEST_${suffix.toUpperCase()}`,
      name: `F3.6 task 5 integration test — ${suffix}`,
      category: "safety",
      ruleType: "threshold",
      assetId,
      pointKey,
      operator: "gte",
      thresholdValue: 500_000,
      severity: "warning",
      action,
    })
    .returning({ id: automationRules.id });

  if (!rule) {
    throw new Error(`failed to insert test rule for ${suffix}`);
  }
  return { ruleId: rule.id };
}

/**
 * The scope assertion (F3.6 task 5): a caller scoped to asset A only sees
 * asset A's execution in the response, but BOTH A's and B's rules raise —
 * proving the raise is unscoped while the returned list is not.
 */
export async function assertRaisesUnscopedButReturnsScoped(db: BmsDb): Promise<void> {
  await withRollback(db, async (tx) => {
    const loc = await fixtureLocation(tx);
    const [assetA, assetB] = await createFixtureAssets(tx, 2, "F36T5", loc);
    const a = await insertMatchingFixture(tx, assetA, "a", loc.organizationId);
    const b = await insertMatchingFixture(tx, assetB, "b", loc.organizationId);

    // E7.1b: both pools are the same transaction, so fleetDb reads see the
    // uncommitted fixtures (the AlarmEnrichmentService pattern).
    // `F3.7`: these two assertions are about the raise and the trace, and their
    // fixture rules carry no `action`, so no dispatch is attempted. The
    // stand-in resolves rather than being `{}`, so a regression that started
    // dispatching here would fail on an assertion, not on a TypeError.
    const service = new RulesService(
      tx,
      tx,
      stubVocabularies(),
      new AlarmRaiser(tx, stubGateway()),
      { dispatch: () => Promise.resolve([]) } as unknown as NotificationsService,
    );

    const { items } = await service.evaluateEnabledRules(ACTOR, [assetA]);

    const returnedRuleIds = items.map((item) => item.ruleId);
    assert(
      returnedRuleIds.includes(a.ruleId),
      "the caller's own scoped rule must be in the returned trace list",
    );
    assert(
      !returnedRuleIds.includes(b.ruleId),
      "a rule outside the caller's assetIds must NOT be in the returned trace list",
    );

    // The raise, unlike the return value, must not respect assetIds — ADR
    // 0033 decision 2. Both assets must have an open alarm from their own
    // rule.
    const openAlarmIds = new Map<string, string>();
    for (const { ruleId, assetId, label } of [
      { ruleId: a.ruleId, assetId: assetA, label: "A (in scope)" },
      { ruleId: b.ruleId, assetId: assetB, label: "B (OUT of scope)" },
    ]) {
      const openAlarms = await tx
        .select({ id: alarms.id })
        .from(alarms)
        .where(and(eq(alarms.assetId, assetId), eq(alarms.ruleId, ruleId)));
      assert(
        openAlarms.length === 1,
        `asset ${label} must have exactly 1 open alarm from its matched rule regardless of ` +
          `assetIds scope, found ${openAlarms.length}`,
      );
      const alarmRow = openAlarms[0];
      if (alarmRow) {
        openAlarmIds.set(ruleId, alarmRow.id);
      }
    }

    // Exactly one rule_executions row per rule — evaluateEnabledRules' own
    // per-evaluation trace, not doubled by AlarmRaiser's internal one
    // (raise(..., { recordTrace: false })) — and that one row's trace
    // actually carries the alarm it opened. Code review caught a draft where
    // the raise result was discarded and `alarmId` never reached the trace at
    // all; this is the regression guard.
    for (const { ruleId, label } of [
      { ruleId: a.ruleId, label: "A" },
      { ruleId: b.ruleId, label: "B" },
    ]) {
      const traces = await tx
        .select({ id: ruleExecutions.id, trace: ruleExecutions.trace })
        .from(ruleExecutions)
        .where(eq(ruleExecutions.ruleId, ruleId));
      assert(
        traces.length === 1,
        `rule ${label} must have exactly 1 rule_executions row (evaluateEnabledRules' own, ` +
          `not doubled by AlarmRaiser), found ${traces.length}`,
      );
      const trace = traces[0]?.trace as Record<string, unknown> | null;
      assert(
        trace?.alarmId === openAlarmIds.get(ruleId),
        `rule ${label}'s trace must carry the alarmId it opened (${openAlarmIds.get(ruleId)}), ` +
          `got ${JSON.stringify(trace?.alarmId)}`,
      );
    }

    tx.rollback();
  });
}

/**
 * Security review (F3.6): a sample far older than
 * `isSampleFreshEnoughToRaise`'s bound must still be reported as `matched`
 * in the trace (honest about what the fleet's last reading was), but must
 * NOT raise — and must not touch `bms.alarms` at all. This is the case an
 * asset that stopped reporting (offline RTU, decommissioned) exercises the
 * moment anyone presses "Evaluate now".
 */
export async function assertStaleSampleMatchesButDoesNotRaise(db: BmsDb): Promise<void> {
  await withRollback(db, async (tx) => {
    const loc = await fixtureLocation(tx);
    const [assetId] = await createFixtureAssets(tx, 1, "F36T5", loc);
    const staleTime = new Date(Date.now() - 24 * 60 * 60 * 1000); // 1 day old
    const { ruleId } = await insertMatchingFixture(tx, assetId, "stale", loc.organizationId, staleTime);

    // `F3.7`: these two assertions are about the raise and the trace, and their
    // fixture rules carry no `action`, so no dispatch is attempted. The
    // stand-in resolves rather than being `{}`, so a regression that started
    // dispatching here would fail on an assertion, not on a TypeError.
    const service = new RulesService(
      tx,
      tx,
      stubVocabularies(),
      new AlarmRaiser(tx, stubGateway()),
      { dispatch: () => Promise.resolve([]) } as unknown as NotificationsService,
    );
    await service.evaluateEnabledRules(ACTOR, [assetId]);

    const openAlarms = await tx
      .select({ id: alarms.id })
      .from(alarms)
      .where(and(eq(alarms.assetId, assetId), eq(alarms.ruleId, ruleId)));
    assert(
      openAlarms.length === 0,
      `a stale sample must not raise an alarm, found ${openAlarms.length}`,
    );

    const traces = await tx
      .select({ status: ruleExecutions.status, matched: ruleExecutions.matched, trace: ruleExecutions.trace })
      .from(ruleExecutions)
      .where(eq(ruleExecutions.ruleId, ruleId));
    assert(traces.length === 1, `expected exactly 1 rule_executions row, found ${traces.length}`);
    const [traceRow] = traces;
    assert(
      traceRow?.status === "matched" && traceRow.matched === true,
      "the trace must still report the true (stale) match honestly, not silently downgrade to skipped",
    );
    const trace = traceRow?.trace as Record<string, unknown> | null;
    assert(
      trace?.alarmId === undefined,
      `a stale match must carry no alarmId in its trace, got ${JSON.stringify(trace?.alarmId)}`,
    );

    tx.rollback();
  });
}

// ---------------------------------------------------------------------------
// F3.7 — the on-demand path dispatches a `notify` rule's raise
// ---------------------------------------------------------------------------

type NotificationsDeps = ConstructorParameters<typeof NotificationsService>;

type DeliveryRow = {
  id: string;
  status: string;
  alarmId: string | null;
  dedupeKey: string | null;
  organizationId: string;
};

/**
 * Every ledger row for ONE rule.
 *
 * Filtered by the fixture's rule id, never counted table-wide: `F4.71` records
 * this file colliding with the `*.rls.integration` family under parallel load,
 * and `bms.notification_deliveries` is a table any other suite may write.
 *
 * `id` is selected because it is the only column that separates two rows
 * written inside one transaction. `attempted_at` defaults to `now()`, which in
 * Postgres is the *transaction* timestamp and therefore identical on both —
 * ordering by it would be arbitrary.
 */
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
 * The real `NotificationsService` on the caller's transaction, with a recording
 * transport in all three slots.
 *
 * Stand-ins copied from `notifications/storm-control.integration.spec.ts`: the
 * only `ChannelsService` method a dispatch reaches is `loadForRule`, a plain
 * `fleetDb` join that touches neither the crypto service nor access control, so
 * slots 2 and 3 are unused rather than a gate being bypassed. The transport is
 * fake for a stronger reason than speed — the fixture channel is a `webhook`,
 * and `WebhookTransport` would make a real request to the configured URL.
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
 * `F3.7` — `POST /api/v1/rules/evaluate` sends for a `notify` rule when its
 * alarm opens, records the attempt, and does neither for a `trace_only` rule
 * whose alarm opened in the very same sweep.
 *
 * **Both directions in one fixture, on purpose** (§4.6). Two threshold rules
 * match on one asset and both raise; only the `notify` one reaches a channel.
 * A test that watched a single rule would pass just as well against a sweep
 * that dispatched for every rule it raised, which is the bug that costs a
 * client an inbox.
 *
 * **The second sweep is the owner's Q2 ruling (2026-09-06).** The on-demand
 * path dispatches on *every attempted raise* and passes `raised` through, so
 * re-evaluating an unchanged plant writes one `skipped_deduped` row per joined
 * channel and touches no transport — the ledger answers "I pressed Evaluate
 * now, why was nobody told?". (The streaming engine is the asymmetric half and
 * dispatches only on `raised === true`; that is Task 3's spec, not this one.)
 *
 * `until` rather than `await`: ADR 0041 decision 1 makes the dispatch
 * fire-and-forget, so `evaluateEnabledRules` resolves before the ledger row
 * exists and there is nothing for a spec to await. See `testing/until.ts`.
 */
export async function assertNotifyRuleDispatchesOnRaiseOnly(db: BmsDb): Promise<void> {
  await withRollback(db, async (tx) => {
    const loc = await fixtureLocation(tx);
    const [assetId] = await createFixtureAssets(tx, 1, "F37T2", loc);
    if (!assetId) {
      throw new Error("createFixtureAssets returned no asset");
    }

    const notifyRule = await insertMatchingFixture(tx, assetId, "notify", loc.organizationId, new Date(), {
      type: "notify",
      target: "t",
    });
    const traceOnlyRule = await insertMatchingFixture(
      tx,
      assetId,
      "traceonly",
      loc.organizationId,
      new Date(),
      { type: "trace_only", target: "Operations" },
    );

    const [channel] = await tx
      .insert(notificationChannels)
      .values({
        organizationId: loc.organizationId,
        // `randomUUID`, because `(organization_id, code)` is unique: two
        // workers on this file would otherwise block on an uncommitted
        // duplicate key rather than run.
        code: `f37-t2-${randomUUID().slice(0, 18)}`,
        name: "F3.7 task 2 integration fixture",
        kind: "webhook",
        config: { url: "https://hooks.example.com/x" },
        enabled: true,
      })
      .returning({ id: notificationChannels.id });
    if (!channel) {
      throw new Error("failed to insert the fixture notification channel");
    }

    // BOTH rules are joined to the channel. The `trace_only` rule having a
    // channel is what makes its silence mean something: the action decided it,
    // not a missing join.
    await tx.insert(ruleNotifications).values([
      { ruleId: notifyRule.ruleId, channelId: channel.id },
      { ruleId: traceOnlyRule.ruleId, channelId: channel.id },
    ]);

    const { notifications, sent } = realNotificationsOn(tx);
    const service = new RulesService(
      tx,
      tx,
      stubVocabularies(),
      new AlarmRaiser(tx, stubGateway()),
      notifications,
    );
    const sentForRule = (ruleId: string): NotificationMessage[] =>
      sent.filter((message) => message.ruleId === ruleId);

    // --- first sweep: the transition ----------------------------------------
    await service.evaluateEnabledRules(ACTOR, null);

    await until(async () => (await deliveriesForRule(tx, notifyRule.ruleId)).length === 1, {
      timeoutMs: 10_000,
      label: "the notify rule's first delivery row",
    });

    const openAlarms = await tx
      .select({ id: alarms.id })
      .from(alarms)
      .where(and(eq(alarms.assetId, assetId), eq(alarms.ruleId, notifyRule.ruleId)));
    assert(
      openAlarms.length === 1,
      `the notify rule must have opened exactly 1 alarm, found ${openAlarms.length}`,
    );
    const alarmId = openAlarms[0]?.id;

    const afterFirst = await deliveriesForRule(tx, notifyRule.ruleId);
    const first = afterFirst[0];
    assert(first !== undefined, "the notify rule's delivery row disappeared");
    assert(
      first?.status === "sent",
      `a genuine transition must be recorded as sent, got ${String(first?.status)}`,
    );
    assert(
      first?.alarmId === alarmId,
      `the delivery must name the alarm that opened (${String(alarmId)}), got ${String(first?.alarmId)}`,
    );
    assert(
      first?.dedupeKey === `${notifyRule.ruleId}:${String(alarmId)}:warning`,
      `the dedupe key must be ruleId:alarmId:severity, got ${String(first?.dedupeKey)}`,
    );
    assert(
      first?.organizationId === loc.organizationId,
      `the delivery must be filed under the rule's own organization, got ${String(first?.organizationId)}`,
    );
    assert(
      sentForRule(notifyRule.ruleId).length === 1,
      `the transport must have seen exactly 1 message for the notify rule, got ${sentForRule(notifyRule.ruleId).length}`,
    );

    // The other direction, in the same sweep: `trace_only` raised too.
    const traceOnlyAlarms = await tx
      .select({ id: alarms.id })
      .from(alarms)
      .where(and(eq(alarms.assetId, assetId), eq(alarms.ruleId, traceOnlyRule.ruleId)));
    assert(
      traceOnlyAlarms.length === 1,
      `the trace_only rule must also have opened an alarm — otherwise its silence proves ` +
        `nothing about the action; found ${traceOnlyAlarms.length}`,
    );
    const traceOnlyDeliveries = await deliveriesForRule(tx, traceOnlyRule.ruleId);
    assert(
      traceOnlyDeliveries.length === 0,
      `a trace_only rule must dispatch nothing even though it raised and has a joined ` +
        `channel, found ${traceOnlyDeliveries.length} delivery rows`,
    );
    assert(
      sentForRule(traceOnlyRule.ruleId).length === 0,
      "a trace_only rule must not reach a transport",
    );

    // --- second sweep: the unchanged plant (owner ruling Q2) -----------------
    await service.evaluateEnabledRules(ACTOR, null);

    await until(async () => (await deliveriesForRule(tx, notifyRule.ruleId)).length === 2, {
      timeoutMs: 10_000,
      label: "the notify rule's skipped_deduped row",
    });

    const afterSecond = await deliveriesForRule(tx, notifyRule.ruleId);
    const second = afterSecond.find((row) => row.id !== first?.id);
    assert(second !== undefined, "the second sweep wrote no new delivery row");
    assert(
      second?.status === "skipped_deduped",
      `an unchanged plant must record the refusal, got ${String(second?.status)}`,
    );
    assert(
      second?.alarmId === null,
      `a non-transition raised no alarm, so the row must carry none; got ${String(second?.alarmId)}`,
    );
    assert(
      second?.dedupeKey === `${notifyRule.ruleId}:no-alarm:warning`,
      `a refusal must NOT share the transition's dedupe key — that would defeat the ` +
        `dedupe it records; got ${String(second?.dedupeKey)}`,
    );
    assert(
      sentForRule(notifyRule.ruleId).length === 1,
      `re-evaluating an unchanged plant must send nothing further; the transport has now ` +
        `seen ${sentForRule(notifyRule.ruleId).length} messages for the notify rule`,
    );

    // Last, and only now. Every dispatch this sweep started is a `loadForRule`
    // SELECT, then per channel at most one existence read (`F3.46`) and one
    // insert — the insert is always last — all issued before the `until` poll
    // above returned; pg queues them on this one connection in order, so
    // nothing is still in flight to land on a released connection.
    tx.rollback();
  });
}

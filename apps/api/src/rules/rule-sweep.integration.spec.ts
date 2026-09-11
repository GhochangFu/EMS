import { randomUUID } from "node:crypto";

import { Logger } from "@nestjs/common";

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
import type { RuleSweepSummary } from "@bms/shared";

import { AlarmRaiser } from "../alarms/alarm-raise.service";
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
import { withTenant } from "../database/tenant-context";
import { selectRuleRows, stampRulesEvaluated } from "./rule-reads";
import { batchedLatestPointValues } from "./rule-samples";
import { runRuleSweep } from "./rule-sweep";

/**
 * `F3.11` / ADR 0064 decisions 4, 5 — the sweep body on the deps
 * `RuleSweepService.run` wires, with a real `AlarmRaiser`, a real
 * `NotificationsService` and the real stamp, against a real database — so the
 * sweep's write policy is proved on rows rather than on the recording raiser
 * `rule-sweep.spec.ts` drives. See `sweepOn` for why the walk is scoped.
 *
 * Same isolation as `evaluate-enabled-rules.integration.spec.ts`: one
 * transaction per scenario, used as BOTH pools (the fleet read and the tenant
 * writes see the same uncommitted fixtures), ended with `tx.rollback()`. The
 * `pg_notify` the raiser issues rides that transaction and is dropped with
 * it, so a run here announces nothing to the running stack's listener.
 *
 * **The reader walks every enabled, published rule in the database** (ADR
 * 0033 decision 2) — 289 on the seeded dev database on 2026-09-11 — and
 * `sweepOn` keeps only the scenario's own rows, so every count below is
 * filtered to a fixture rule's id and never taken table-wide, and the
 * `evaluated` claim derives its expectation from the same `selectRuleRows`
 * read inside the same transaction.
 *
 * **Shape.** One scenario runner per `withRollback` returns a plain outcome
 * read before the rollback; one exported assert per claim reads it
 * (`queue.integration.spec.ts`'s shape). `assert` throws, so a claim that
 * shared an `it()` with an earlier one would never redden on its own.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * `evaluate-enabled-rules.integration.spec.ts`'s `insertMatchingFixture`,
 * widened: `value` makes a non-matching threshold rule (`1 < 500_000`),
 * `ruleType`/`condition` make a `time_window` rule, and `label` orders the
 * rule inside the sweep (`selectRuleRows` sorts by `enabled, category,
 * name`). A rule inserted with no sample is the "no telemetry" case.
 */
async function insertFixtureRule(
  db: BmsDb,
  input: {
    assetId: string;
    organizationId: string;
    label: string;
    sampleTime?: Date | null;
    value?: number;
    action?: unknown;
    ruleType?: "threshold" | "time_window";
    condition?: unknown;
  },
): Promise<{ ruleId: string; code: string; pointKey: string }> {
  const pointKey = `f311_sweep_${input.label}_${randomUUID().slice(0, 8)}`;
  if (input.sampleTime !== null) {
    await db.insert(pointValues).values({
      time: input.sampleTime ?? new Date(),
      assetId: input.assetId,
      pointKey,
      value: input.value ?? 600_000,
      unit: null,
    });
  }

  const code = `F311_SWEEP_${input.label.toUpperCase()}_${randomUUID().slice(0, 8).toUpperCase()}`;
  const [rule] = await db
    .insert(automationRules)
    .values({
      organizationId: input.organizationId,
      code,
      name: `F3.11 sweep integration — ${input.label}`,
      category: "safety",
      ruleType: input.ruleType ?? "threshold",
      assetId: input.assetId,
      pointKey,
      operator: "gte",
      thresholdValue: 500_000,
      severity: "warning",
      condition: input.condition ?? {},
      action: input.action ?? {},
    })
    .returning({ id: automationRules.id });
  if (!rule) {
    throw new Error(`failed to insert the fixture rule ${code}`);
  }
  return { ruleId: rule.id, code, pointKey };
}

/** Every open alarm one fixture rule raised on its asset. */
async function alarmsForRule(db: BmsDb, assetId: string, ruleId: string): Promise<number> {
  const rows = await db
    .select({ id: alarms.id })
    .from(alarms)
    .where(and(eq(alarms.assetId, assetId), eq(alarms.ruleId, ruleId)));
  return rows.length;
}

/** Every `rule_executions` trace one fixture rule wrote. */
async function tracesForRule(db: BmsDb, ruleId: string): Promise<Record<string, unknown>[]> {
  const rows = await db
    .select({ trace: ruleExecutions.trace })
    .from(ruleExecutions)
    .where(eq(ruleExecutions.ruleId, ruleId));
  return rows.map((row) => (row.trace ?? {}) as Record<string, unknown>);
}

type StampRow = { lastEvaluatedAt: Date | null; updatedAt: Date };

async function stampOf(db: BmsDb, ruleId: string): Promise<StampRow> {
  const [row] = await db
    .select({ lastEvaluatedAt: automationRules.lastEvaluatedAt, updatedAt: automationRules.updatedAt })
    .from(automationRules)
    .where(eq(automationRules.id, ruleId));
  if (!row) {
    throw new Error(`fixture rule ${ruleId} disappeared`);
  }
  return row;
}

/**
 * The sweep body on the five deps `RuleSweepService.run` wires
 * (`rule-sweep.service.ts`), on one handle — the fleet read is
 * `tx.transaction(selectRuleRows)`, a savepoint on the same connection, and
 * every tenant write is `withTenant(tx, …)`, so the fixtures inserted above are
 * visible to both. That wiring itself is pinned by `rule-sweep.service.spec.ts`
 * (three sentinel claims); this suite proves the policy against real rows.
 *
 * **The walk is scoped to the scenario's own rules, after the real reader
 * runs.** `selectRuleRows` still returns the whole fleet; the filter drops the
 * ~290 committed seeded rules. Unscoped, the sweep raised on seeded rules and
 * stamped all of them in one `UPDATE … = ANY($1)` inside this suite's
 * never-committing transaction, while `evaluate-enabled-rules.integration`
 * stamped the same rows one by one inside *its* never-committing transaction
 * — measured 2026-09-11, three of three runs beside that suite, zero alone:
 * Postgres reported `40P01` (`Process 29097 waits for ShareLock on transaction
 * 6375722; blocked by process 29098 … while updating tuple in relation
 * "automation_rules"`) and killed the stamp. The sweep's per-organization
 * `catch` swallowed it, but on one connection the stamp is a savepoint, and
 * the fire-and-forget dispatch's ledger insert had landed inside that
 * savepoint window — `ROLLBACK TO SAVEPOINT` erased the row `sent.length === 1`
 * proved was written, and `until` waited out its 10 s. Production cannot form
 * the cycle: the press stamps each rule in its own short `withTenant`
 * transaction (`rules.service.ts:709`), so it never holds row X while waiting
 * for row Y. Two long-transaction fleet walkers on one shared database can,
 * and the fix is to stop this one competing on rows it did not create.
 */
function sweepOn(
  tx: BmsDb,
  notifications: NotificationsService,
  ruleIds: readonly string[],
): { run(): Promise<RuleSweepSummary> } {
  const own = new Set(ruleIds);
  const raiser = new AlarmRaiser(tx);
  const logger = new Logger("rule-sweep.integration");
  return {
    run: () =>
      runRuleSweep({
        readRules: async () =>
          (await tx.transaction((inner) => selectRuleRows(inner))).filter((row) => own.has(row.id)),
        loadSamples: (rows) => batchedLatestPointValues(tx, rows),
        raiser,
        notifications,
        stampEvaluated: (organizationId, ids, at) =>
          withTenant(tx, organizationId, (inner) => stampRulesEvaluated(inner, ids, at)),
        logger,
        now: Date.now,
      }),
  };
}

/**
 * For the scenarios whose fixture rules carry no `action`: a stand-in that
 * resolves, so a regression that started dispatching would fail on a count,
 * not on a `TypeError` (the `F3.6` reasoning). Seeded `notify` rules that
 * happen to raise inside the sweep reach this too, and touch no table.
 */
const silentNotifications = {
  dispatch: () => Promise.resolve([]),
} as unknown as NotificationsService;

// ---------------------------------------------------------------------------
// Scenario 1 — a matching and a non-matching rule, swept twice
// ---------------------------------------------------------------------------

export type MatchingSweepOutcome = {
  readonly summary: RuleSweepSummary;
  readonly matching: { readonly alarms: number; readonly traces: Record<string, unknown>[] };
  readonly nonMatching: { readonly alarms: number; readonly traces: number };
  readonly afterSecond: {
    readonly matchingAlarms: number;
    readonly matchingTraces: number;
    readonly nonMatchingAlarms: number;
    readonly nonMatchingTraces: number;
  };
  /** Both fixture rules, before the first sweep and after it. */
  readonly stamps: { readonly before: StampRow; readonly after: StampRow }[];
};

/**
 * Decision 5 on rows: the sweep traces like the streaming engine (one row,
 * on a raise, `raisedBy: "rule_sweep"`), not like the press (one row per
 * rule per evaluation with `evaluatedBy`). The non-matching rule in the same
 * sweep is what separates the two — under the press's policy it has a trace.
 *
 * The stamps are read here rather than in their own scenario because they
 * are a fact about this same sweep: `finishedAt` is the one instant both
 * rules' `last_evaluated_at` must equal (Amendment 1 A4 for `updated_at`).
 */
export async function runMatchingSweep(db: BmsDb): Promise<MatchingSweepOutcome> {
  let outcome: MatchingSweepOutcome | undefined;
  await withRollback(db, async (tx) => {
    const loc = await fixtureLocation(tx);
    const [assetA, assetB] = await createFixtureAssets(tx, 2, "F311S", loc);
    if (!assetA || !assetB) {
      throw new Error("createFixtureAssets returned fewer than 2 assets");
    }
    const matching = await insertFixtureRule(tx, {
      assetId: assetA,
      organizationId: loc.organizationId,
      label: "match",
    });
    const nonMatching = await insertFixtureRule(tx, {
      assetId: assetB,
      organizationId: loc.organizationId,
      label: "nomatch",
      value: 1,
    });
    const before = [await stampOf(tx, matching.ruleId), await stampOf(tx, nonMatching.ruleId)];

    const service = sweepOn(tx, silentNotifications, [matching.ruleId, nonMatching.ruleId]);
    const summary = await service.run();

    const first = {
      matching: {
        alarms: await alarmsForRule(tx, assetA, matching.ruleId),
        traces: await tracesForRule(tx, matching.ruleId),
      },
      nonMatching: {
        alarms: await alarmsForRule(tx, assetB, nonMatching.ruleId),
        traces: (await tracesForRule(tx, nonMatching.ruleId)).length,
      },
    };
    const after = [await stampOf(tx, matching.ruleId), await stampOf(tx, nonMatching.ruleId)];

    await service.run();

    outcome = {
      summary,
      ...first,
      afterSecond: {
        matchingAlarms: await alarmsForRule(tx, assetA, matching.ruleId),
        matchingTraces: (await tracesForRule(tx, matching.ruleId)).length,
        nonMatchingAlarms: await alarmsForRule(tx, assetB, nonMatching.ruleId),
        nonMatchingTraces: (await tracesForRule(tx, nonMatching.ruleId)).length,
      },
      stamps: before.map((b, i) => ({ before: b, after: after[i] as StampRow })),
    };

    tx.rollback();
  });
  if (outcome === undefined) {
    throw new Error("the scenario never ran");
  }
  return outcome;
}

export function assertMatchingRuleOpensOneAlarm(outcome: MatchingSweepOutcome): void {
  assert(
    outcome.matching.alarms === 1,
    `a matching fresh fixture must open exactly 1 alarm, found ${outcome.matching.alarms}`,
  );
}

export function assertMatchingRuleTracesOnceAsRuleSweep(outcome: MatchingSweepOutcome): void {
  const { traces } = outcome.matching;
  assert(
    traces.length === 1,
    `the raise must write exactly 1 rule_executions row (the raiser's own, ADR 0033 decision 3), found ${traces.length}`,
  );
  assert(
    traces[0]?.raisedBy === "rule_sweep",
    `the trace must read raisedBy: "rule_sweep", got ${JSON.stringify(traces[0]?.raisedBy)}`,
  );
}

/** The press's key. Its absence is what says nobody pressed anything; the row above is the positive control that the trace exists. */
export function assertSweepTraceCarriesNoEvaluatedBy(outcome: MatchingSweepOutcome): void {
  const trace = outcome.matching.traces[0];
  assert(trace !== undefined, "no trace to inspect — the row above reddens first");
  assert(
    !("evaluatedBy" in trace),
    `a sweep trace must carry no evaluatedBy key, got ${JSON.stringify(trace)}`,
  );
}

export function assertNonMatchingRuleLeavesNoTraceAndNoAlarm(outcome: MatchingSweepOutcome): void {
  assert(
    outcome.nonMatching.traces === 0,
    `a non-matching rule in the same sweep must write no rule_executions row (decision 5: ` +
      `the press's every-rule trace does not leak in), found ${outcome.nonMatching.traces}`,
  );
  assert(
    outcome.nonMatching.alarms === 0,
    `a non-matching rule must open no alarm, found ${outcome.nonMatching.alarms}`,
  );
}

export function assertSecondSweepChangesNoCount(outcome: MatchingSweepOutcome): void {
  const { afterSecond } = outcome;
  assert(
    afterSecond.matchingAlarms === 1 && afterSecond.matchingTraces === 1,
    `a second sweep over an unchanged plant must leave the matching rule at 1 alarm and 1 trace; ` +
      `got alarms=${afterSecond.matchingAlarms} traces=${afterSecond.matchingTraces}`,
  );
  assert(
    afterSecond.nonMatchingAlarms === 0 && afterSecond.nonMatchingTraces === 0,
    `a second sweep must still write nothing for the non-matching rule; ` +
      `got alarms=${afterSecond.nonMatchingAlarms} traces=${afterSecond.nonMatchingTraces}`,
  );
}

/** Both rules, to the millisecond: one `UPDATE … = ANY($1)` per organization with the summary's instant, not `new Date()` per rule. */
export function assertLastEvaluatedAtIsTheSummaryFinishedAt(outcome: MatchingSweepOutcome): void {
  const expected = Date.parse(outcome.summary.finishedAt);
  assert(!Number.isNaN(expected), `finishedAt is not an instant: ${outcome.summary.finishedAt}`);
  outcome.stamps.forEach(({ before, after }, i) => {
    assert(
      before.lastEvaluatedAt === null,
      `fixture rule ${i} must start unstamped, got ${String(before.lastEvaluatedAt)}`,
    );
    assert(
      after.lastEvaluatedAt !== null && after.lastEvaluatedAt.getTime() === expected,
      `fixture rule ${i}'s last_evaluated_at must equal the returned finishedAt ` +
        `(${outcome.summary.finishedAt}), got ${after.lastEvaluatedAt?.toISOString() ?? "null"}`,
    );
  });
}

/** Amendment 1 A4: the sweep stamps `last_evaluated_at` only. The row above is the positive control that the stamp ran. */
export function assertUpdatedAtIsUntouched(outcome: MatchingSweepOutcome): void {
  outcome.stamps.forEach(({ before, after }, i) => {
    assert(
      after.updatedAt.getTime() === before.updatedAt.getTime(),
      `fixture rule ${i}'s updated_at must not move on a sweep (A4); ` +
        `before ${before.updatedAt.toISOString()}, after ${after.updatedAt.toISOString()}`,
    );
  });
}

// ---------------------------------------------------------------------------
// Scenario 2 — a notify rule with a webhook channel, swept twice
// ---------------------------------------------------------------------------

type NotificationsDeps = ConstructorParameters<typeof NotificationsService>;

type DeliveryRow = {
  id: string;
  status: string;
  alarmId: string | null;
};

/** Every ledger row for ONE rule — never counted table-wide (`F4.71`). */
async function deliveriesForRule(db: BmsDb, ruleId: string): Promise<DeliveryRow[]> {
  return db
    .select({
      id: notificationDeliveries.id,
      status: notificationDeliveries.status,
      alarmId: notificationDeliveries.alarmId,
    })
    .from(notificationDeliveries)
    .where(eq(notificationDeliveries.ruleId, ruleId));
}

/**
 * The real `NotificationsService` on the caller's transaction with a
 * recording transport in all three slots — `evaluate-enabled-rules
 * .integration.spec.ts`'s `realNotificationsOn`, for the same reasons: the
 * only `ChannelsService` method a dispatch reaches is `loadForRule`, and the
 * fixture channel is a `webhook`, which the real transport would call.
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
    buildConfig({ NOTIFY_RATE_LIMIT_PER_HOUR: "1000" }),
  );
  return { notifications, sent };
}

export type NotifySweepOutcome = {
  readonly afterFirst: DeliveryRow[];
  readonly sentAfterFirst: number;
  /** Rule B's ledger after sweep 2 — the drain marker. */
  readonly marker: DeliveryRow[];
  readonly afterSecond: DeliveryRow[];
  readonly sentAfterSecond: number;
};

/**
 * Decision 5's other half: `notifyOnRaise` only when `raised.raised`.
 * Contrast `evaluate-enabled-rules.integration.spec.ts`, whose second press
 * writes a `skipped_deduped` row for the same shape of fixture.
 *
 * **The absence after sweep 2 needs a drain marker.** Dispatch is
 * fire-and-forget, so "no second row for rule A" would also hold while the
 * row was still in flight. Rule B is a second `notify` rule on the same
 * channel whose sample lands BETWEEN the sweeps, so sweep 2 must produce
 * *its* delivery — and rule A sorts first, so its dispatch, if the sweep
 * started one, was queued on this one connection ahead of B's. `until` on
 * B's row is what makes "A is still at one" a claim about the policy and not
 * about timing.
 */
export async function runNotifySweep(db: BmsDb): Promise<NotifySweepOutcome> {
  let outcome: NotifySweepOutcome | undefined;
  await withRollback(db, async (tx) => {
    const loc = await fixtureLocation(tx);
    const [assetId] = await createFixtureAssets(tx, 1, "F311S", loc);
    if (!assetId) {
      throw new Error("createFixtureAssets returned no asset");
    }
    const notify = { type: "notify", target: "t" };
    const ruleA = await insertFixtureRule(tx, {
      assetId,
      organizationId: loc.organizationId,
      label: "a_notify",
      action: notify,
    });
    // No sample yet: sweep 1 finds no telemetry for it and raises nothing.
    const ruleB = await insertFixtureRule(tx, {
      assetId,
      organizationId: loc.organizationId,
      label: "b_notify",
      sampleTime: null,
      action: notify,
    });

    const [channel] = await tx
      .insert(notificationChannels)
      .values({
        organizationId: loc.organizationId,
        code: `f311-sweep-${randomUUID().slice(0, 18)}`,
        name: "F3.11 sweep integration fixture",
        kind: "webhook",
        config: { url: "https://hooks.example.com/x" },
        enabled: true,
      })
      .returning({ id: notificationChannels.id });
    if (!channel) {
      throw new Error("failed to insert the fixture notification channel");
    }
    await tx.insert(ruleNotifications).values([
      { ruleId: ruleA.ruleId, channelId: channel.id },
      { ruleId: ruleB.ruleId, channelId: channel.id },
    ]);

    const { notifications, sent } = realNotificationsOn(tx);
    const sentFor = (ruleId: string): number =>
      sent.filter((message) => message.ruleId === ruleId).length;
    const service = sweepOn(tx, notifications, [ruleA.ruleId, ruleB.ruleId]);

    // --- sweep 1: rule A transitions --------------------------------------
    await service.run();
    await until(async () => (await deliveriesForRule(tx, ruleA.ruleId)).length === 1, {
      timeoutMs: 10_000,
      label: "rule A's first delivery row",
    });
    const afterFirst = await deliveriesForRule(tx, ruleA.ruleId);
    const sentAfterFirst = sentFor(ruleA.ruleId);

    // --- sweep 2: rule A's alarm is open; rule B transitions ---------------
    await tx.insert(pointValues).values({
      time: new Date(),
      assetId,
      pointKey: ruleB.pointKey,
      value: 600_000,
      unit: null,
    });
    await service.run();
    await until(async () => (await deliveriesForRule(tx, ruleB.ruleId)).length === 1, {
      timeoutMs: 10_000,
      label: "rule B's delivery row (the drain marker)",
    });

    outcome = {
      afterFirst,
      sentAfterFirst,
      marker: await deliveriesForRule(tx, ruleB.ruleId),
      afterSecond: await deliveriesForRule(tx, ruleA.ruleId),
      sentAfterSecond: sentFor(ruleA.ruleId),
    };

    // Last, and only now — every dispatch this transaction started has landed
    // (the `until` above is the proof), so nothing is in flight to land on a
    // released connection.
    tx.rollback();
  });
  if (outcome === undefined) {
    throw new Error("the scenario never ran");
  }
  return outcome;
}

export function assertNotifyRuleDeliversOnceOnTheFirstSweep(outcome: NotifySweepOutcome): void {
  assert(
    outcome.afterFirst.length === 1,
    `sweep 1 must write exactly 1 delivery row for the notify rule, found ${outcome.afterFirst.length}`,
  );
  assert(
    outcome.afterFirst[0]?.status === "sent" && outcome.afterFirst[0].alarmId !== null,
    `the delivery must be a sent row naming the alarm, got ${JSON.stringify(outcome.afterFirst[0])}`,
  );
  assert(
    outcome.sentAfterFirst === 1,
    `the transport must have seen exactly 1 message for the notify rule, got ${outcome.sentAfterFirst}`,
  );
}

/** The positive control for the absence below: sweep 2 did dispatch, for the rule that transitioned. */
export function assertSecondSweepDeliversForTheRuleThatTransitioned(
  outcome: NotifySweepOutcome,
): void {
  assert(
    outcome.marker.length === 1 && outcome.marker[0]?.status === "sent",
    `sweep 2 must write one sent row for rule B, whose sample landed between the sweeps; ` +
      `got ${JSON.stringify(outcome.marker)}`,
  );
}

export function assertSecondSweepWritesNoRowForAnOpenAlarm(outcome: NotifySweepOutcome): void {
  assert(
    outcome.afterSecond.length === 1,
    `sweep 2 must write nothing for a rule whose alarm is already open — no skipped_deduped row, ` +
      `unlike the press (decision 5); found ${outcome.afterSecond.length} rows: ` +
      JSON.stringify(outcome.afterSecond.map((row) => row.status)),
  );
  assert(
    outcome.sentAfterSecond === 1,
    `sweep 2 must send nothing further for the open alarm; the transport has now seen ` +
      `${outcome.sentAfterSecond} messages`,
  );
}

// ---------------------------------------------------------------------------
// Scenario 3 — the freshness bound and a time_window rule, in one sweep
// ---------------------------------------------------------------------------

export type BoundsSweepOutcome = {
  readonly staleAlarms: number;
  readonly freshAlarms: number;
  readonly windowAlarms: number;
  readonly evaluated: number;
  /** Every enabled, published, organization-bearing rule visible in the transaction. */
  readonly expectedEvaluated: number;
  readonly windowRuleInExpectation: boolean;
};

/**
 * `isSampleFreshEnoughToRaise` in the real composition (`:227`'s shape from
 * the press spec, 16 minutes against the 15-minute bound), with a fresh
 * fixture beside it so "no alarm" is not the sweep raising nothing at all,
 * and a `time_window` rule that matches at every instant (all seven days,
 * `00:00`–`23:59`) so `shouldRaise` is the only thing standing between it and
 * a raise.
 *
 * `evaluated` is fleet-wide, so its expectation is derived from the same
 * read the sweep makes, inside the same transaction.
 */
export async function runBoundsSweep(db: BmsDb): Promise<BoundsSweepOutcome> {
  let outcome: BoundsSweepOutcome | undefined;
  await withRollback(db, async (tx) => {
    const loc = await fixtureLocation(tx);
    const [assetStale, assetFresh, assetWindow] = await createFixtureAssets(tx, 3, "F311B", loc);
    if (!assetStale || !assetFresh || !assetWindow) {
      throw new Error("createFixtureAssets returned fewer than 3 assets");
    }
    const stale = await insertFixtureRule(tx, {
      assetId: assetStale,
      organizationId: loc.organizationId,
      label: "stale",
      sampleTime: new Date(Date.now() - 16 * 60 * 1000),
    });
    const fresh = await insertFixtureRule(tx, {
      assetId: assetFresh,
      organizationId: loc.organizationId,
      label: "fresh",
    });
    const window = await insertFixtureRule(tx, {
      assetId: assetWindow,
      organizationId: loc.organizationId,
      label: "window",
      ruleType: "time_window",
      condition: {
        days: ["sun", "mon", "tue", "wed", "thu", "fri", "sat"],
        startTime: "00:00",
        endTime: "23:59",
      },
    });

    const own = [stale.ruleId, fresh.ruleId, window.ruleId];
    const expectedRows = (await selectRuleRows(tx)).filter(
      (row) =>
        own.includes(row.id) &&
        row.enabled &&
        row.lifecycleStatus === "published" &&
        row.organizationId !== null,
    );

    const summary = await sweepOn(tx, silentNotifications, own).run();

    outcome = {
      staleAlarms: await alarmsForRule(tx, assetStale, stale.ruleId),
      freshAlarms: await alarmsForRule(tx, assetFresh, fresh.ruleId),
      windowAlarms: await alarmsForRule(tx, assetWindow, window.ruleId),
      evaluated: summary.evaluated,
      expectedEvaluated: expectedRows.length,
      windowRuleInExpectation: expectedRows.some((row) => row.id === window.ruleId),
    };

    tx.rollback();
  });
  if (outcome === undefined) {
    throw new Error("the scenario never ran");
  }
  return outcome;
}

export function assertStaleSampleDoesNotRaise(outcome: BoundsSweepOutcome): void {
  assert(
    outcome.staleAlarms === 0,
    `a matching sample 16 minutes old must not raise (MAX_RAISE_SAMPLE_AGE_MS), found ${outcome.staleAlarms}`,
  );
}

/** The positive control: the same sweep, a fresh sample, one alarm. */
export function assertFreshSampleRaisesInTheSameSweep(outcome: BoundsSweepOutcome): void {
  assert(
    outcome.freshAlarms === 1,
    `the fresh fixture beside the stale one must open exactly 1 alarm, found ${outcome.freshAlarms}`,
  );
}

export function assertEvaluatedCountsTheTimeWindowRule(outcome: BoundsSweepOutcome): void {
  assert(
    outcome.windowRuleInExpectation,
    "the time_window fixture is not in the enabled+published read — the fixture is wrong, not the sweep",
  );
  assert(
    outcome.evaluated === outcome.expectedEvaluated,
    `evaluated must count every enabled, published rule the fleet read returns, the time_window ` +
      `fixture included; expected ${outcome.expectedEvaluated}, got ${outcome.evaluated}`,
  );
}

export function assertTimeWindowRuleRaisesNothing(outcome: BoundsSweepOutcome): void {
  assert(
    outcome.windowAlarms === 0,
    `a matched time_window rule must not raise (shouldRaise), found ${outcome.windowAlarms}`,
  );
}

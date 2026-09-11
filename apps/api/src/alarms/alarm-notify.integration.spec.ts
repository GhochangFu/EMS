import { randomUUID } from "node:crypto";

import { eq, is, TransactionRollbackError } from "drizzle-orm";
import { Client } from "pg";

import { alarms } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { AlarmListItem } from "@bms/shared";

import type { ListenerClient, NotifyListener } from "../database/notify-listener";
import type { BmsTx } from "../database/tenant-context";
import { sleep } from "../telemetry/sleep";
import { until } from "../testing/until";
import { readAlarmListItem } from "./alarm-list-item";
import { createAlarmNotifyListener } from "./alarm-notify";
import { AlarmRaiser, type AlarmRaiseResult, type AlarmRaiseRule } from "./alarm-raise.service";

/**
 * `F3.11` / ADR 0064 decision 4 — the proof that a raise reaches the
 * gateway across a real Postgres: `AlarmRaiser`'s `pg_notify('bms_alarms')`
 * on one connection, `LISTEN bms_alarms` as `bms_auth` on another, the read
 * by id on the fleet pool, and the broadcast — the exact composition
 * `AlarmNotifyService` makes, minus Nest.
 *
 * **Committed fixtures, not `withRollback`.** A transactional `NOTIFY` is
 * dropped with a rollback, so the positive row has to commit; the wrapper
 * deletes the rows by id in FK order. The one rolled-back row here is the
 * negative: it rolls back the raise's *own* transaction (see
 * {@link rollingBackHandle}) and observes that the listener was never asked
 * to read the alarm.
 *
 * **What the negative row watches, and why it is not `received`.** An escaped
 * `NOTIFY` names an alarm whose row was rolled back; `alarm-notify.ts`
 * answers a `null` read with a warn and no broadcast, so `received` would
 * stay unchanged even if the announcement had leaked. The first observable
 * effect of a delivery is the `readAlarm` call, so every id the listener asks
 * for is recorded, and the negative row asserts the rolled-back alarm's id is
 * not among them. The positive row asserts the committed one is — the same
 * observable, adjacent.
 *
 * **`LISTEN bms_alarms` is fleet-wide.** Every committed raise anywhere on
 * this database — another suite's `bms_tenant` fixture under `maxWorkers: 2`,
 * the running stack's own engine — arrives here too. So no count below is a
 * bare delta on `received` or `reads`: broadcasts are filtered to the
 * fixture's `assetId` (the row carries it) and reads to the alarms that
 * exist on that asset. A foreign arrival is not this suite's claim and must
 * not redden it.
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

/**
 * A handle whose every `transaction()` runs the callback, keeps its result,
 * and rolls back; every other member is the pool's own.
 *
 * This is how the negative row rolls back the raise's OWN `withTenant`
 * transaction — the claim being made — rather than wrapping the raise in an
 * outer transaction of the spec's. The difference matters: with
 * `new AlarmRaiser(tx)` inside an outer `withRollback`, a `pg_notify` moved
 * *after* the raise's transaction would still run on `tx`, inside the outer
 * `BEGIN`, and die with the same rollback — the row would stay green under
 * exactly the regression it exists to catch. On this handle that statement
 * runs on the pool, autocommits, and is delivered.
 */
export function rollingBackHandle(db: BmsDb): BmsDb {
  const transaction = async <T>(fn: (tx: BmsTx) => Promise<T>): Promise<T> => {
    let result: { value: T } | undefined;
    await withRollback(db, async (tx) => {
      result = { value: await fn(tx) };
      tx.rollback();
    });
    if (result === undefined) {
      throw new Error("rollingBackHandle: the transaction callback never completed");
    }
    return result.value;
  };
  return new Proxy(db, {
    get(target, prop) {
      if (prop === "transaction") {
        return transaction;
      }
      const value = Reflect.get(target, prop) as unknown;
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}

// ---------------------------------------------------------------------------
// The listener under test
// ---------------------------------------------------------------------------

export type ListenerHarness = {
  readonly listener: NotifyListener;
  /** Every row `broadcast` received, in order. */
  readonly received: AlarmListItem[];
  /** Every alarm id `readAlarm` was asked for, in order. */
  readonly reads: string[];
  readonly warnings: string[];
};

/**
 * `AlarmNotifyService.onModuleInit` without Nest: a fresh `pg.Client` on the
 * `bms_auth` URL per attempt, the read on the fleet handle, a recording
 * broadcast. Started here; the caller waits on `connected()` before the
 * first raise, because `NOTIFY` has no replay.
 */
export function openListenerHarness(args: { authUrl: string; fleetDb: BmsDb }): ListenerHarness {
  const received: AlarmListItem[] = [];
  const reads: string[] = [];
  const warnings: string[] = [];
  const listener = createAlarmNotifyListener({
    createClient: () => new Client({ connectionString: args.authUrl }) as unknown as ListenerClient,
    readAlarm: (alarmId) => {
      reads.push(alarmId);
      return readAlarmListItem(args.fleetDb, alarmId);
    },
    broadcast: (alarm) => {
      received.push(alarm);
    },
    logger: {
      log: () => undefined,
      warn: (message) => {
        warnings.push(message);
      },
      error: (message) => {
        warnings.push(message);
      },
    },
    sleep,
  });
  listener.start();
  return { listener, received, reads, warnings };
}

export type AlarmNotifyFixtures = {
  readonly harness: ListenerHarness;
  readonly fleetDb: BmsDb;
  /** The raiser's pool — `bms_tenant`, the role the worker and the API raise as. */
  readonly tenantDb: BmsDb;
  readonly organizationId: string;
  readonly assetId: string;
  /** Raised committed, twice: the positive row and the dedupe row. */
  readonly ruleA: AlarmRaiseRule;
  /** Raised once, inside a transaction that rolls back. */
  readonly ruleB: AlarmRaiseRule;
};

const SETTLE_MS = 750;

// ---------------------------------------------------------------------------
// Row 1 — a committed raise reaches the broadcast
// ---------------------------------------------------------------------------

export type CommittedRaiseOutcome = {
  readonly result: AlarmRaiseResult;
  readonly ruleCode: string;
  /** Rows received during this scenario for the fixture asset. */
  readonly received: AlarmListItem[];
  readonly reads: string[];
};

/** The broadcasts since `from`, for this fixture's asset only. */
function receivedForAsset(ctx: AlarmNotifyFixtures, from: number): AlarmListItem[] {
  return ctx.harness.received.slice(from).filter((row) => row.assetId === ctx.assetId);
}

export async function runCommittedRaise(ctx: AlarmNotifyFixtures): Promise<CommittedRaiseOutcome> {
  const { harness } = ctx;
  await until(() => harness.listener.connected(), { timeoutMs: 5_000, label: "LISTEN bms_alarms is up" });
  const receivedBefore = harness.received.length;
  const readsBefore = harness.reads.length;

  const result = await new AlarmRaiser(ctx.tenantDb).raise(
    ctx.assetId,
    ctx.organizationId,
    ctx.ruleA,
    999_999,
  );
  await until(() => receivedForAsset(ctx, receivedBefore).length > 0, {
    timeoutMs: 5_000,
    label: "the committed raise was broadcast",
  });
  // A settle after the first arrival, so "exactly once" can see a second one.
  await new Promise<void>((resolve) => setTimeout(resolve, SETTLE_MS));
  return {
    result,
    ruleCode: ctx.ruleA.code,
    received: receivedForAsset(ctx, receivedBefore),
    reads: harness.reads.slice(readsBefore),
  };
}

export function assertCommittedRaiseIsBroadcastOnce(outcome: CommittedRaiseOutcome): void {
  assert(outcome.result.raised, "the fixture raise must open an alarm (raised: true)");
  assert(
    outcome.received.length === 1,
    `one committed raise must reach broadcast exactly once, got ${outcome.received.length}`,
  );
}

export function assertBroadcastRowIsTheRaisedAlarm(outcome: CommittedRaiseOutcome): void {
  const row = outcome.received[0];
  assert(row !== undefined, "nothing was broadcast — the row above reddens first");
  assert(
    row.id === outcome.result.alarmId,
    `the broadcast row must be the raised alarm ${String(outcome.result.alarmId)}, got ${row.id}`,
  );
  assert(
    row.ruleKey === outcome.ruleCode,
    `the broadcast row must carry the rule code ${outcome.ruleCode}, got ${String(row.ruleKey)}`,
  );
}

/** The join held: `assetCode` comes from `bms.assets`, not `bms.alarms`. */
export function assertBroadcastRowCarriesTheAssetJoin(outcome: CommittedRaiseOutcome): void {
  const row = outcome.received[0];
  assert(row !== undefined, "nothing was broadcast — the first row reddens first");
  assert(
    typeof row.assetCode === "string" && row.assetCode.length > 0,
    `the broadcast row must carry a non-empty assetCode from the join, got ${JSON.stringify(row.assetCode)}`,
  );
}

/** The positive half of the observable the negative row uses. */
export function assertListenerReadTheCommittedAlarm(outcome: CommittedRaiseOutcome): void {
  assert(
    outcome.result.alarmId !== null && outcome.reads.includes(outcome.result.alarmId),
    `the listener must have asked readAlarm for ${String(outcome.result.alarmId)}; asked for ${JSON.stringify(outcome.reads)}`,
  );
}

// ---------------------------------------------------------------------------
// Row 2 — a raise whose transaction rolls back announces nothing
// ---------------------------------------------------------------------------

export type RolledBackRaiseOutcome = {
  readonly result: AlarmRaiseResult;
  /** Broadcasts for the fixture asset over the settle window. */
  readonly receivedDelta: number;
  /** Every id the listener asked for after the raise, over the settle window. */
  readonly readsAfter: string[];
};

export async function runRolledBackRaise(ctx: AlarmNotifyFixtures): Promise<RolledBackRaiseOutcome> {
  const { harness } = ctx;
  await until(() => harness.listener.connected(), { timeoutMs: 5_000, label: "LISTEN bms_alarms is up" });
  const receivedBefore = harness.received.length;
  const readsBefore = harness.reads.length;

  const result = await new AlarmRaiser(rollingBackHandle(ctx.tenantDb)).raise(
    ctx.assetId,
    ctx.organizationId,
    ctx.ruleB,
    999_999,
  );
  await new Promise<void>((resolve) => setTimeout(resolve, SETTLE_MS));
  return {
    result,
    receivedDelta: receivedForAsset(ctx, receivedBefore).length,
    readsAfter: harness.reads.slice(readsBefore),
  };
}

/** The raise did insert and did reach the `pg_notify` statement — otherwise the absence below is vacuous. */
export function assertRolledBackRaiseDidRaiseInsideItsTransaction(outcome: RolledBackRaiseOutcome): void {
  assert(
    outcome.result.raised && outcome.result.alarmId !== null,
    `the raise must report raised: true with an alarm id from inside its transaction, got ${JSON.stringify(outcome.result)}`,
  );
}

export function assertRolledBackRaiseIsNeverRead(outcome: RolledBackRaiseOutcome): void {
  assert(
    outcome.result.alarmId !== null && !outcome.readsAfter.includes(outcome.result.alarmId),
    `a NOTIFY inside a rolled-back transaction must be dropped with it: the listener must never ` +
      `ask readAlarm for ${String(outcome.result.alarmId)}, but was asked for ${JSON.stringify(outcome.readsAfter)}`,
  );
}

export function assertRolledBackRaiseIsNotBroadcast(outcome: RolledBackRaiseOutcome): void {
  assert(
    outcome.receivedDelta === 0,
    `a rolled-back raise must broadcast nothing within ${SETTLE_MS} ms, got ${outcome.receivedDelta} rows`,
  );
}

// ---------------------------------------------------------------------------
// Row 3 — a deduped raise announces nothing
// ---------------------------------------------------------------------------

export type DedupedRaiseOutcome = {
  readonly result: AlarmRaiseResult;
  /** Broadcasts for the fixture asset over the settle window. */
  readonly receivedDelta: number;
  /** Reads over the settle window that name an alarm on the fixture asset. */
  readonly readsForAsset: number;
};

export async function runDedupedRaise(ctx: AlarmNotifyFixtures): Promise<DedupedRaiseOutcome> {
  const { harness } = ctx;
  const receivedBefore = harness.received.length;
  const readsBefore = harness.reads.length;

  const result = await new AlarmRaiser(ctx.tenantDb).raise(
    ctx.assetId,
    ctx.organizationId,
    ctx.ruleA,
    999_999,
  );
  await new Promise<void>((resolve) => setTimeout(resolve, SETTLE_MS));
  // A deduped raise returns no id to exclude, so the reads are checked
  // against every alarm that exists on the asset — row 1's, and nothing else.
  const onAsset = new Set(
    (
      await ctx.fleetDb.select({ id: alarms.id }).from(alarms).where(eq(alarms.assetId, ctx.assetId))
    ).map((row) => row.id),
  );
  return {
    result,
    receivedDelta: receivedForAsset(ctx, receivedBefore).length,
    readsForAsset: harness.reads.slice(readsBefore).filter((id) => onAsset.has(id)).length,
  };
}

export function assertSecondRaiseOfTheSameRuleIsDeduped(outcome: DedupedRaiseOutcome): void {
  assert(
    !outcome.result.raised && outcome.result.alarmId === null,
    `a second raise of an open (asset, rule) must dedupe (raised: false, alarmId: null), got ${JSON.stringify(outcome.result)}`,
  );
}

export function assertDedupedRaiseNotifiesNobody(outcome: DedupedRaiseOutcome): void {
  assert(
    outcome.receivedDelta === 0 && outcome.readsForAsset === 0,
    `a deduped raise must neither be read nor broadcast within ${SETTLE_MS} ms; ` +
      `got ${outcome.receivedDelta} broadcasts and ${outcome.readsForAsset} reads for the asset`,
  );
}

// ---------------------------------------------------------------------------
// Row 4 — a missing alarm reads as null
// ---------------------------------------------------------------------------

export async function runMissingAlarmRead(ctx: AlarmNotifyFixtures): Promise<AlarmListItem | null> {
  return readAlarmListItem(ctx.fleetDb, randomUUID());
}

export function assertMissingAlarmReadsAsNull(row: AlarmListItem | null): void {
  assert(row === null, `readAlarmListItem of a random uuid must be null, got ${JSON.stringify(row)}`);
}

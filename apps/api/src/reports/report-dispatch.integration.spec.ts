import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import type pg from "pg";

import { createDb } from "@bms/db";
import type { BmsDb } from "@bms/db";

import type { BmsTx } from "../database/tenant-context";
import type { QueueClient, QueueHandle } from "../queue/queue-registry";
import { openIntegrationPool } from "../testing/integration-db-gate";
import { withRollback } from "../testing/with-rollback";
import { ReportDispatchService } from "./report-dispatch.service";

/**
 * `F3.5b` U9 (ADR 0071 decision 8) — the dispatch tick against a real
 * database: what `report-dispatch.service.spec.ts`'s fakes cannot tell you.
 * Whether `enabled AND next_run_at <= $now` claims exactly the due, enabled
 * rows; whether the advance really lands `next_run_at` past `now` and
 * `last_run_at = now`; and whether `FOR UPDATE SKIP LOCKED` skips a row
 * another transaction holds — the sentence "a second dispatcher skips the
 * locked rows" is a measurement of Postgres, not of a fake's call list.
 *
 * **Every case runs inside `withRollback(fleetDb, …)` and calls
 * `tx.rollback()`** (`tests/f3.60-withrollback-cases-roll-back.test.ts`):
 * the fixture rows are inserted on the case's transaction, `tick(tx, now)`
 * opens a savepoint on that same transaction (Drizzle's
 * `NodePgTransaction.transaction` — the §8 measurement: the first case sees
 * its own uncommitted inserts claimed, which a fresh connection could not),
 * and nothing this suite writes outlives the case. The one exception is the
 * locked-row fixture, which must be visible to two connections at once and
 * is therefore committed as `bms_fleet` — **inside the locked-row scenario,
 * immediately before connection A's `FOR UPDATE` opens, and deleted in the
 * scenario's own `finally` with the delete count asserted** (step-5
 * finding). It was once committed in `beforeAll` and deleted in `afterAll`:
 * a committed, enabled row due an hour ago is exactly what the compose
 * worker's `reports-dispatch` tick — same database, every 60 s — claims,
 * and once claimed its `next_run_at` is in the future and the positive
 * control (`assertTheReleasedRowIsEnqueuedOnce`) flakes. CI has no worker,
 * so the flake was invisible there — the §4.6 asymmetry. The exposure is
 * now the milliseconds between the insert and the `FOR UPDATE`, and the row
 * is held or gone for the rest of its life.
 *
 * **Assertions are scoped to this suite's ids, never to totals.** The tick
 * claims every due row it can see — a row another suite committed, or one
 * the running stack's operator created, is claimed and advanced inside the
 * case's transaction and rolled back with it. So "two adds" here means two
 * adds *naming this suite's two due ids*, and the locked-row control asks
 * whether the fixture's id is among the adds, not how many there are.
 *
 * **Why the tick on connection B also runs inside `withRollback`.** Run on
 * the pool directly it would commit its advances — including any foreign
 * due row it claimed — into the shared development database. A savepoint
 * on a rolled-back transaction claims and advances nothing that lasts, and
 * a `FOR UPDATE SKIP LOCKED` inside it still skips what connection A holds.
 *
 * Fixture names are `f3.5b-dispatch-<uuid>` / `f3.5b-locked-<uuid>`; the
 * organization is resolved by code (`ESKOM`), never by a uuid literal.
 */

export function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

export type DispatchIntegrationFixtures = {
  readonly pool: pg.Pool;
  readonly fleetDb: BmsDb;
  readonly eskomId: string;
  readonly close: () => Promise<void>;
};

export type RecordedAdd = {
  readonly jobId: string;
  readonly data: { organizationId: string; scheduleId: string; periodStart: string; periodEnd: string };
};

/** A `QueueClient` with one `reports-render` handle whose `add` records what it received. */
export function recordingClient(): { client: QueueClient; adds: RecordedAdd[] } {
  const adds: RecordedAdd[] = [];
  const handle = {
    add: async (_jobName: string, data: RecordedAdd["data"], jobOpts: { jobId: string }) => {
      adds.push({ jobId: jobOpts.jobId, data });
      return undefined as never;
    },
  } as unknown as QueueHandle;
  const client: QueueClient = {
    kind: "configured",
    prefix: "bms",
    connection: { host: "cache", port: 6380 },
    queues: new Map([["reports-render", handle]]),
    close: async () => undefined,
  };
  return { client, adds };
}

type ScheduleRow = { id: string; next_run_at: Date; last_run_at: Date | null; enabled: boolean };

/** Inserts one fixture schedule on `tx` (or the pool) and returns its id. */
async function insertSchedule(
  executor: Pick<BmsTx, "execute"> | Pick<BmsDb, "execute">,
  eskomId: string,
  prefix: string,
  nextRunAt: Date,
  enabled: boolean,
): Promise<string> {
  const id = randomUUID();
  await executor.execute(sql`
    INSERT INTO bms.report_schedules
      (id, organization_id, name, template_id, formats, cadence, run_at_local, timezone, location_ids, enabled, next_run_at)
    VALUES
      (${id}, ${eskomId}, ${`${prefix}-${id}`}, 'energy_consumption', ARRAY['pdf']::text[], 'daily', '00:30:00', 'Asia/Kolkata', '{}'::uuid[], ${enabled}, ${nextRunAt})
  `);
  return id;
}

async function readSchedules(tx: BmsTx, ids: readonly string[]): Promise<Map<string, ScheduleRow>> {
  // Raw `execute` returns `timestamptz` as the driver's text (the same
  // shape the service reads); the `Date`s are built here for the arithmetic.
  const idList = sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  );
  const result = await tx.execute(sql`
    SELECT id, next_run_at, last_run_at, enabled FROM bms.report_schedules WHERE id IN (${idList})
  `);
  type RawRow = { id: string; next_run_at: string; last_run_at: string | null; enabled: boolean };
  return new Map(
    (result.rows as RawRow[]).map((row) => [
      row.id,
      {
        id: row.id,
        enabled: row.enabled,
        next_run_at: new Date(row.next_run_at),
        last_run_at: row.last_run_at === null ? null : new Date(row.last_run_at),
      },
    ]),
  );
}

export async function openDispatchFixtures(connectionString: string, label: string): Promise<DispatchIntegrationFixtures> {
  const pool = await openIntegrationPool(connectionString, label);
  const fleetDb = createDb(pool);
  const { rows } = await pool.query<{ id: string }>(`SELECT id FROM bms.organizations WHERE code = $1`, ["ESKOM"]);
  const eskomId = rows[0]?.id;
  if (!eskomId) {
    await pool.end();
    throw new Error(`${label}: organization ESKOM is missing — run pnpm db:seed`);
  }
  return {
    pool,
    fleetDb,
    eskomId,
    close: async () => {
      await pool.end();
    },
  };
}

// ---------------------------------------------------------------------------
// dueRowsAreClaimedAndAdvanced
// ---------------------------------------------------------------------------

export type ClaimedFacts = {
  readonly now: Date;
  readonly dueIds: readonly [string, string];
  readonly notDueId: string;
  readonly notDueOriginal: Date;
  readonly adds: readonly RecordedAdd[];
  readonly after: ReadonlyMap<string, ScheduleRow>;
};

/** Two due rows and one not due, inserted on the case's transaction; `tick(tx, now)` runs on a savepoint of it. */
export async function runDueRowsScenario(fx: DispatchIntegrationFixtures): Promise<ClaimedFacts> {
  let facts: ClaimedFacts | undefined;
  await withRollback(fx.fleetDb, async (tx) => {
    const now = new Date();
    const notDueOriginal = new Date(now.getTime() + 3_600_000);
    const dueA = await insertSchedule(tx, fx.eskomId, "f3.5b-dispatch", new Date(now.getTime() - 7_200_000), true);
    const dueB = await insertSchedule(tx, fx.eskomId, "f3.5b-dispatch", new Date(now.getTime() - 3_600_000), true);
    const notDue = await insertSchedule(tx, fx.eskomId, "f3.5b-dispatch", notDueOriginal, true);
    const { client, adds } = recordingClient();
    await new ReportDispatchService(client).tick(tx, now);
    const after = await readSchedules(tx, [dueA, dueB, notDue]);
    facts = { now, dueIds: [dueA, dueB], notDueId: notDue, notDueOriginal, adds, after };
    tx.rollback();
  });
  return facts as ClaimedFacts;
}

export function assertBothDueRowsWereEnqueuedOnce(f: ClaimedFacts): void {
  const mine = f.adds.filter((add) => f.dueIds.includes(add.data.scheduleId)).map((add) => add.data.scheduleId);
  assert(
    mine.length === 2 && new Set(mine).size === 2,
    `expected exactly one add per due fixture row (the savepoint on the case's transaction sees its own inserts — §8's measurement); got ${JSON.stringify(mine)} of ${f.adds.length} adds`,
  );
}

export function assertBothDueRowsAdvancedStrictlyPastNow(f: ClaimedFacts): void {
  const next = f.dueIds.map((id) => f.after.get(id)?.next_run_at.getTime() ?? Number.NaN);
  assert(
    next.every((t) => t > f.now.getTime()),
    `expected both due rows' next_run_at strictly past now=${f.now.toISOString()}; got ${next.map((t) => new Date(t).toISOString()).join(", ")}`,
  );
}

export function assertBothDueRowsStampLastRunAtNow(f: ClaimedFacts): void {
  const last = f.dueIds.map((id) => f.after.get(id)?.last_run_at?.getTime() ?? Number.NaN);
  assert(
    last.every((t) => t === f.now.getTime()),
    `expected both due rows' last_run_at === now (${f.now.toISOString()}); got ${last.map((t) => (Number.isNaN(t) ? "null" : new Date(t).toISOString())).join(", ")}`,
  );
}

export function assertTheNotDueRowIsUntouched(f: ClaimedFacts): void {
  const row = f.after.get(f.notDueId);
  const enqueued = f.adds.some((add) => add.data.scheduleId === f.notDueId);
  assert(
    !enqueued &&
      row !== undefined &&
      row.next_run_at.getTime() === f.notDueOriginal.getTime() &&
      row.last_run_at === null,
    `expected the not-due row neither enqueued nor advanced; enqueued=${enqueued}, next_run_at=${row?.next_run_at.toISOString()}, last_run_at=${String(row?.last_run_at)}`,
  );
}

// ---------------------------------------------------------------------------
// aDisabledRowIsNotClaimed
// ---------------------------------------------------------------------------

export type DisabledFacts = {
  readonly disabledId: string;
  readonly original: Date;
  readonly adds: readonly RecordedAdd[];
  readonly after: ScheduleRow | undefined;
};

export async function runDisabledRowScenario(fx: DispatchIntegrationFixtures): Promise<DisabledFacts> {
  let facts: DisabledFacts | undefined;
  await withRollback(fx.fleetDb, async (tx) => {
    const now = new Date();
    const original = new Date(now.getTime() - 3_600_000);
    const disabledId = await insertSchedule(tx, fx.eskomId, "f3.5b-dispatch", original, false);
    const { client, adds } = recordingClient();
    await new ReportDispatchService(client).tick(tx, now);
    const after = (await readSchedules(tx, [disabledId])).get(disabledId);
    facts = { disabledId, original, adds, after };
    tx.rollback();
  });
  return facts as DisabledFacts;
}

export function assertTheDisabledRowIsNotEnqueued(f: DisabledFacts): void {
  assert(
    !f.adds.some((add) => add.data.scheduleId === f.disabledId),
    `expected no add for the disabled row (enabled = false is outside the claim predicate); adds=${JSON.stringify(f.adds.map((a) => a.data.scheduleId))}`,
  );
}

export function assertTheDisabledRowIsNotAdvanced(f: DisabledFacts): void {
  assert(
    f.after !== undefined && f.after.next_run_at.getTime() === f.original.getTime() && f.after.last_run_at === null,
    `expected the disabled row's next_run_at unchanged and last_run_at null; got next_run_at=${f.after?.next_run_at.toISOString()}, last_run_at=${String(f.after?.last_run_at)}`,
  );
}

// ---------------------------------------------------------------------------
// aRowLockedByAnotherTransactionIsSkipped
// ---------------------------------------------------------------------------

export type LockedFacts = {
  readonly lockedId: string;
  /** The adds of the tick that ran while connection A held the row. */
  readonly addsWhileLocked: readonly RecordedAdd[];
  /** The adds of the same tick after connection A released it — the positive control. */
  readonly addsAfterRelease: readonly RecordedAdd[];
};

/**
 * Connection A: a raw pool client holding `SELECT … FOR UPDATE` in an open
 * transaction. Connection B: the tick, on a rolled-back transaction of its
 * own. The committed fixture (due an hour ago, so both connections see it)
 * is inserted here, immediately before A's lock, and deleted in the outer
 * `finally` — after the release tick, which is the positive control and
 * needs the row still present and still due.
 */
export async function runLockedRowScenario(fx: DispatchIntegrationFixtures): Promise<LockedFacts> {
  const now = new Date();
  const tickOnB = async (): Promise<RecordedAdd[]> => {
    const { client, adds } = recordingClient();
    await withRollback(fx.fleetDb, async (tx) => {
      await new ReportDispatchService(client).tick(tx, now);
      tx.rollback();
    });
    return adds;
  };

  const lockedId = await insertSchedule(fx.fleetDb, fx.eskomId, "f3.5b-locked", new Date(Date.now() - 3_600_000), true);
  try {
    const a = await fx.pool.connect();
    let addsWhileLocked: RecordedAdd[];
    try {
      await a.query("BEGIN");
      await a.query(`SELECT id FROM bms.report_schedules WHERE id = $1 FOR UPDATE`, [lockedId]);
      addsWhileLocked = await tickOnB();
    } finally {
      await a.query("ROLLBACK").catch(() => undefined);
      a.release();
    }
    const addsAfterRelease = await tickOnB();
    return { lockedId, addsWhileLocked, addsAfterRelease };
  } finally {
    const deleted = await fx.pool.query(`DELETE FROM bms.report_schedules WHERE id = $1`, [lockedId]);
    assert(deleted.rowCount === 1, `expected the scenario's delete of the locked fixture to remove exactly 1 row, got ${deleted.rowCount}`);
  }
}

export function assertTheLockedRowIsSkipped(f: LockedFacts): void {
  assert(
    !f.addsWhileLocked.some((add) => add.data.scheduleId === f.lockedId),
    `expected FOR UPDATE SKIP LOCKED to skip the row connection A holds — a second dispatcher claims none of the first's rows (decision 8); adds=${JSON.stringify(f.addsWhileLocked.map((a) => a.data.scheduleId))}`,
  );
}

export function assertTheReleasedRowIsEnqueuedOnce(f: LockedFacts): void {
  const mine = f.addsAfterRelease.filter((add) => add.data.scheduleId === f.lockedId);
  assert(
    mine.length === 1,
    `expected the positive control — the same tick with connection A released — to enqueue the fixture exactly once; got ${mine.length} (the skip above would otherwise pass on a row nothing could ever claim)`,
  );
}

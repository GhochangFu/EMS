import { randomUUID } from "node:crypto";

import { Logger } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type pg from "pg";
import { vi } from "vitest";

import { createDb } from "@bms/db";
import type { BmsDb } from "@bms/db";

import type { BmsTx } from "../database/tenant-context";
import type { QueueClient, QueueHandle } from "../queue/queue-registry";
import { openIntegrationPool } from "../testing/integration-db-gate";
import { withRollback } from "../testing/with-rollback";
import {
  REPORT_DISPATCH_CLAIM_LIMIT,
  REPORT_DISPATCH_POISON_BACKOFF_MS,
  ReportDispatchService,
  type ReportDispatchSummary,
} from "./report-dispatch.service";

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
 * Fixture names are `f3.5b-dispatch-<uuid>` / `f3.5b-locked-<uuid>` /
 * `f3.5b-poison-<uuid>`; the organizations are resolved by code (`ESKOM`,
 * `PHEWB`), never by a uuid literal.
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
  /** The second seeded organization — the tenant the poison rows must not starve (Amendment 2 item 7 C). */
  readonly phewbId: string;
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
  organizationId: string,
  prefix: string,
  nextRunAt: Date,
  enabled: boolean,
): Promise<string> {
  const id = randomUUID();
  await executor.execute(sql`
    INSERT INTO bms.report_schedules
      (id, organization_id, name, template_id, formats, cadence, run_at_local, timezone, location_ids, enabled, next_run_at)
    VALUES
      (${id}, ${organizationId}, ${`${prefix}-${id}`}, 'energy_consumption', ARRAY['pdf']::text[], 'daily', '00:30:00', 'Asia/Kolkata', '{}'::uuid[], ${enabled}, ${nextRunAt})
  `);
  return id;
}

/**
 * `count` poison rows in one multi-row insert — `Not/A_Zone` passes the
 * casing regex and fails `Intl.DateTimeFormat` (`0078` carries no zone
 * CHECK). Returns their ids.
 */
async function insertPoisonSchedules(tx: BmsTx, organizationId: string, count: number, nextRunAt: Date): Promise<string[]> {
  const ids = Array.from({ length: count }, () => randomUUID());
  const rows = sql.join(
    ids.map(
      (id) =>
        sql`(${id}, ${organizationId}, ${`f3.5b-poison-${id}`}, 'energy_consumption', ARRAY['pdf']::text[], 'daily', '00:30:00', 'Not/A_Zone', '{}'::uuid[], true, ${nextRunAt})`,
    ),
    sql`, `,
  );
  await tx.execute(sql`
    INSERT INTO bms.report_schedules
      (id, organization_id, name, template_id, formats, cadence, run_at_local, timezone, location_ids, enabled, next_run_at)
    VALUES ${rows}
  `);
  return ids;
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
  const idByCode = async (code: string): Promise<string> => {
    const { rows } = await pool.query<{ id: string }>(`SELECT id FROM bms.organizations WHERE code = $1`, [code]);
    const id = rows[0]?.id;
    if (!id) {
      await pool.end();
      throw new Error(`${label}: organization ${code} is missing — run pnpm db:seed`);
    }
    return id;
  };
  const eskomId = await idByCode("ESKOM");
  const phewbId = await idByCode("PHEWB");
  return {
    pool,
    fleetDb,
    eskomId,
    phewbId,
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
// poisonRowsAreDeferredSoTheOtherTenantIsClaimedOnTickTwo (Amendment 2 item 7 C)
// ---------------------------------------------------------------------------

export type PoisonFacts = {
  readonly now: Date;
  readonly poisonIds: readonly string[];
  readonly phewbScheduleId: string;
  readonly phewbOrganizationId: string;
  readonly tick1: { adds: readonly RecordedAdd[]; summary: ReportDispatchSummary };
  readonly tick2: { adds: readonly RecordedAdd[]; summary: ReportDispatchSummary };
  /** The poison rows and the PHEWB row after tick 1. */
  readonly afterTick1: ReadonlyMap<string, ScheduleRow>;
  /** The PHEWB row after tick 2. */
  readonly afterTick2: ReadonlyMap<string, ScheduleRow>;
};

/**
 * The 2026-09-22 security sweep's probe, as a case: `REPORT_DISPATCH_CLAIM_LIMIT`
 * ESKOM rows with an unknown zone, overdue, and one valid PHEWB row due one
 * hour ago. `ORDER BY next_run_at LIMIT 200` claims the poison rows first,
 * so **tick 1 cannot reach PHEWB whatever it does with them** — the claim
 * is on **tick 2, at the same `now`**: the deferred rows sit an hour ahead
 * and leave the due set, and PHEWB is claimed. Under the old behaviour
 * (left due) tick 2 re-claims the same 200 and PHEWB starves for ever
 * (measured on the stack with the rows due two hours ago: three ticks,
 * `due=200 enqueued=0 skippedInvalid=200`). Both ticks are savepoints on
 * the case's transaction; everything rolls back. The 200 warns are
 * swallowed by a spy for the run.
 *
 * **The poison rows are due ten years ago, not two hours.** The probe used
 * two hours; here the rows must be the most overdue in the table, because a
 * foreign due row older than them takes one of the 200 slots and one
 * poison row survives tick 1 to head tick 2 — measured on the first run:
 * `report-schedules.integration.spec.ts`, in the same vitest run, parks a
 * committed row a year overdue (`reenableMovesNextRunAtOnARealRow`), and
 * tick 1 answered `due=200 enqueued=1 skippedInvalid=199`.
 */
export async function runPoisonRowsScenario(fx: DispatchIntegrationFixtures): Promise<PoisonFacts> {
  let facts: PoisonFacts | undefined;
  await withRollback(fx.fleetDb, async (tx) => {
    const now = new Date();
    const tenYearsAgo = new Date(now.getTime() - 10 * 365 * 24 * 3_600_000);
    const poisonIds = await insertPoisonSchedules(tx, fx.eskomId, REPORT_DISPATCH_CLAIM_LIMIT, tenYearsAgo);
    const phewbScheduleId = await insertSchedule(tx, fx.phewbId, "f3.5b-dispatch", new Date(now.getTime() - 3_600_000), true);
    const warn = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    try {
      const first = recordingClient();
      const summary1 = await new ReportDispatchService(first.client).tick(tx, now);
      const afterTick1 = await readSchedules(tx, [...poisonIds, phewbScheduleId]);
      const second = recordingClient();
      const summary2 = await new ReportDispatchService(second.client).tick(tx, now);
      const afterTick2 = await readSchedules(tx, [phewbScheduleId]);
      facts = {
        now,
        poisonIds,
        phewbScheduleId,
        phewbOrganizationId: fx.phewbId,
        tick1: { adds: first.adds, summary: summary1 },
        tick2: { adds: second.adds, summary: summary2 },
        afterTick1,
        afterTick2,
      };
    } finally {
      warn.mockRestore();
    }
    tx.rollback();
  });
  return facts as PoisonFacts;
}

/**
 * After tick 1 every poison row is past now. Asserted on all 200 ids, not
 * on the summary: a foreign due row older than the fixtures would steal one
 * slot of the claim, and a survivor would head tick 2 silently.
 */
export function assertEveryPoisonRowIsDeferredPastNowAfterTickOne(f: PoisonFacts): void {
  const stillDue = f.poisonIds.filter((id) => {
    const row = f.afterTick1.get(id);
    return row === undefined || !(row.next_run_at.getTime() > f.now.getTime());
  });
  assert(
    stillDue.length === 0,
    `expected all ${f.poisonIds.length} poison rows deferred past now=${f.now.toISOString()} after tick 1 (item 7 C); ${stillDue.length} still due; tick 1 summary ${JSON.stringify(f.tick1.summary)}`,
  );
}

/** The deferral is exactly one hour; `last_run_at` stays null and `enabled` true — the row never ran and nobody disabled it. */
export function assertPoisonRowsAreDeferredExactlyOneHourAndOtherwiseUntouched(f: PoisonFacts): void {
  const expected = f.now.getTime() + REPORT_DISPATCH_POISON_BACKOFF_MS;
  const wrong = f.poisonIds.filter((id) => {
    const row = f.afterTick1.get(id);
    return row === undefined || row.next_run_at.getTime() !== expected || row.last_run_at !== null || !row.enabled;
  });
  assert(
    wrong.length === 0,
    `expected every poison row at next_run_at = now + 1h (${new Date(expected).toISOString()}), last_run_at null, enabled; ${wrong.length} differ`,
  );
}

/** Tick 1's negative control: the claim was full of the poison rows, and PHEWB was not reached — so tick 2 is where the claim is decided. */
export function assertTickOneSkippedThePoisonRowsAndDidNotReachPhewb(f: PoisonFacts): void {
  const phewbEnqueued = f.tick1.adds.some((add) => add.data.scheduleId === f.phewbScheduleId);
  assert(
    f.tick1.summary.due === REPORT_DISPATCH_CLAIM_LIMIT && f.tick1.summary.skippedInvalid >= 1 && !phewbEnqueued,
    `expected tick 1's claim full (due = ${REPORT_DISPATCH_CLAIM_LIMIT}), poison rows skipped and PHEWB not reached (ORDER BY next_run_at); got ${JSON.stringify(f.tick1.summary)}, phewbEnqueued=${phewbEnqueued}`,
  );
}

/** Tick 2, same `now`: the PHEWB row is enqueued exactly once, for PHEWB, and advanced past now — the deferred rows left the due set. */
export function assertTickTwoEnqueuesThePhewbRowOnceAndAdvancesIt(f: PoisonFacts): void {
  const mine = f.tick2.adds.filter((add) => add.data.scheduleId === f.phewbScheduleId);
  const row = f.afterTick2.get(f.phewbScheduleId);
  assert(
    mine.length === 1 && mine[0]?.data.organizationId === f.phewbOrganizationId,
    `expected tick 2 to enqueue the PHEWB row exactly once for PHEWB (the poison rows are deferred, not re-claimed — item 7 C); got ${mine.length} of ${f.tick2.adds.length} adds; summary ${JSON.stringify(f.tick2.summary)}`,
  );
  assert(
    row !== undefined && row.next_run_at.getTime() > f.now.getTime() && row.last_run_at?.getTime() === f.now.getTime(),
    `expected the PHEWB row advanced past now with last_run_at = now; got next_run_at=${row?.next_run_at.toISOString()}, last_run_at=${String(row?.last_run_at)}`,
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

import "reflect-metadata";
import { Logger } from "@nestjs/common";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { vi } from "vitest";

import type { BmsDb } from "@bms/db";

import type { QueueClient, QueueHandle } from "../queue/queue-registry";
import { renderJobId } from "../queue/reports-render";
import {
  REPORT_DISPATCH_CLAIM_LIMIT,
  REPORT_DISPATCH_POISON_BACKOFF_MS,
  ReportDispatchService,
  type ReportDispatchSummary,
} from "./report-dispatch.service";
import { nextRunAt, periodFor } from "./report-period";

/**
 * `F3.5b` U9 (ADR 0071 decision 8; plan R-6, R-8, owner-ruled Q-3) — the
 * dispatch tick over fakes. The `.test.ts` wrapper runs one claim per
 * `it()`; `report-dispatch.integration.spec.ts` proves `FOR UPDATE SKIP
 * LOCKED` against a real database, which no fake can.
 *
 * **What the fakes record, in one shared log.** The `fleetDb` fake's
 * `transaction` hands the case a `tx` fake whose `execute` renders the
 * statement through `PgDialect` (the `report-render.service.spec.ts`
 * shape) and logs `select` or `update` by the text; the `QueueClient` fake
 * carries one `reports-render` handle whose `add` logs `add` with the job
 * id and payload it received. The order row reads that one log, so
 * "enqueue before advance" is a measured sequence, not two counts.
 *
 * **The period is the row's, the advance is now's (R-8).** Every fixture
 * row is due *before* `NOW`, and the expected period is computed from the
 * row's `next_run_at` — a dispatcher that computed it from `now` would
 * produce a different `periodEnd` for the three-days-late row and redden
 * the late-tick row's job id.
 *
 * **The poison row (R-6, changed by Amendment 2 item 7 C).** `"Not/AZone"`
 * passes the casing regex and fails `Intl.DateTimeFormat`, so `periodFor`
 * throws `ReportPeriodError`; the row is counted, warned once by id and
 * error name — never by zone string (§9.6: an operator-typed value stays
 * out of the log) — and **deferred**: one update sets `next_run_at = now +
 * REPORT_DISPATCH_POISON_BACKOFF_MS` and touches nothing else. The old
 * "left due" behaviour pinned the head of the `LIMIT 200` claim and
 * starved every other tenant (the security sweep's 200-row probe).
 */

export function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

export const NOW = new Date("2026-09-21T10:00:00.000Z");
export const ORG_A = "11111111-1111-4111-8111-111111111111";
export const ORG_B = "12121212-1212-4121-8121-121212121212";
export const SCHEDULE_A = "44444444-4444-4444-8444-444444444444";
export const SCHEDULE_B = "45454545-4545-4454-8454-454545454545";
export const POISON_ID = "46464646-4646-4464-8464-464646464646";

/**
 * The row shape Drizzle's raw `execute` hands back: `next_run_at` is the
 * driver's `timestamptz` **text** (`2026-09-20 19:00:00+00`), not a `Date`
 * — Drizzle's node-postgres session parses `TIMESTAMPTZ` to the string
 * unchanged, and the first integration run warned `RangeError` on every
 * real row while a `Date`-carrying fake passed. The fixture carries the
 * text form so the fake exercises the driver's shape; `dueInstant` is the
 * spec's own reading of it for the expectations.
 */
export type DueRowFixture = {
  id: string;
  organization_id: string;
  cadence: "daily" | "weekly" | "monthly";
  run_at_local: string;
  timezone: string;
  next_run_at: string;
};

/** The fixture's due instant, read the way `pg` text is read. */
export function dueInstant(row: DueRowFixture): Date {
  return new Date(row.next_run_at);
}

/** Two due rows in two organizations, both due before `NOW`, in `next_run_at` order. */
export const DUE_ROWS: readonly DueRowFixture[] = [
  {
    id: SCHEDULE_A,
    organization_id: ORG_A,
    cadence: "daily",
    run_at_local: "00:30:00",
    timezone: "Asia/Kolkata",
    // 00:30 IST on 2026-09-21 — due 15 hours before NOW.
    next_run_at: "2026-09-20 19:00:00+00",
  },
  {
    id: SCHEDULE_B,
    organization_id: ORG_B,
    cadence: "weekly",
    run_at_local: "07:00:00",
    timezone: "Europe/London",
    // Monday 07:00 BST on 2026-09-21 — due four hours before NOW.
    next_run_at: "2026-09-21 06:00:00+00",
  },
];

export const POISON_ROW: DueRowFixture = {
  id: POISON_ID,
  organization_id: ORG_A,
  cadence: "daily",
  run_at_local: "00:30:00",
  timezone: "Not/AZone",
  next_run_at: "2026-09-20 19:00:00+00",
};

/** Three days overdue: the tick covers the day before the due instant, not the day before now. */
export const LATE_ROW: DueRowFixture = {
  id: SCHEDULE_A,
  organization_id: ORG_A,
  cadence: "daily",
  run_at_local: "00:30:00",
  timezone: "Asia/Kolkata",
  next_run_at: "2026-09-17 19:00:00+00",
};

export type RecordedAdd = {
  readonly jobId: string;
  readonly data: { organizationId: string; scheduleId: string; periodStart: string; periodEnd: string };
};

export type RecordedUpdate = { readonly sql: string; readonly params: unknown[] };

export type DispatchHarness = {
  readonly service: ReportDispatchService;
  /** `select`, `add`, `update` — one entry per call, in call order. */
  readonly calls: string[];
  /** The claim's rendered SQL and parameters, one entry per select. */
  readonly selects: RecordedUpdate[];
  readonly adds: RecordedAdd[];
  readonly updates: RecordedUpdate[];
  readonly warns: string[];
  readonly fleetDb: BmsDb;
};

const dialect = new PgDialect();

export function makeHarness(
  rows: readonly DueRowFixture[],
  opts: { addRejects?: Error } = {},
): DispatchHarness {
  const calls: string[] = [];
  const selects: RecordedUpdate[] = [];
  const adds: RecordedAdd[] = [];
  const updates: RecordedUpdate[] = [];
  const warns: string[] = [];

  const tx = {
    execute: async (statement: unknown) => {
      const rendered = dialect.sqlToQuery(statement as SQL);
      const head = rendered.sql.trimStart().slice(0, 6).toUpperCase();
      if (head === "SELECT") {
        calls.push("select");
        selects.push({ sql: rendered.sql, params: rendered.params });
        // The fake honours a bound `LIMIT $n`: the parameter that follows the
        // keyword bounds the rows returned, as Postgres would.
        const limitMatch = /LIMIT \$(\d+)/i.exec(rendered.sql);
        const limit = limitMatch === null ? rows.length : Number(rendered.params[Number(limitMatch[1]) - 1]);
        return { rows: rows.slice(0, limit).map((row) => ({ ...row })) };
      }
      if (head === "UPDATE") {
        calls.push("update");
        updates.push({ sql: rendered.sql, params: rendered.params });
        return { rows: [] };
      }
      throw new Error(`unexpected statement in the dispatch tick: ${rendered.sql}`);
    },
  };
  const fleetDb = {
    transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx),
  } as unknown as BmsDb;

  const handle = {
    add: async (_jobName: string, data: RecordedAdd["data"], jobOpts: { jobId: string }) => {
      calls.push("add");
      if (opts.addRejects) {
        throw opts.addRejects;
      }
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

  const service = new ReportDispatchService(client);
  vi.spyOn(Logger.prototype, "warn").mockImplementation((message: unknown) => {
    warns.push(String(message));
  });
  return { service, calls, selects, adds, updates, warns, fleetDb };
}

/** The `next_run_at` parameter of a recorded update: the first `Date` parameter. */
function nextRunAtOf(update: RecordedUpdate): Date {
  const found = update.params.find((p): p is Date => p instanceof Date);
  if (found === undefined) {
    throw new Error(`expected a Date parameter on the update, got ${JSON.stringify(update.params)}`);
  }
  return found;
}

/** Whether a recorded update names the given schedule id among its parameters. */
function updateNames(update: RecordedUpdate, id: string): boolean {
  return update.params.includes(id);
}

/** Item 7 C: the deferral is written in the post-loop phase with the advances — after every add. */
export function assertPoisonDeferralIsWrittenAfterEveryAdd(h: DispatchHarness): void {
  const expected = ["select", "add", "update", "update"];
  assert(
    JSON.stringify(h.calls) === JSON.stringify(expected),
    `expected [select, add, update, update] — the deferral joins the advances after the adds, never between them; got ${h.calls.join(", ")}`,
  );
}

export function assertRecordedOrderIsSelectThenAddsThenUpdates(h: DispatchHarness): void {
  const expected = ["select", "add", "add", "update", "update"];
  assert(
    JSON.stringify(h.calls) === JSON.stringify(expected),
    `expected the tick to record ${expected.join(", ")} — enqueue before advance (decision 8); got ${h.calls.join(", ")}`,
  );
}

export function assertEachAddCarriesTheRowsPeriodAndJobId(h: DispatchHarness): void {
  const expected = DUE_ROWS.map((row) => {
    const period = periodFor(row.cadence, dueInstant(row), row.timezone);
    return JSON.stringify({
      jobId: renderJobId(row.id, period.periodEnd),
      data: { organizationId: row.organization_id, scheduleId: row.id, ...period },
    });
  });
  const actual = h.adds.map((add) => JSON.stringify(add));
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `expected each add to carry renderJobId(id, periodEnd) and the period of the row's next_run_at (R-8); expected ${expected.join(" | ")}, got ${actual.join(" | ")}`,
  );
}

export function assertEachUpdateAdvancesToNextRunAtFromNow(h: DispatchHarness): void {
  const expected = DUE_ROWS.map((row) =>
    nextRunAt({ cadence: row.cadence, runAtLocal: row.run_at_local, timezone: row.timezone }, NOW).toISOString(),
  );
  const actual = h.updates.map((update) => nextRunAtOf(update).toISOString());
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `expected each update's next_run_at to equal nextRunAt(row, now) (R-8); expected ${expected.join(", ")}, got ${actual.join(", ")}`,
  );
}

/**
 * Step-5 security finding: the claim is bounded. `REPORT_DISPATCH_CLAIM_LIMIT`
 * rows are claimed per tick; the rest stay due for the next tick, so the
 * lock-holding transaction is bounded across the Redis round trips.
 */
export function assertTheClaimCarriesTheLimit(h: DispatchHarness): void {
  const select = h.selects[0];
  assert(
    select !== undefined && /\bLIMIT\b/i.test(select.sql) && select.params.includes(REPORT_DISPATCH_CLAIM_LIMIT),
    `expected the claim to carry LIMIT bound to REPORT_DISPATCH_CLAIM_LIMIT (${REPORT_DISPATCH_CLAIM_LIMIT}); got ${JSON.stringify(select)}`,
  );
}

/** One more due row than the limit; the fake honours the bound `LIMIT`, so `due` counts the claimed rows only. */
export function overTheLimitRows(): DueRowFixture[] {
  const base = DUE_ROWS[0] as DueRowFixture;
  return Array.from({ length: REPORT_DISPATCH_CLAIM_LIMIT + 1 }, (_, index) => ({
    ...base,
    id: `${String(index).padStart(8, "0")}-0000-4000-8000-000000000000`,
  }));
}

export function assertDueCountsTheClaimedRowsOnly(summary: ReportDispatchSummary): void {
  assert(
    summary.due === REPORT_DISPATCH_CLAIM_LIMIT && summary.enqueued === REPORT_DISPATCH_CLAIM_LIMIT,
    `expected due and enqueued to equal the claim limit ${REPORT_DISPATCH_CLAIM_LIMIT} with one row over it; got due=${summary.due} enqueued=${summary.enqueued}`,
  );
}

export function assertSummaryCountsTwoDueTwoEnqueued(summary: ReportDispatchSummary): void {
  const shape = { due: summary.due, enqueued: summary.enqueued, skippedInvalid: summary.skippedInvalid };
  const expected = { due: 2, enqueued: 2, skippedInvalid: 0 };
  assert(
    JSON.stringify(shape) === JSON.stringify(expected),
    `expected the summary ${JSON.stringify(expected)}, got ${JSON.stringify(shape)}`,
  );
}

export function assertPoisonRowIsCountedSkippedInvalid(summary: ReportDispatchSummary): void {
  assert(
    summary.skippedInvalid === 1,
    `expected skippedInvalid === 1 for the row whose zone is unknown (R-6), got ${summary.skippedInvalid}`,
  );
}

/**
 * Amendment 2 item 7 C: the poison row is deferred, not left due. Exactly one
 * update names it; its `next_run_at` parameter is `now +
 * REPORT_DISPATCH_POISON_BACKOFF_MS` (one hour), and the statement carries
 * two parameters and no `last_run_at` — the healthy row's advance carries
 * four (`next_run_at`, `last_run_at`, `updated_at`, `id`).
 */
export function assertPoisonRowIsDeferredAnHourAndNothingElseMoves(h: DispatchHarness): void {
  const mine = h.updates.filter((update) => updateNames(update, POISON_ID));
  assert(mine.length === 1, `expected exactly one UPDATE naming the poison row (deferred, item 7 C); got ${mine.length}`);
  const update = mine[0] as RecordedUpdate;
  const expected = new Date(NOW.getTime() + REPORT_DISPATCH_POISON_BACKOFF_MS).toISOString();
  const actual = nextRunAtOf(update).toISOString();
  assert(actual === expected, `expected the poison row's next_run_at = now + 1h (${expected}); got ${actual}`);
  assert(
    update.params.length === 2 && !/last_run_at|updated_at|enabled/.test(update.sql),
    `expected the deferral to set next_run_at only (two parameters, no last_run_at/updated_at/enabled); got ${update.sql} with ${update.params.length} parameters`,
  );
}

/** The one-hour backoff is a module constant, not a magic number in the tick. */
export function assertTheBackoffIsOneHour(): void {
  assert(REPORT_DISPATCH_POISON_BACKOFF_MS === 3_600_000, `expected REPORT_DISPATCH_POISON_BACKOFF_MS === 3_600_000; got ${REPORT_DISPATCH_POISON_BACKOFF_MS}`);
}

export function assertPoisonRowWarnsOnceWithIdAndErrorName(h: DispatchHarness): void {
  const matching = h.warns.filter((w) => w.includes(POISON_ID) && w.includes("ReportPeriodError"));
  assert(
    matching.length === 1,
    `expected exactly one warn naming the schedule id and ReportPeriodError, got ${matching.length}; warns=${JSON.stringify(h.warns)}`,
  );
}

export function assertPoisonRowWarnNeverNamesTheZone(h: DispatchHarness): void {
  assert(
    !h.warns.some((w) => w.includes("Not/AZone")),
    `expected no warn to carry the zone string (§9.6: an operator-typed value stays out of the log); warns=${JSON.stringify(h.warns)}`,
  );
}

export function assertTheOtherRowIsStillEnqueued(h: DispatchHarness): void {
  assert(
    h.adds.length === 1 && h.adds[0]?.data.scheduleId === SCHEDULE_A,
    `expected the healthy row to be enqueued once beside the poison row, got adds=${JSON.stringify(h.adds)}`,
  );
}

export function assertTickRejectedWithTheEnqueueError(rejection: unknown, expected: Error): void {
  assert(
    rejection === expected,
    `expected tick to reject with the enqueue error by identity (an enqueue throw aborts the tick, R-6), got ${String(rejection)}`,
  );
}

export function assertNoUpdateWasRecordedAfterTheEnqueueFailure(h: DispatchHarness): void {
  assert(
    h.updates.length === 0,
    `expected zero updates when an enqueue rejected — the rows stay due; got ${h.updates.length}`,
  );
}

/** A driver timestamp that does not parse is a contract failure, not a schedule defect: the tick aborts (R-6 counts only the row-owned throws). */
export const UNPARSABLE_ROW: DueRowFixture = { ...(DUE_ROWS[0] as DueRowFixture), next_run_at: "not-a-timestamp" };

export function assertUnparsableTimestampRejectsTheTick(rejection: unknown): void {
  assert(
    rejection instanceof Error && rejection.message.includes(SCHEDULE_A) && rejection.message.includes("did not parse as an instant"),
    `expected tick to reject naming the schedule id and "did not parse as an instant" — instantOf runs outside the per-row try, so a driver contract failure aborts rather than being counted skippedInvalid; got ${String(rejection)}`,
  );
}

export function assertUnparsableTimestampEnqueuesAndAdvancesNothing(h: DispatchHarness): void {
  assert(
    h.adds.length === 0 && h.updates.length === 0,
    `expected zero adds and zero updates when next_run_at did not parse; adds=${h.adds.length}, updates=${h.updates.length}`,
  );
}

export function assertLateTickEnqueuesOncePeriodBeforeTheDueInstant(h: DispatchHarness): void {
  const period = periodFor(LATE_ROW.cadence, dueInstant(LATE_ROW), LATE_ROW.timezone);
  const expected = JSON.stringify([{ jobId: renderJobId(LATE_ROW.id, period.periodEnd), data: { organizationId: ORG_A, scheduleId: SCHEDULE_A, ...period } }]);
  const actual = JSON.stringify(h.adds);
  assert(
    actual === expected && period.periodEnd < "2026-09-18",
    `expected one add for the period ending before the due instant (2026-09-17 IST, not the day before now); expected ${expected}, got ${actual}`,
  );
}

export function assertLateTickAdvancesStrictlyPastNow(h: DispatchHarness): void {
  const next = h.updates.map((update) => nextRunAtOf(update).getTime());
  assert(
    next.length === 1 && (next[0] as number) > NOW.getTime(),
    `expected one update whose next_run_at is strictly after now (missed periods are skipped, Q-3); got ${next.map((t) => new Date(t).toISOString()).join(", ")}`,
  );
}

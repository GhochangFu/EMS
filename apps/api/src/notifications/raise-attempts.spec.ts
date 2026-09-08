import {
  RAISE_ATTEMPT_BATCH_SIZE,
  loadRaiseAttempts,
  raiseAttemptBatches,
} from "./raise-attempts";
import type { RaiseKeyRef } from "./raise-retry";

/**
 * `F3.51` review (Medium) — `loadRaiseAttempts`' batching, over a fake
 * database.
 *
 * The read bound roughly two parameters per eligible alarm — one `alarm_id`
 * and one `dedupe_key`, the organizations de-duplicating to one per tenant —
 * in ONE statement. Postgres' extended protocol carries at most 65535 bind
 * parameters, so the statement failed outright at roughly 32 700 eligible
 * alarms, and `loadActiveAlarms` spans every tenant: one noisy customer's
 * alarm volume disabled raise retry for the whole fleet, because the phase's
 * `catch` returned from the phase rather than from one read. It is chunked
 * now, and a batch that fails costs only the alarms in that batch.
 *
 * **A fake database, not the real one.** What is asserted here is the SHAPE of
 * the reads — how many statements, which refs each one binds, and what a
 * failing one costs — and none of that needs a socket. That the `WHERE` really
 * filters (a `skipped_rate_limited` row survives it, another organization's
 * row does not, a step's key never joins the set) is
 * `raise-attempts.integration.spec.ts`'s claim and stays there.
 *
 * Assertions live here; the sibling `.test` is the Vitest entry point
 * (ADR 0014).
 */

type Db = Parameters<typeof loadRaiseAttempts>[0];

type LedgerRow = {
  alarmId: string | null;
  organizationId: string;
  channelId: string;
  status: string;
  attemptedAt: Date;
};

const AT = new Date("2026-09-09T00:00:00.000Z");

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** `count` refs, spread over `organizations` tenants — one distinct key per alarm. */
function refs(count: number, organizations = 1): RaiseKeyRef[] {
  return Array.from({ length: count }, (_, index) => ({
    alarmId: `alarm-${index}`,
    organizationId: `org-${index % organizations}`,
    dedupeKey: `RULE-${index}:alarm-${index}:warning`,
  }));
}

function row(alarmId: string | null, overrides: Partial<LedgerRow> = {}): LedgerRow {
  return {
    alarmId,
    organizationId: "org-0",
    channelId: "c1",
    status: "failed",
    attemptedAt: AT,
    ...overrides,
  };
}

/**
 * A database that answers each `select(...).from(...).where(...)` from
 * `answers(index)` — a row list, or an `Error` to reject that statement with.
 */
function fakeDb(answers: (index: number) => LedgerRow[] | Error): {
  db: Db;
  statements: () => number;
} {
  let statements = 0;
  const db = {
    select: () => ({
      from: () => ({
        where: () => {
          const answer = answers(statements);
          statements += 1;
          return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
        },
      }),
    }),
  };
  return { db: db as unknown as Db, statements: () => statements };
}

export async function runRaiseAttemptsBatchTests(): Promise<void> {
  await testTheRefsAreChunked();
  await testABatchBindsOnlyItsOwnRefs();
  await testAFailingBatchDoesNotStopTheOthers();
  await testEmptyRefsIssueNoStatement();
  await testANullAlarmIdIsDropped();
  testTheBatchFitsThePostgresParameterLimit();
}

/**
 * B1 — more refs than one batch is more than one statement.
 *
 * **Mutation:** deleting the loop and binding every ref in one statement →
 * one statement, red. This is the case the whole fix exists for.
 */
async function testTheRefsAreChunked(): Promise<void> {
  const count = RAISE_ATTEMPT_BATCH_SIZE * 2 + 1;
  const { db, statements } = fakeDb(() => []);
  await loadRaiseAttempts(db, refs(count));
  assert(
    statements() === 3,
    `${count} refs at a batch size of ${RAISE_ATTEMPT_BATCH_SIZE} must be 3 statements, got ${statements()}`,
  );
}

/**
 * B2 — each batch's three `IN` lists come from THAT batch, de-duplicated.
 *
 * **Mutation:** chunking the `alarm_id` list while leaving the other two built
 * from the whole `refs` array — the shape that looks like it works and still
 * binds 65535 parameters. Batch 2's alarm id would appear in batch 1's key
 * list, and the length assertions below go red.
 */
async function testABatchBindsOnlyItsOwnRefs(): Promise<void> {
  const all = refs(RAISE_ATTEMPT_BATCH_SIZE + 3, 2);
  const batches = raiseAttemptBatches(all);
  assert(batches.length === 2, `two batches, got ${batches.length}`);

  const [first, second] = batches;
  assert(first !== undefined && second !== undefined, "both batches exist");
  assert(
    first?.alarmIds.length === RAISE_ATTEMPT_BATCH_SIZE,
    `the first batch binds ${RAISE_ATTEMPT_BATCH_SIZE} alarm ids, got ${String(first?.alarmIds.length)}`,
  );
  assert(
    second?.alarmIds.length === 3,
    `the second batch binds the remaining 3 alarm ids, got ${String(second?.alarmIds.length)}`,
  );
  assert(
    first?.dedupeKeys.length === RAISE_ATTEMPT_BATCH_SIZE && second?.dedupeKeys.length === 3,
    "the key list is chunked with the alarm list, not left whole",
  );
  const lastAlarmId = all[all.length - 1]?.alarmId ?? "";
  assert(
    !(first?.alarmIds.includes(lastAlarmId) ?? true),
    "the first batch must not bind a ref that belongs to the second",
  );
  assert(
    second?.alarmIds.includes(lastAlarmId) === true,
    "the second batch binds the tail of the ref list",
  );
  // The organizations de-duplicate: two tenants over 503 refs is two ids, not
  // 503. This is why the parameter cost is ~2 per alarm rather than 3.
  assert(
    first?.organizationIds.length === 2,
    `two tenants de-duplicate to two organization ids, got ${String(first?.organizationIds.length)}`,
  );
}

/**
 * B3 — a failing batch costs only its own alarms.
 *
 * The absence (the middle batch's alarms are undecided) is paired on the same
 * fixture with the positives that prove the read went on: the first and third
 * batches' rows come back, their alarm ids are NOT in `unread`, and the third
 * statement was issued at all.
 *
 * **Mutation:** re-raising out of the batch loop, which is what the phase did
 * before this fix → no rows, every alarm unread, and the third statement never
 * issued. Red on all three positives.
 */
async function testAFailingBatchDoesNotStopTheOthers(): Promise<void> {
  const all = refs(RAISE_ATTEMPT_BATCH_SIZE * 2 + 2);
  const firstOfBatchTwo = all[RAISE_ATTEMPT_BATCH_SIZE]?.alarmId ?? "";
  const { db, statements } = fakeDb((index) => {
    if (index === 1) return new Error("too many bind parameters");
    return [row(index === 0 ? "alarm-0" : "alarm-1000")];
  });

  const read = await loadRaiseAttempts(db, all);

  assert(statements() === 3, `every batch is still attempted, got ${statements()} statements`);
  assert(
    read.rows.map((r) => r.alarmId).join(",") === "alarm-0,alarm-1000",
    `the batches that returned still give their rows, got [${read.rows.map((r) => r.alarmId).join(",")}]`,
  );
  assert(
    read.reasons.length === 1 && (read.reasons[0] ?? "").includes("too many bind parameters"),
    `one reason, naming the cause, got [${read.reasons.join(" | ")}]`,
  );
  assert(
    read.unread.size === RAISE_ATTEMPT_BATCH_SIZE,
    `only the failing batch's alarms are undecided, got ${read.unread.size}`,
  );
  assert(read.unread.has(firstOfBatchTwo), "the failing batch's alarms are undecided");
  assert(!read.unread.has("alarm-0"), "the first batch's alarms are decided");
  assert(
    !read.unread.has(all[all.length - 1]?.alarmId ?? ""),
    "the third batch's alarms are decided",
  );
}

/** B4 — empty refs read nothing at all (drizzle's `inArray` on `[]` is not a production surprise). */
async function testEmptyRefsIssueNoStatement(): Promise<void> {
  const { db, statements } = fakeDb(() => []);
  const read = await loadRaiseAttempts(db, []);
  assert(statements() === 0, `empty refs issue no statement, got ${statements()}`);
  assert(
    read.rows.length === 0 && read.unread.size === 0 && read.reasons.length === 0,
    "empty refs decide nothing and fail nothing",
  );
}

/**
 * B5 — `alarm_id` is nullable on the column (a send test has no alarm), so a
 * `null` row is dropped rather than cast. Paired with the row beside it that
 * IS kept, so the case cannot pass by returning nothing at all.
 */
async function testANullAlarmIdIsDropped(): Promise<void> {
  const { db } = fakeDb(() => [row(null), row("alarm-0")]);
  const read = await loadRaiseAttempts(db, refs(1));
  assert(
    read.rows.length === 1 && read.rows[0]?.alarmId === "alarm-0",
    `the null-alarm row is dropped and the real one kept, got ${JSON.stringify(read.rows)}`,
  );
}

/**
 * B6 — the batch size against the limit it exists for.
 *
 * Postgres' extended protocol binds at most 65535 parameters per statement.
 * One batch binds at most one `alarm_id` and one `dedupe_key` per ref plus one
 * `organization_id` per distinct tenant in it — three per ref is the pessimal
 * bound. **Mutation:** raising the batch size to 30 000 "because the old code
 * managed 32 000" → red, with the arithmetic in the message.
 */
function testTheBatchFitsThePostgresParameterLimit(): void {
  const worstCaseParameters = RAISE_ATTEMPT_BATCH_SIZE * 3;
  assert(
    worstCaseParameters < 65_535,
    `a batch binds at most ${worstCaseParameters} parameters, and Postgres allows 65535`,
  );
}

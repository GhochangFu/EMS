import { expect } from "vitest";

import {
  type AppliedMigrationRow,
  type JournalStamp,
  type StampQueryable,
  planJournalResync,
  resolveMigrationUrl,
  resyncJournalStamps,
} from "./migrate";

/** Vitest entry point lives in the sibling `.test.ts` (ADR 0014). */

/**
 * ADR 0045 decision 3. The migration chain is history and is replayed whole on
 * a fresh deployment, so the runner needs `SUPERUSER`: `0039:33` issues
 * `ALTER ROLE bms_fleet BYPASSRLS`, and `0000` needs the Timescale extension
 * already present.
 *
 * What this catches is the quiet direction of that requirement. A fallback to
 * `DATABASE_URL` would keep working on every existing deployment — the chain is
 * already applied, so nothing replays — and fail only the next time someone
 * brings up an empty database, which is the moment furthest from the change.
 */
export function assertMigrationsDemandTheSuperuserUrl(): void {
  expect(resolveMigrationUrl({ DATABASE_URL_SUPERUSER: "postgres://s/db" })).toBe(
    "postgres://s/db",
  );
}

export function assertMigrationsNeverFallBackToTheOwnerUrl(): void {
  expect(() => resolveMigrationUrl({ DATABASE_URL: "postgres://owner/db" })).toThrow(
    "DATABASE_URL_SUPERUSER",
  );
  expect(() => resolveMigrationUrl({})).toThrow("DATABASE_URL_SUPERUSER");
}

/**
 * `F4.94` — the journal re-sync pre-flight.
 *
 * The defect it repairs is silent. Drizzle applies a file only when
 * `Number(lastDbMigration.created_at) < migration.folderMillis`, so a row in
 * `drizzle.__drizzle_migrations` stamped ahead of the wall clock makes every
 * honestly stamped migration that follows it sort *below* the newest applied
 * one, and drizzle skips it without an error. These cases pin the two halves
 * of the repair: the pure plan, which decides what to re-stamp, and the thin
 * runner, which issues the guarded statements and the operator's output.
 *
 * No filesystem and no database. The fake client records `{ text, values }`
 * and answers on the query text, so what is asserted is the SQL itself.
 */

/**
 * A stand-in for a sha256 migration hash. The pre-flight only ever slices the
 * first twelve characters, so the prefixes here are the two real ones measured
 * on the live database (`0061` and `0062`) and one that no journal describes.
 */
const hashOf = (prefix: string): string => prefix.padEnd(64, "0");

const HASH_0061 = hashOf("d37dd5d54637");
const HASH_0062 = hashOf("171fa9ac14b4");
const HASH_STRAY = hashOf("beefbeefbeef");

/** The six re-stamped values of entries 0061 and 0062, and the future ones they replace. */
const WHEN_0061 = 1788543183386;
const WHEN_0062 = 1788546783386;
const FUTURE_0061 = 1788957183386;
const FUTURE_0062 = 1789043583386;

const JOURNAL: ReadonlyArray<JournalStamp> = [
  { hash: HASH_0061, folderMillis: WHEN_0061 },
  { hash: HASH_0062, folderMillis: WHEN_0062 },
];

interface RecordedQuery {
  readonly text: string;
  readonly values: ReadonlyArray<unknown>;
}

interface FakeClient extends StampQueryable {
  /** Every statement the pre-flight issued, in order. */
  readonly queries: ReadonlyArray<RecordedQuery>;
}

/**
 * The canned answers are keyed on the query text in the order `to_regclass`,
 * `UPDATE`, then the read. The read and the update both name
 * `drizzle.__drizzle_migrations`, so a looser match would answer an `UPDATE`
 * with the row set and hide a real defect.
 */
function fakeClient(options: {
  readonly present: boolean;
  readonly rows: ReadonlyArray<AppliedMigrationRow>;
}): FakeClient {
  const queries: RecordedQuery[] = [];
  return {
    queries,
    query(text: string, values?: unknown[]): Promise<{ rows: unknown[]; rowCount: number | null }> {
      queries.push({ text, values: values ?? [] });
      if (text.includes("to_regclass")) {
        const present = options.present ? "drizzle.__drizzle_migrations" : null;
        return Promise.resolve({ rows: [{ present }], rowCount: 1 });
      }
      if (text.trimStart().startsWith("UPDATE")) {
        return Promise.resolve({ rows: [], rowCount: 1 });
      }
      return Promise.resolve({ rows: [...options.rows], rowCount: options.rows.length });
    },
  };
}

const updatesIn = (client: FakeClient): ReadonlyArray<RecordedQuery> =>
  client.queries.filter((q) => q.text.trimStart().startsWith("UPDATE"));

/** An existing database whose stamps already agree with the journal has nothing to repair. */
export function assertAMatchingDatabaseNeedsNoRestamp(): void {
  const plan = planJournalResync(
    [
      { hash: HASH_0061, created_at: WHEN_0061 },
      { hash: HASH_0062, created_at: WHEN_0062 },
    ],
    JOURNAL,
  );

  expect(plan.restamps).toEqual([]);
  expect(plan.blockingStrays).toEqual([]);
}

/** A row whose stamp differs from the journal is re-stamped to the journal's value. */
export function assertADifferingStampBecomesARestamp(): void {
  const plan = planJournalResync(
    [
      { hash: HASH_0061, created_at: WHEN_0061 },
      { hash: HASH_0062, created_at: FUTURE_0062 },
    ],
    JOURNAL,
  );

  expect(plan.restamps).toEqual([{ hash: HASH_0062, from: FUTURE_0062, to: WHEN_0062 }]);
  expect(plan.blockingStrays).toEqual([]);
}

/**
 * A row the journal does not describe but that sits behind the journal's last
 * entry blocks nothing, so it is not reported. Only a row drizzle would read
 * as the newest applied migration matters.
 */
export function assertAnUnknownHashBehindTheJournalIsNotAStray(): void {
  const plan = planJournalResync(
    [
      { hash: HASH_0061, created_at: WHEN_0061 },
      { hash: HASH_0062, created_at: WHEN_0062 },
      { hash: HASH_STRAY, created_at: WHEN_0062 - 1000 },
    ],
    JOURNAL,
  );

  expect(plan.restamps).toEqual([]);
  expect(plan.blockingStrays).toEqual([]);
}

/** A row the journal does not describe and that is ahead of it is what blocks the next migration. */
export function assertAnUnknownHashAheadOfTheJournalIsAStray(): void {
  const plan = planJournalResync(
    [
      { hash: HASH_0061, created_at: WHEN_0061 },
      { hash: HASH_0062, created_at: WHEN_0062 },
      { hash: HASH_STRAY, created_at: FUTURE_0062 },
    ],
    JOURNAL,
  );

  expect(plan.restamps).toEqual([]);
  expect(plan.blockingStrays).toEqual([{ hash: HASH_STRAY, createdAt: FUTURE_0062 }]);
}

/**
 * `created_at` is a `bigint`, so `pg` hands it back as a string. Comparing it
 * without the numeric coercion drizzle itself uses would make every row look
 * different from the journal, and re-stamp all of them on every run.
 */
export function assertAStringCreatedAtIsComparedNumerically(): void {
  const matching = planJournalResync([{ hash: HASH_0061, created_at: String(WHEN_0061) }], JOURNAL);
  expect(matching.restamps).toEqual([]);

  const differing = planJournalResync(
    [{ hash: HASH_0062, created_at: String(FUTURE_0062) }],
    JOURNAL,
  );
  expect(differing.restamps).toEqual([{ hash: HASH_0062, from: FUTURE_0062, to: WHEN_0062 }]);
}

/**
 * On a fresh database the `drizzle` schema does not exist yet — drizzle's own
 * migrator creates it. The pre-flight must not read the table, must not write
 * it, and must not try to create it.
 */
export async function assertAFreshDatabaseIsLeftAlone(): Promise<void> {
  const client = fakeClient({ present: false, rows: [] });
  const lines: string[] = [];

  const plan = await resyncJournalStamps(client, JOURNAL, (line) => lines.push(line));

  expect(plan.restamps).toEqual([]);
  expect(plan.blockingStrays).toEqual([]);
  expect(client.queries.filter((q) => q.text.includes("SELECT hash"))).toEqual([]);
  expect(updatesIn(client)).toEqual([]);
  expect(lines.join("\n")).toContain(
    "F4.94 journal re-sync: no drizzle.__drizzle_migrations yet, nothing to do",
  );
}

/**
 * The statement is guarded with `created_at <> $2` so a row that is already
 * correct is never written, and the plan drives it in journal order rather
 * than in whatever order Postgres returned the rows.
 */
export async function assertEveryDifferingRowIsRestampedInJournalOrder(): Promise<void> {
  const client = fakeClient({
    present: true,
    rows: [
      { hash: HASH_0062, created_at: String(FUTURE_0062) },
      { hash: HASH_0061, created_at: String(FUTURE_0061) },
    ],
  });
  const lines: string[] = [];

  const plan = await resyncJournalStamps(client, JOURNAL, (line) => lines.push(line));

  expect(plan.restamps).toEqual([
    { hash: HASH_0061, from: FUTURE_0061, to: WHEN_0061 },
    { hash: HASH_0062, from: FUTURE_0062, to: WHEN_0062 },
  ]);

  const updates = updatesIn(client);
  expect(updates).toHaveLength(2);
  expect(updates.map((q) => q.values)).toEqual([
    [HASH_0061, WHEN_0061],
    [HASH_0062, WHEN_0062],
  ]);
  for (const update of updates) {
    expect(update.text).toContain("created_at <> $2");
  }

  const output = lines.join("\n");
  expect(output).toContain(`d37dd5d54637 created_at ${FUTURE_0061} -> ${WHEN_0061}`);
  expect(output).toContain(`171fa9ac14b4 created_at ${FUTURE_0062} -> ${WHEN_0062}`);
  expect(output).toContain("F4.94 journal re-sync: 2 row(s) re-stamped");
}

/**
 * Idempotency, which is what lets the pre-flight run before every migration
 * and what makes a crash halfway through safe: the second run writes nothing
 * and still reports its summary, so an operator can read the `0` and stop
 * looking.
 */
export async function assertASecondRunRestampsNothing(): Promise<void> {
  const client = fakeClient({
    present: true,
    rows: [
      { hash: HASH_0061, created_at: String(WHEN_0061) },
      { hash: HASH_0062, created_at: String(WHEN_0062) },
    ],
  });
  const lines: string[] = [];

  const plan = await resyncJournalStamps(client, JOURNAL, (line) => lines.push(line));

  expect(plan.restamps).toEqual([]);
  expect(updatesIn(client)).toEqual([]);
  expect(lines.join("\n")).toContain("F4.94 journal re-sync: 0 row(s) re-stamped");
}

/**
 * A row the pre-flight cannot match to the journal is named and left alone. It
 * warns rather than refuses, because a deployment must not be blocked over
 * bookkeeping the script cannot repair safely, and it never writes a hash the
 * journal does not describe.
 */
export async function assertABlockingStrayIsWarnedAboutAndNeverWritten(): Promise<void> {
  const client = fakeClient({
    present: true,
    rows: [
      { hash: HASH_0061, created_at: String(WHEN_0061) },
      { hash: HASH_0062, created_at: String(WHEN_0062) },
      { hash: HASH_STRAY, created_at: String(FUTURE_0062) },
    ],
  });
  const lines: string[] = [];

  const plan = await resyncJournalStamps(client, JOURNAL, (line) => lines.push(line));

  expect(plan.blockingStrays).toEqual([{ hash: HASH_STRAY, createdAt: FUTURE_0062 }]);
  const warning = lines.find((line) => line.includes("WARNING"));
  expect(warning).toBeDefined();
  expect(warning ?? "").toContain("beefbeefbeef");
  for (const update of updatesIn(client)) {
    expect(update.values).not.toContain(HASH_STRAY);
  }
}

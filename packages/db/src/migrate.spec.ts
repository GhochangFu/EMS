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

/**
 * A journal of one entry, for the duplicate-hash cases. A three-entry journal
 * would leave two entries with no applied row, and those would land in
 * `unreachable` and blur what the case is about.
 */
const SINGLE_JOURNAL: ReadonlyArray<JournalStamp> = [
  { hash: HASH_0062, folderMillis: WHEN_0062, tag: "0062_operator_surface" },
];

/**
 * Three consecutive entries, one day apart, used by the cases about a
 * partly-migrated database: an entry with no applied row, and a stray row that
 * shadows it.
 */
const HASH_E1 = hashOf("e1e1e1e1e1e1");
const HASH_E2 = hashOf("e2e2e2e2e2e2");
const HASH_E3 = hashOf("e3e3e3e3e3e3");

const WHEN_E1 = 1788000000000;
const WHEN_E2 = 1788086400000;
const WHEN_E3 = 1788172800000;

const THREE_ENTRY_JOURNAL: ReadonlyArray<JournalStamp> = [
  { hash: HASH_E1, folderMillis: WHEN_E1, tag: "0001_first" },
  { hash: HASH_E2, folderMillis: WHEN_E2, tag: "0002_middle" },
  { hash: HASH_E3, folderMillis: WHEN_E3, tag: "0003_last" },
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
  /**
   * The `rowCount` each `UPDATE` answers, in order. A position the array does
   * not cover answers `1`. One statement can touch more than one row, because
   * the guard matches on the hash and a hash can appear twice in the table.
   */
  readonly updateRowCounts?: ReadonlyArray<number>;
}): FakeClient {
  const queries: RecordedQuery[] = [];
  let updates = 0;
  return {
    queries,
    query(text: string, values?: unknown[]): Promise<{ rows: unknown[]; rowCount: number | null }> {
      queries.push({ text, values: values ?? [] });
      if (text.includes("to_regclass")) {
        const present = options.present ? "drizzle.__drizzle_migrations" : null;
        return Promise.resolve({ rows: [{ present }], rowCount: 1 });
      }
      if (text.trimStart().startsWith("UPDATE")) {
        const counts = options.updateRowCounts ?? [];
        const rowCount = updates < counts.length ? counts[updates] : 1;
        updates += 1;
        return Promise.resolve({ rows: [], rowCount });
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
  expect(plan.unreachable).toEqual([]);
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
  expect(plan.unreachable).toEqual([]);
}

/**
 * A stale checkout still holding the old journal runs the old migrator, and
 * every entry `0057`–`0062` is idempotent, so it re-applies them and inserts a
 * *second* row per hash carrying the old future stamp. Drizzle reads
 * `ORDER BY created_at DESC LIMIT 1`, so the newest of the two is what blocks
 * the next migration. Taking the first row per hash would pick the already
 * repaired one, plan nothing, warn about nothing — the hash is in the journal,
 * so it is not a stray either — and leave the database blocked in silence.
 */
export function assertADuplicateHashIsPlannedFromItsMaximumStamp(): void {
  const plan = planJournalResync(
    [
      { hash: HASH_0062, created_at: WHEN_0062 },
      { hash: HASH_0062, created_at: FUTURE_0062 },
    ],
    SINGLE_JOURNAL,
  );

  expect(plan.restamps).toEqual([{ hash: HASH_0062, from: FUTURE_0062, to: WHEN_0062 }]);
  expect(plan.blockingStrays).toEqual([]);
  expect(plan.unreachable).toEqual([]);
}

/** The row order Postgres returns is not stable, so the plan must not depend on it. */
export function assertADuplicateHashPlansTheSameInEitherRowOrder(): void {
  const reversed = planJournalResync(
    [
      { hash: HASH_0062, created_at: FUTURE_0062 },
      { hash: HASH_0062, created_at: WHEN_0062 },
    ],
    SINGLE_JOURNAL,
  );

  expect(reversed.restamps).toEqual([{ hash: HASH_0062, from: FUTURE_0062, to: WHEN_0062 }]);
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
 * The journal's *last* entry is not the only thing a stray can block. Here the
 * database has applied entries 1 and 3 but not 2, and the stray is stamped at
 * entry 2's `when` — below the journal's last entry, so the old
 * `createdAt > lastJournalStamp` test called it harmless, and it is not. The
 * boundary value is deliberate: a `>` written where `>=` was meant passes every
 * other case and fails this one.
 *
 * Here entry 3's own applied row already sets the table's maximum above entry
 * 2, so the stray adds no blocking of its own; it is still named, because the
 * operator reads the stray line and the unreachable line together. A stray
 * stamped *below* entry 2 would be correctly silent.
 */
export function assertAStrayShadowingAnUnappliedEntryBlocks(): void {
  const plan = planJournalResync(
    [
      { hash: HASH_E1, created_at: WHEN_E1 },
      { hash: HASH_E3, created_at: WHEN_E3 },
      { hash: HASH_STRAY, created_at: WHEN_E2 },
    ],
    THREE_ENTRY_JOURNAL,
  );

  expect(plan.restamps).toEqual([]);
  expect(plan.blockingStrays).toEqual([{ hash: HASH_STRAY, createdAt: WHEN_E2 }]);
  expect(plan.unreachable).toEqual([
    { hash: HASH_E2, folderMillis: WHEN_E2, tag: "0002_middle" },
  ]);
}

/**
 * The boundary of both rules at once. The database has applied entry 1 only,
 * and a stray sits at exactly entry 2's `when`, so the stray itself sets the
 * table's maximum. Entry 2 is unreachable (`folderMillis <= maximum` — a `<`
 * written here passes every other case), the stray blocks it (`>= unappliedMin`
 * — an `unappliedMax` written there passes every other case), and entry 3 stays
 * reachable because it sits above the maximum.
 */
export function assertAStrayAtAnUnappliedEntrysOwnStampNamesBothSides(): void {
  const plan = planJournalResync(
    [
      { hash: HASH_E1, created_at: WHEN_E1 },
      { hash: HASH_STRAY, created_at: WHEN_E2 },
    ],
    THREE_ENTRY_JOURNAL,
  );

  expect(plan.restamps).toEqual([]);
  expect(plan.blockingStrays).toEqual([{ hash: HASH_STRAY, createdAt: WHEN_E2 }]);
  expect(plan.unreachable).toEqual([
    { hash: HASH_E2, folderMillis: WHEN_E2, tag: "0002_middle" },
  ]);
}

/**
 * A NULL `created_at` is not "below everything": Postgres sorts NULL first under
 * `ORDER BY created_at DESC`, so drizzle reads that row as the newest applied
 * migration, `Number(null)` is `0`, and the whole chain replays. Three shapes.
 * A lone NULL row for a journal hash is planned as an ordinary re-stamp. A NULL
 * row beside a correct duplicate is still planned, although the readable
 * maximum already equals the journal, because one guarded statement on the
 * hash repairs the NULL row too. A NULL stray always blocks, whatever the
 * journal looks like.
 */
export function assertALoneNullStampIsRestamped(): void {
  const plan = planJournalResync([{ hash: HASH_0062, created_at: null }], JOURNAL);

  expect(plan.restamps).toEqual([{ hash: HASH_0062, from: 0, to: WHEN_0062 }]);
}

export function assertANullRowBesideACorrectDuplicateIsStillRestamped(): void {
  const plan = planJournalResync(
    [
      { hash: HASH_0062, created_at: WHEN_0062 },
      { hash: HASH_0062, created_at: null },
    ],
    JOURNAL,
  );

  expect(plan.restamps).toEqual([{ hash: HASH_0062, from: WHEN_0062, to: WHEN_0062 }]);
}

export function assertANullStrayAlwaysBlocks(): void {
  const plan = planJournalResync(
    [
      { hash: HASH_0061, created_at: WHEN_0061 },
      { hash: HASH_0062, created_at: WHEN_0062 },
      { hash: HASH_STRAY, created_at: null },
    ],
    JOURNAL,
  );

  expect(plan.restamps).toEqual([]);
  expect(plan.blockingStrays).toEqual([{ hash: HASH_STRAY, createdAt: 0, unreadable: true }]);
}

/**
 * A journal entry with no applied row that sits below what the table's maximum
 * will be after the re-stamps can never apply on that database: drizzle runs an
 * entry only when its `folderMillis` is strictly greater than the newest applied
 * stamp. Four of these were measured on the live dev database (`0027`, `0049`,
 * `0050`, `0060` — drafts applied before the files were finalised). Nothing here
 * can repair one, so the pre-flight names it and lets the run continue.
 */
export function assertAnUnappliedEntryBelowTheMaximumIsUnreachable(): void {
  const plan = planJournalResync(
    [
      { hash: HASH_E1, created_at: WHEN_E1 },
      { hash: HASH_E3, created_at: WHEN_E3 },
    ],
    THREE_ENTRY_JOURNAL,
  );

  expect(plan.blockingStrays).toEqual([]);
  expect(plan.unreachable).toEqual([
    { hash: HASH_E2, folderMillis: WHEN_E2, tag: "0002_middle" },
  ]);
}

/**
 * The common case must stay quiet. A database that has applied the first entry
 * and nothing else is simply behind: entries 2 and 3 are above its maximum, so
 * drizzle will apply them on this very run. Reporting those as unreachable
 * would fire the warning on every fresh deployment and teach an operator to
 * ignore it.
 */
export function assertAPartlyMigratedDatabaseReportsNothingUnreachable(): void {
  const plan = planJournalResync([{ hash: HASH_E1, created_at: WHEN_E1 }], THREE_ENTRY_JOURNAL);

  expect(plan.unreachable).toEqual([]);
  expect(plan.blockingStrays).toEqual([]);
  expect(plan.restamps).toEqual([]);
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
  expect(plan.unreachable).toEqual([]);
  expect(client.queries.filter((q) => q.text.includes("SELECT hash"))).toEqual([]);
  expect(updatesIn(client)).toEqual([]);
  expect(lines.join("\n")).toContain(
    "F4.94 journal re-sync: no drizzle.__drizzle_migrations yet, nothing to do",
  );
}

/**
 * The statement is guarded with `created_at IS DISTINCT FROM $2` so a row that
 * is already correct is never written, and the plan drives it in journal order
 * rather than in whatever order Postgres returned the rows. `IS DISTINCT FROM`
 * rather than `<>`: the guard must also match a duplicate row that still holds
 * the old stamp, and a NULL `created_at`, which `NULL <> $2` never matches.
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
    expect(update.text).toContain("IS DISTINCT FROM $2");
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
  // Deleting the row is the repair an operator reaches for first, and it is the
  // one that makes things worse: a lower maximum re-runs everything above it.
  expect(warning ?? "").toContain("Do not delete it");
  expect(warning ?? "").toContain("re-runs every entry above the new maximum");
  for (const update of updatesIn(client)) {
    expect(update.values).not.toContain(HASH_STRAY);
  }
}

/**
 * A NULL stray gets its own warning, because the repair is different: the row
 * is not "above" anything, drizzle reads it as the newest and replays the chain.
 */
export async function assertANullStrayIsWarnedAboutAsAChainReplay(): Promise<void> {
  const client = fakeClient({
    present: true,
    rows: [
      { hash: HASH_0061, created_at: String(WHEN_0061) },
      { hash: HASH_0062, created_at: String(WHEN_0062) },
      { hash: HASH_STRAY, created_at: null },
    ],
  });
  const lines: string[] = [];

  const plan = await resyncJournalStamps(client, JOURNAL, (line) => lines.push(line));

  expect(plan.blockingStrays).toEqual([{ hash: HASH_STRAY, createdAt: 0, unreadable: true }]);
  const warning = lines.find((line) => line.includes("WARNING"));
  expect(warning ?? "").toContain("beefbeefbeef");
  expect(warning ?? "").toContain("NULL created_at");
  expect(warning ?? "").toContain("replays the whole chain");
  expect(updatesIn(client)).toEqual([]);
}

/**
 * An unreachable entry is reported by name, with the maximum that shadows it and
 * the two repairs that work, so an operator reading the deployment log has
 * everything needed without opening psql.
 */
export async function assertAnUnreachableEntryIsNamedInAWarning(): Promise<void> {
  const client = fakeClient({
    present: true,
    rows: [
      { hash: HASH_E1, created_at: String(WHEN_E1) },
      { hash: HASH_E3, created_at: String(WHEN_E3) },
    ],
  });
  const lines: string[] = [];

  const plan = await resyncJournalStamps(client, THREE_ENTRY_JOURNAL, (line) => lines.push(line));

  expect(plan.unreachable).toEqual([
    { hash: HASH_E2, folderMillis: WHEN_E2, tag: "0002_middle" },
  ]);
  const warning = lines.find((line) => line.includes("WARNING"));
  expect(warning ?? "").toContain("0002_middle");
  expect(warning ?? "").toContain(`when ${WHEN_E2}`);
  expect(warning ?? "").toContain(`(${WHEN_E3})`);
  expect(warning ?? "").toContain("drizzle will never apply it here");
  expect(updatesIn(client)).toEqual([]);
}

/**
 * Fail closed on the journal side. The pre-flight copies `folderMillis` straight
 * into `created_at`, so a journal that is itself ahead of the clock would put
 * the exact defect this repairs back into the table. The throw happens before
 * the read as well as before the write, so `main()` aborts with the table
 * untouched and no migration applied.
 */
export async function assertAJournalAheadOfTheClockIsRefusedBeforeAnyQuery(): Promise<void> {
  const now = 1788600000000;
  const client = fakeClient({ present: true, rows: [] });
  const ahead: ReadonlyArray<JournalStamp> = [
    { hash: HASH_0061, folderMillis: now + 2 * 60 * 60 * 1000, tag: "0061_ahead" },
  ];

  await expect(
    resyncJournalStamps(client, ahead, () => undefined, now),
  ).rejects.toThrow("0061_ahead");
  expect(client.queries.filter((q) => q.text.includes("SELECT hash"))).toEqual([]);
  expect(updatesIn(client)).toEqual([]);
}

/** A stamp that is not a finite integer cannot be compared numerically, so it is never written. */
export async function assertANonIntegerJournalStampIsRefused(): Promise<void> {
  const client = fakeClient({ present: true, rows: [] });
  const notANumber: ReadonlyArray<JournalStamp> = [
    { hash: HASH_0061, folderMillis: Number.NaN, tag: "0061_unreadable" },
  ];
  const fractional: ReadonlyArray<JournalStamp> = [
    { hash: HASH_0061, folderMillis: 1788543183386.5, tag: "0061_fractional" },
  ];

  await expect(resyncJournalStamps(client, notANumber, () => undefined)).rejects.toThrow(
    "0061_unreadable",
  );
  await expect(resyncJournalStamps(client, fractional, () => undefined)).rejects.toThrow(
    "0061_fractional",
  );
  expect(updatesIn(client)).toEqual([]);
}

/**
 * The summary counts rows the database reports written, not statements planned.
 * One guarded statement repairs every duplicate of a hash at once, so a plan of
 * one can write two — and reporting the plan would understate what changed.
 */
export async function assertTheSummaryCountsRowsWrittenNotStatements(): Promise<void> {
  const client = fakeClient({
    present: true,
    rows: [
      { hash: HASH_0062, created_at: String(WHEN_0062) },
      { hash: HASH_0062, created_at: String(FUTURE_0062) },
    ],
    updateRowCounts: [2],
  });
  const lines: string[] = [];

  const plan = await resyncJournalStamps(client, SINGLE_JOURNAL, (line) => lines.push(line));

  expect(plan.restamps).toHaveLength(1);
  const output = lines.join("\n");
  expect(output).toContain("F4.94 journal re-sync: 2 row(s) re-stamped");
  expect(output).toContain("0062_operator_surface created_at");
}

/**
 * The other direction, which is the one that hides a defect: a planned re-stamp
 * that writes nothing. It means the guard matched no row — a concurrent run, or
 * a stamp that moved between the read and the write — and the summary must say
 * so rather than report the plan as if it had landed.
 */
export async function assertAPlannedRestampThatWritesNothingIsReported(): Promise<void> {
  const client = fakeClient({
    present: true,
    rows: [
      { hash: HASH_0061, created_at: String(WHEN_0061) },
      { hash: HASH_0062, created_at: String(FUTURE_0062) },
    ],
    updateRowCounts: [0],
  });
  const lines: string[] = [];

  await resyncJournalStamps(client, JOURNAL, (line) => lines.push(line));

  expect(lines.join("\n")).toContain("F4.94 journal re-sync: 0 row(s) re-stamped (1 planned)");
}

import { config as loadEnv } from "dotenv";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

/**
 * ADR 0045 decision 3 (and Amendment 1). This runs as `bms_app`, the
 * provisioning superuser, and **it issues no `SET ROLE`**.
 *
 * Both halves are deliberate.
 *
 * It needs `SUPERUSER` because the migration chain is history and a fresh
 * deployment replays it whole: `0039:33` issues `ALTER ROLE bms_fleet
 * BYPASSRLS`, which PostgreSQL restricts to superusers unconditionally, and
 * `0000` needs the Timescale extension already present. Neither file can be
 * edited — drizzle keys its journal by file hash, so an edit re-runs the
 * migration on every existing deployment (AGENTS.md §4, forward-only).
 *
 * It issues no `SET ROLE` because **each migration file authored after ADR 0045
 * opens with `SET ROLE bms_owner` and ends with `RESET ROLE`** instead. Do not
 * "fix" that by moving the `SET ROLE` here. Amendment 1 measured why:
 *
 *   - drizzle's migrator issues `CREATE SCHEMA IF NOT EXISTS drizzle` before
 *     any migration file runs, and `CREATE SCHEMA` needs `CREATE` on the
 *     database. The database ACL check happens *before* the `IF NOT EXISTS`
 *     existence check, so pre-creating the schema does not help — a
 *     connection-level `SET ROLE` would force `GRANT CREATE ON DATABASE bms TO
 *     bms_owner`, widening the constrained role beyond what the ADR describes.
 *   - `pg.Pool`'s `connect` handler is not awaited before the pool hands the
 *     client out, so a `pool.on("connect", ...)` implementation would let some
 *     migrations run as `bms_app` and leave their objects superuser-owned,
 *     silently — the exact defect ADR 0045 exists to remove.
 *
 * A single `pg.Client` rather than a `pg.Pool`: the whole chain runs in one
 * session, so a leaked `SET ROLE` cannot reach a later, unrelated caller. The
 * repository invariant in `tests/adr-0045-owner-and-superuser-url.test.ts`
 * asserts every post-`0041` migration that issues `SET ROLE` also issues
 * `RESET ROLE`, because a forgotten one leaks past `COMMIT` into the session.
 *
 * `F4.94` adds one pre-flight before the chain runs. Journal entries `0057` to
 * `0062` were once hand-stamped ahead of the wall clock, and drizzle applies a
 * file only when `Number(lastDbMigration.created_at) < migration.folderMillis`
 * (`drizzle-orm/pg-core/dialect.js:57-67`), so every database that ran those
 * entries reads a future stamp as the newest applied migration and skips the
 * next honestly stamped one without an error. The pre-flight pushes the
 * journal's `when` values back into `drizzle.__drizzle_migrations.created_at`,
 * matched by file hash, on the same connection this file already holds. It
 * needs no privilege of its own: `bms_app` owns that table, so this issues no
 * `SET ROLE` either.
 *
 * The two journal hooks tolerate one hour of clock skew, and that tolerance is
 * a bound on what they claim, not an elimination of the defect: a `when` pinned
 * inside that hour still sorts above a migration generated a few minutes later
 * on a slower clock, and both hooks read the very machine clock that stamped
 * the entry, so neither can see its own drift. The check that does not share
 * the author's clock is the `tests/` invariant, which CI runs on its own
 * machine — and this pre-flight, which repairs the databases that already
 * carry a bad stamp.
 */

/** Scripts run with cwd = `packages/db` via `pnpm --filter @bms/db`. */
const pkgRoot = process.cwd();

loadEnv({ path: resolve(pkgRoot, "../../apps/api/.env") });
loadEnv({ path: resolve(pkgRoot, ".env") });

export function resolveMigrationUrl(env: Record<string, string | undefined>): string {
  const url = env.DATABASE_URL_SUPERUSER;
  if (!url) {
    throw new Error(
      "DATABASE_URL_SUPERUSER is required for migrations. It carries the " +
        "`bms_app` connection (ADR 0045 decision 3); `DATABASE_URL` names " +
        "`bms_owner`, which cannot replay the historical chain.",
    );
  }
  return url;
}

/**
 * The two columns of a `drizzle.__drizzle_migrations` row the pre-flight
 * reads. `created_at` is a `bigint`, so `pg` hands it back as a string.
 */
export interface AppliedMigrationRow {
  readonly hash: string;
  readonly created_at: string | number | null;
}

/**
 * The two fields of drizzle's `MigrationMeta` the pre-flight uses, plus the
 * `tag`. `readMigrationFiles` does not return the tag, so `main` reads it from
 * `meta/_journal.json` and zips it on; a caller that does not have it gets the
 * hash prefix in the log lines instead.
 */
export interface JournalStamp {
  readonly hash: string;
  readonly folderMillis: number;
  readonly tag?: string;
}

export interface JournalResync {
  /** Applied rows the journal describes, whose stamp is not the journal's. */
  readonly restamps: ReadonlyArray<{
    readonly hash: string;
    readonly from: number;
    readonly to: number;
  }>;
  /** Applied rows the journal does not describe, which still shadow part of it. */
  readonly blockingStrays: ReadonlyArray<{ readonly hash: string; readonly createdAt: number }>;
  /**
   * Journal entries with no applied row that sit at or below what the table's
   * maximum will be once the re-stamps land. Drizzle applies an entry only when
   * its `folderMillis` is strictly greater than the newest applied stamp, so
   * such an entry can never apply on that database. Nothing here can repair
   * one — the file's statements were never run — so it is reported, not written.
   */
  readonly unreachable: ReadonlyArray<{
    readonly hash: string;
    readonly folderMillis: number;
    readonly tag?: string;
  }>;
}

/** The subset of `pg.Client` the pre-flight needs. `pg.Client` satisfies it structurally. */
export interface StampQueryable {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[]; rowCount: number | null }>;
}

const MIGRATIONS_TABLE = "drizzle.__drizzle_migrations";

/**
 * The clock-skew allowance for a journal stamp, duplicated on purpose. The same
 * number lives in `scripts/checks/drizzle-journal.mjs` as
 * `JOURNAL_CLOCK_SKEW_MS` and in
 * `tests/f4.94-journal-when-not-ahead-of-clock.test.ts`. Neither can be
 * imported here — the first is untyped `.mjs`, the second is a test — so the
 * three copies are kept in step by hand.
 */
const JOURNAL_CLOCK_SKEW_MS = 60 * 60 * 1000;

/**
 * The same coercion drizzle itself applies to `created_at`. A NULL or an
 * unreadable value compares as `0`, which is below every journal stamp, so
 * such a row is never mistaken for one sitting ahead of the journal.
 */
function toMillis(value: string | number | null): number {
  const millis = Number(value);
  return Number.isFinite(millis) ? millis : 0;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

/** `pg` returns untyped rows, so each one is narrowed before it is read. */
function toAppliedRows(rows: ReadonlyArray<unknown>): AppliedMigrationRow[] {
  const applied: AppliedMigrationRow[] = [];
  for (const row of rows) {
    const record = asRecord(row);
    if (!record) continue;
    const hash = record.hash;
    if (typeof hash !== "string") continue;
    const createdAt = record.created_at;
    applied.push({
      hash,
      created_at: typeof createdAt === "string" || typeof createdAt === "number" ? createdAt : null,
    });
  }
  return applied;
}

function lastJournalStamp(journal: ReadonlyArray<JournalStamp>): number {
  return journal.reduce((max, entry) => (entry.folderMillis > max ? entry.folderMillis : max), 0);
}

/** The first twelve characters of a sha256 hash, which is what an operator reads in a log line. */
function shortHash(hash: string): string {
  return hash.slice(0, 12);
}

/** The journal tag when one is known, and the hash prefix otherwise. */
function labelOf(entry: { readonly hash: string; readonly tag?: string }): string {
  return entry.tag ?? shortHash(entry.hash);
}

/**
 * The maximum `created_at` the table holds once the re-stamps land: a row the
 * journal describes ends at that entry's `folderMillis`, and a row it does not
 * describe keeps its own stamp. This is the value drizzle compares every
 * journal entry against, so it decides what can still apply.
 *
 * `-Infinity` for an empty table, which is what makes every journal entry
 * reachable on a database that has applied nothing.
 */
function maxStampAfterResync(
  applied: ReadonlyArray<AppliedMigrationRow>,
  journal: ReadonlyArray<JournalStamp>,
): number {
  const folderMillisByHash = new Map(journal.map((entry) => [entry.hash, entry.folderMillis]));
  let max = Number.NEGATIVE_INFINITY;
  for (const row of applied) {
    const effective = folderMillisByHash.get(row.hash) ?? toMillis(row.created_at);
    if (effective > max) max = effective;
  }
  return max;
}

/**
 * Fail closed on the journal side, before anything is read or written. The
 * pre-flight copies `folderMillis` straight into `created_at`, so a journal
 * that is itself corrupt or ahead of the clock would push the exact defect this
 * repairs back into the table. `main` calls the pre-flight before `migrate()`,
 * so a throw here aborts the run with no migration applied.
 */
function assertJournalIsWritable(journal: ReadonlyArray<JournalStamp>, now: number): void {
  const ceiling = now + JOURNAL_CLOCK_SKEW_MS;
  for (const entry of journal) {
    if (!Number.isInteger(entry.folderMillis)) {
      throw new Error(
        `F4.94 journal re-sync refuses to write: journal entry ${labelOf(entry)} has a ` +
          `folderMillis of ${String(entry.folderMillis)}, which is not a finite integer. ` +
          "Drizzle compares that value numerically, so every ordering check against it is " +
          "false and it must never reach created_at.",
      );
    }
    if (entry.folderMillis > ceiling) {
      throw new Error(
        `F4.94 journal re-sync refuses to write: journal entry ${labelOf(entry)} has a ` +
          `folderMillis of ${entry.folderMillis}, which is ahead of the wall clock ` +
          `(now = ${now}, tolerance ${JOURNAL_CLOCK_SKEW_MS} ms). Writing it would put the ` +
          "future stamp this pre-flight exists to remove back into the table.",
      );
    }
  }
}

/**
 * Pure. Decides what the pre-flight would write, so the decision is testable
 * without a database.
 *
 * The re-stamps come out in journal order rather than in the order Postgres
 * returned the rows, because that is the order an operator reads them in and
 * the order the journal itself is written in.
 */
export function planJournalResync(
  applied: ReadonlyArray<AppliedMigrationRow>,
  journal: ReadonlyArray<JournalStamp>,
): JournalResync {
  // The maximum per hash, not the first row returned. Drizzle reads
  // `ORDER BY created_at DESC LIMIT 1`, so when a hash carries two rows it is
  // the newer one that decides what drizzle sees. A stale checkout still
  // holding the old journal produces exactly that: it re-applies the (idempotent)
  // entries `0057`-`0062` and inserts a second row per hash with the old future
  // stamp. First-wins would pick the already-repaired row, plan nothing, and
  // warn about nothing, because the hash is in the journal and so is not a stray.
  const maxByHash = new Map<string, number>();
  for (const row of applied) {
    const millis = toMillis(row.created_at);
    const seen = maxByHash.get(row.hash);
    if (seen === undefined || millis > seen) maxByHash.set(row.hash, millis);
  }

  const restamps: Array<{ hash: string; from: number; to: number }> = [];
  for (const entry of journal) {
    const from = maxByHash.get(entry.hash);
    if (from === undefined) continue;
    if (from !== entry.folderMillis) {
      restamps.push({ hash: entry.hash, from, to: entry.folderMillis });
    }
  }

  // A journal entry with no applied row is the thing a stray can shadow, and
  // the lowest such entry is the first one a stray can block.
  const maxAfterResync = maxStampAfterResync(applied, journal);
  const unreachable: Array<{ hash: string; folderMillis: number; tag?: string }> = [];
  let unappliedMin = Number.POSITIVE_INFINITY;
  for (const entry of journal) {
    if (maxByHash.has(entry.hash)) continue;
    if (entry.folderMillis < unappliedMin) unappliedMin = entry.folderMillis;
    if (entry.folderMillis <= maxAfterResync) {
      unreachable.push({ hash: entry.hash, folderMillis: entry.folderMillis, tag: entry.tag });
    }
  }

  // Two ways a row the journal does not describe blocks a migration: it sits at
  // or above an entry that has not been applied here, or it is ahead of the
  // journal altogether and so blocks whatever is generated next.
  const journalHashes = new Set(journal.map((entry) => entry.hash));
  const lastStamp = lastJournalStamp(journal);
  const blockingStrays: Array<{ hash: string; createdAt: number }> = [];
  for (const row of applied) {
    if (journalHashes.has(row.hash)) continue;
    const createdAt = toMillis(row.created_at);
    if (createdAt >= unappliedMin || createdAt > lastStamp) {
      blockingStrays.push({ hash: row.hash, createdAt });
    }
  }

  return { restamps, blockingStrays, unreachable };
}

/**
 * `F4.94`. Runs on the `bms_app` connection `main` already holds, before
 * `migrate()`, and issues no `SET ROLE` (ADR 0045 decision 3).
 *
 * There is no explicit transaction. Every statement is guarded by
 * `created_at IS DISTINCT FROM $2`, so the whole thing is idempotent and a run
 * that dies halfway leaves the next one to finish it — and a failure here
 * throws before `migrate()` is called, so no migration is ever applied against
 * a half-repaired table. `IS DISTINCT FROM` rather than `<>` because one
 * statement must converge every duplicate of a hash, including a NULL stamp,
 * which `NULL <> $2` never matches.
 *
 * `now` is a parameter so a test can pin it. It is only ever read by the
 * journal validation.
 */
export async function resyncJournalStamps(
  client: StampQueryable,
  journal: ReadonlyArray<JournalStamp>,
  log: (line: string) => void = (line) => console.error(line),
  now: number = Date.now(),
): Promise<JournalResync> {
  assertJournalIsWritable(journal, now);

  // A fresh database has no `drizzle` schema yet: drizzle's own migrator
  // creates it. `to_regclass` answers NULL rather than raising, so it is a
  // safe probe where a plain `SELECT` would abort the run.
  const probe = await client.query(`SELECT to_regclass('${MIGRATIONS_TABLE}') AS present`);
  const present = asRecord(probe.rows[0])?.present ?? null;
  if (present === null) {
    log(`F4.94 journal re-sync: no ${MIGRATIONS_TABLE} yet, nothing to do`);
    return { restamps: [], blockingStrays: [], unreachable: [] };
  }

  const read = await client.query(`SELECT hash, created_at FROM ${MIGRATIONS_TABLE}`);
  const applied = toAppliedRows(read.rows);
  const plan = planJournalResync(applied, journal);
  const journalByHash = new Map(journal.map((entry) => [entry.hash, entry]));

  let written = 0;
  for (const restamp of plan.restamps) {
    const result = await client.query(
      `UPDATE ${MIGRATIONS_TABLE} SET created_at = $2 ` +
        "WHERE hash = $1 AND created_at IS DISTINCT FROM $2",
      [restamp.hash, restamp.to],
    );
    written += result.rowCount ?? 0;
    const entry = journalByHash.get(restamp.hash);
    log(
      `F4.94 journal re-sync: ${entry ? labelOf(entry) : shortHash(restamp.hash)} created_at ` +
        `${restamp.from} -> ${restamp.to}`,
    );
  }

  // Rows written, not statements issued: one guarded statement converges every
  // duplicate of a hash, and a statement that matched nothing must not be
  // reported as a repair.
  const planned = plan.restamps.length;
  log(
    written === planned
      ? `F4.94 journal re-sync: ${written} row(s) re-stamped`
      : `F4.94 journal re-sync: ${written} row(s) re-stamped (${planned} planned)`,
  );

  const maxAfterResync = maxStampAfterResync(applied, journal);
  for (const entry of plan.unreachable) {
    log(
      `F4.94 WARNING: journal entry ${labelOf(entry)} (when ${entry.folderMillis}) has no ` +
        `applied row and sits below the table's maximum (${maxAfterResync}); drizzle will ` +
        "never apply it here. Apply it by hand and insert its row, or re-stamp the rows " +
        "above it.",
    );
  }

  const lastStamp = lastJournalStamp(journal);
  for (const stray of plan.blockingStrays) {
    log(
      `F4.94 WARNING: ${MIGRATIONS_TABLE} row ${shortHash(stray.hash)} ` +
        `(created_at ${stray.createdAt}) is not in the journal and sits at or above a journal ` +
        `entry this database has not applied, or ahead of the journal's last entry ` +
        `(${lastStamp}). Drizzle will skip every migration stamped below it. Re-stamp that ` +
        "row below the first journal entry it shadows, or apply the shadowed entry by hand " +
        "and insert its row. Do not delete it: lowering max(created_at) re-runs every entry " +
        "above the new maximum.",
    );
  }

  return plan;
}

/** The one field of a `meta/_journal.json` entry `readMigrationFiles` does not return. */
interface JournalFileEntry {
  readonly tag: string;
}

interface JournalFile {
  readonly entries: ReadonlyArray<JournalFileEntry>;
}

/**
 * The journal as `readMigrationFiles` reads it, with each entry's `tag` zipped
 * on. A hash prefix is not what an operator reads in the journal or in a
 * migration file name, so every log line names the tag when it can.
 *
 * Zipped **by array position**. Both this and `readMigrationFiles` walk
 * `entries` in file order, so position `i` is the same entry in both — while
 * `idx` has a gap at 20 in this repository and would mismatch everything after
 * it. The length check is what makes the assumption fail loudly.
 */
function readJournalWithTags(migrationsFolder: string): ReadonlyArray<JournalStamp> {
  const files = readMigrationFiles({ migrationsFolder });
  const journalPath = resolve(migrationsFolder, "meta", "_journal.json");
  const parsed = JSON.parse(readFileSync(journalPath, "utf8")) as JournalFile;
  const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
  if (entries.length !== files.length) {
    throw new Error(
      `${journalPath} lists ${entries.length} entries but readMigrationFiles returned ` +
        `${files.length} migrations, so their tags cannot be matched to their hashes by ` +
        "position. Run the journal gate before migrating.",
    );
  }
  return files.map((file, index) => ({
    hash: file.hash,
    folderMillis: file.folderMillis,
    tag: entries[index].tag,
  }));
}

async function main(): Promise<void> {
  const client = new pg.Client({ connectionString: resolveMigrationUrl(process.env) });
  await client.connect();
  const db = drizzle(client);
  const migrationsFolder = resolve(pkgRoot, "drizzle");

  try {
    await resyncJournalStamps(client, readJournalWithTags(migrationsFolder));
    await migrate(db, { migrationsFolder });
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}

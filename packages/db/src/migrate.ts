import { config as loadEnv } from "dotenv";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
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

/** The two fields of drizzle's `MigrationMeta` the pre-flight uses. */
export interface JournalStamp {
  readonly hash: string;
  readonly folderMillis: number;
}

export interface JournalResync {
  /** Applied rows the journal describes, whose stamp is not the journal's. */
  readonly restamps: ReadonlyArray<{
    readonly hash: string;
    readonly from: number;
    readonly to: number;
  }>;
  /** Applied rows the journal does not describe, which still sit ahead of it. */
  readonly blockingStrays: ReadonlyArray<{ readonly hash: string; readonly createdAt: number }>;
}

/** The subset of `pg.Client` the pre-flight needs. `pg.Client` satisfies it structurally. */
export interface StampQueryable {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[]; rowCount: number | null }>;
}

const MIGRATIONS_TABLE = "drizzle.__drizzle_migrations";

/**
 * The same coercion drizzle itself applies to `created_at`. A NULL or an
 * unreadable value compares as `0`, which is below every journal stamp, so
 * such a row is never mistaken for one sitting ahead of the journal.
 *
 * The guarded statement below cannot repair a NULL stamp — `NULL <> $2` is
 * NULL, not true, so it matches no row — and a hash the journal describes with
 * a NULL stamp is therefore reported on every run. Drizzle's own migrator
 * never writes one; the column is merely nullable in its DDL.
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
  const appliedByHash = new Map<string, AppliedMigrationRow>();
  for (const row of applied) {
    if (!appliedByHash.has(row.hash)) appliedByHash.set(row.hash, row);
  }

  const restamps: Array<{ hash: string; from: number; to: number }> = [];
  for (const entry of journal) {
    const row = appliedByHash.get(entry.hash);
    if (!row) continue;
    const from = toMillis(row.created_at);
    if (from !== entry.folderMillis) {
      restamps.push({ hash: entry.hash, from, to: entry.folderMillis });
    }
  }

  const journalHashes = new Set(journal.map((entry) => entry.hash));
  const lastStamp = lastJournalStamp(journal);
  const blockingStrays: Array<{ hash: string; createdAt: number }> = [];
  for (const row of applied) {
    if (journalHashes.has(row.hash)) continue;
    const createdAt = toMillis(row.created_at);
    if (createdAt > lastStamp) blockingStrays.push({ hash: row.hash, createdAt });
  }

  return { restamps, blockingStrays };
}

/**
 * `F4.94`. Runs on the `bms_app` connection `main` already holds, before
 * `migrate()`, and issues no `SET ROLE` (ADR 0045 decision 3).
 *
 * There is no explicit transaction. Every statement is guarded by
 * `created_at <> $2`, so the whole thing is idempotent and a run that dies
 * halfway leaves the next one to finish it — and a failure here throws before
 * `migrate()` is called, so no migration is ever applied against a
 * half-repaired table.
 */
export async function resyncJournalStamps(
  client: StampQueryable,
  journal: ReadonlyArray<JournalStamp>,
  log: (line: string) => void = (line) => console.error(line),
): Promise<JournalResync> {
  // A fresh database has no `drizzle` schema yet: drizzle's own migrator
  // creates it. `to_regclass` answers NULL rather than raising, so it is a
  // safe probe where a plain `SELECT` would abort the run.
  const probe = await client.query(`SELECT to_regclass('${MIGRATIONS_TABLE}') AS present`);
  const present = asRecord(probe.rows[0])?.present ?? null;
  if (present === null) {
    log(`F4.94 journal re-sync: no ${MIGRATIONS_TABLE} yet, nothing to do`);
    return { restamps: [], blockingStrays: [] };
  }

  const read = await client.query(`SELECT hash, created_at FROM ${MIGRATIONS_TABLE}`);
  const plan = planJournalResync(toAppliedRows(read.rows), journal);

  for (const restamp of plan.restamps) {
    await client.query(
      `UPDATE ${MIGRATIONS_TABLE} SET created_at = $2 WHERE hash = $1 AND created_at <> $2`,
      [restamp.hash, restamp.to],
    );
    log(
      `F4.94 journal re-sync: ${shortHash(restamp.hash)} created_at ` +
        `${restamp.from} -> ${restamp.to}`,
    );
  }

  log(`F4.94 journal re-sync: ${plan.restamps.length} row(s) re-stamped`);

  const lastStamp = lastJournalStamp(journal);
  for (const stray of plan.blockingStrays) {
    log(
      `F4.94 WARNING: ${MIGRATIONS_TABLE} row ${shortHash(stray.hash)} ` +
        `(created_at ${stray.createdAt}) is not in the journal and is ahead of the ` +
        `journal's last entry (${lastStamp}). Drizzle will skip every migration stamped ` +
        "below it. Delete or re-stamp that row by hand.",
    );
  }

  return plan;
}

async function main(): Promise<void> {
  const client = new pg.Client({ connectionString: resolveMigrationUrl(process.env) });
  await client.connect();
  const db = drizzle(client);
  const migrationsFolder = resolve(pkgRoot, "drizzle");

  try {
    await resyncJournalStamps(client, readMigrationFiles({ migrationsFolder }));
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

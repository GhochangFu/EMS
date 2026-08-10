import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import pg from "pg";

/**
 * Backfills the ADR 0023 continuous aggregates (`F4.1`).
 *
 * This is a script rather than part of migration `0027` because
 * **`refresh_continuous_aggregate()` cannot run inside a transaction block** —
 * measured 2026-08-10 on TimescaleDB 2.29.1, verbatim error — and
 * `src/migrate.ts` uses Drizzle's `node-postgres` migrator, which wraps the run
 * in one. The migration therefore creates every view `WITH NO DATA`, and this
 * fills them.
 *
 * **Who this is for: an existing database with history.** The pilot carries
 * years of `telemetry.point_values` that migration `0027` cannot materialise, so
 * without this run the aggregates hold only whatever the scheduled policies
 * reach — `_1m`'s `start_offset` is 3 hours, so everything older than that stays
 * unmaterialized indefinitely. Reads still return correct numbers via the
 * real-time branch (ADR 0023 decision 4), but they pay the raw scan this feature
 * exists to avoid.
 *
 * **It is NOT what makes the tests non-vacuous.** `db:seed` inserts zero
 * telemetry rows — verified 2026-08-10; only `apps/sim` and `apps/ingest` ever
 * write `point_values` — so on a freshly seeded CI database all four aggregates
 * are legitimately empty and this run is a no-op. The equality suite therefore
 * inserts its own fixture rather than relying on seeded telemetry. An earlier
 * draft of ADR 0023 claimed the CI wiring was what prevented a vacuous pass;
 * that was wrong and decision 5 records the correction. CI still runs it, for a
 * narrower reason: an unexercised script rots, exactly as
 * `apps/ingest/Dockerfile` did while CI stayed green (`F1.1`).
 *
 * Empty is therefore not an error and is not treated as one.
 *
 * **ADR 0024 (`F4.2`) bounded this run below.** It used to refresh `NULL →
 * now()` — the whole history — which is safe only while raw is complete. With
 * retention now dropping raw chunks at 730 days, refreshing a range raw no
 * longer covers *deletes* the aggregate rows for it (measured: 34,596 → 7,068)
 * and nothing can rebuild them. So it starts at raw's oldest surviving chunk;
 * see `oldestRawChunkStart`, which is where the reasoning lives.
 *
 * Order matters and is not alphabetical: each level reads the one below, so
 * refreshing a parent before its source materialises nothing.
 *
 * Scripts run with cwd = `packages/db` via `pnpm --filter @bms/db`.
 */
const pkgRoot = process.cwd();

loadEnv({ path: resolve(pkgRoot, "../../apps/api/.env") });
loadEnv({ path: resolve(pkgRoot, ".env") });

/** Coarsest last — a level refreshed before its source materialises nothing. */
const LEVELS = [
  "telemetry.point_values_1m",
  "telemetry.point_values_5m",
  "telemetry.point_values_1h",
  "telemetry.point_values_1d",
] as const;

/**
 * Progress goes to stderr via `console.error`, matching the only console call
 * `migrate.ts` and `seed.ts` make. §4.5 reserves `console.log` for the Pino
 * logger, and these CLI scripts have no Nest container to resolve one from.
 */
function report(line: string): void {
  console.error(line);
}

/** Postgres `object_in_use` — TimescaleDB raises it for a concurrent refresh. */
const CONCURRENT_REFRESH = "55P03";
const MAX_ATTEMPTS = 5;
const RETRY_DELAY_MS = 3_000;

/**
 * Refreshes one level, retrying a concurrent-refresh conflict.
 *
 * Found by rehearsing this script on 2026-08-10 rather than by reasoning about
 * it: the four scheduled policies run every 1/5/30/60 minutes, and a manual
 * backfill that overlaps one fails outright with
 *
 *   55P03: could not refresh continuous aggregate "point_values_1h" due to a
 *   concurrent refresh
 *   detail: A concurrent refresh on window [...] is already in progress.
 *
 * The first version had no retry, so it exited non-zero and left `_1h` and `_1d`
 * at `-infinity` while `_1m` and `_5m` were done — a half-materialised chain from
 * a command that looks like it either works or doesn't. The conflict is transient
 * by construction: policy runs are short and bounded by their own `start_offset`.
 */
async function refreshLevel(
  client: pg.Client,
  view: string,
  from: Date | null,
): Promise<void> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      // Lower-bounded at raw's oldest chunk, capped at `now()` — see
      // `oldestRawChunkStart` and the comment in `main`.
      await client.query(
        `CALL refresh_continuous_aggregate('${view}', $1::timestamptz, now())`,
        [from],
      );
      return;
    } catch (err: unknown) {
      const code = (err as { code?: string } | null)?.code;
      if (code !== CONCURRENT_REFRESH || attempt === MAX_ATTEMPTS) {
        throw err;
      }
      report(
        `[F4.1] ${view}: a scheduled policy is refreshing the same window; ` +
          `retrying in ${RETRY_DELAY_MS / 1000}s (attempt ${attempt}/${MAX_ATTEMPTS})`,
      );
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }
}

/**
 * The oldest `time` raw can still account for — the `range_start` of the oldest
 * `telemetry.point_values` chunk. `null` when the hypertable has no chunks at
 * all, which is a fresh database.
 *
 * **This is the bound that stops this script destroying the archive** (ADR 0024
 * decision 6). Before `F4.2` it refreshed `NULL → now()`: open at the start,
 * the entire history. That was correct only while raw was complete.
 *
 * Measured 2026-08-10 on TimescaleDB 2.29.1 (ADR 0024 facts 6 and 7). Dropping
 * raw chunks — which `add_retention_policy` now does at 730 days — leaves the
 * aggregate rows perfectly intact: 34,596 before, 34,596 after, bit-identical.
 * But **a refresh over a range raw no longer covers deletes them**: 34,596 →
 * 7,068, because a refresh recomputes from raw and raw is now empty there. And
 * per fact 14 that deletion cannot be undone by any refresh.
 *
 * So an unbounded run, any time after the first retention drop, would erase
 * exactly the `_1h`/`_1d` history that ADR 0023 decision 7 keeps forever — from
 * the command documented as the way to *repair* the aggregates.
 *
 * The bound is derived rather than configured, and deliberately so: a constant
 * here (`now() - 730 days`) would be a second copy of the retention interval,
 * free to drift from the policy that actually governs it. Raw's own chunk list
 * cannot drift from raw.
 *
 * Note this is the chunk boundary, not `min(time)` — a chunk is the unit
 * retention drops, so its `range_start` is the earliest instant raw could still
 * hold data for. Using `min(time)` would exclude the empty leading part of a
 * live chunk and could delete aggregate rows for buckets raw is still entitled
 * to receive late arrivals into.
 */
async function oldestRawChunkStart(client: pg.Client): Promise<Date | null> {
  const { rows } = await client.query<{ range_start: Date | null }>(
    `SELECT min(range_start) AS range_start
       FROM timescaledb_information.chunks
      WHERE hypertable_schema = 'telemetry'
        AND hypertable_name   = 'point_values'`,
  );
  return rows[0]?.range_start ?? null;
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to refresh aggregates");
  }

  // A single client, not a pool: the refresh must not be wrapped in a
  // transaction, and a pool could hand successive statements to different
  // sessions mid-chain.
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();

  // A refresh cannot be wrapped in a transaction, so `statement_timeout` is the
  // only bound available on it. Generous — a first backfill over years of pilot
  // history is legitimately slow — but not unbounded, so a wedged refresh fails
  // instead of holding a session open indefinitely. `lock_timeout` is separate and
  // short: waiting on a lock is never the slow part of a refresh, so a long wait
  // means contention worth failing on.
  await client.query("SET statement_timeout = '30min'");
  await client.query("SET lock_timeout = '30s'");

  try {
    const from = await oldestRawChunkStart(client);
    if (from === null) {
      // A fresh database: no raw chunks, so every aggregate is legitimately
      // empty and there is nothing to refresh. Refreshing anyway would be
      // harmless today, but "no source data" is exactly the state in which an
      // unbounded refresh is destructive, so this returns rather than relying on
      // the aggregates also happening to be empty.
      report("[F4.2] telemetry.point_values has no chunks; nothing to refresh");
      return;
    }
    report(
      `[F4.2] refreshing from ${from.toISOString()} (oldest raw chunk) to now() — ` +
        `earlier ranges are no longer reproducible from raw and must not be refreshed`,
    );

    for (const view of LEVELS) {
      const started = Date.now();
      // Bounded BELOW at raw's oldest chunk (see `oldestRawChunkStart`) and
      // **capped at `now()`** — not `NULL, NULL`.
      //
      // A continuous aggregate's watermark only ever moves forward, and a full
      // refresh follows the data rather than the clock. Measured 2026-08-10 on
      // the pilot: 714 `point_values` rows carry `time > now()`, persistently ~34
      // minutes ahead, because `apps/ingest/src/host/normaliser.ts` takes the
      // device's `sample.at` with no future-horizon clamp. `NULL, NULL` therefore
      // parked all four watermarks *ahead of the present*, and for that whole
      // window the real-time branch — the entire point of decision 4 — covered
      // nothing, leaving stored, understated buckets with no error anywhere.
      //
      // Capping at `now()` leaves the watermark at the present, where the live
      // branch picks up everything after it, including the future-dated rows. The
      // unclamped ingest timestamp is a separate defect and is not fixed here.
      await refreshLevel(client, view, from);
      const { rows } = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM ${view}`,
      );
      const elapsed = ((Date.now() - started) / 1000).toFixed(2);
      report(`[F4.1] ${view}: ${rows[0]?.n ?? "?"} rows in ${elapsed}s`);
    }
  } finally {
    await client.end();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

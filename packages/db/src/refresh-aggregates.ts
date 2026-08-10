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
async function refreshLevel(client: pg.Client, view: string): Promise<void> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      // Open at the start, capped at `now()` — see the comment in `main`.
      await client.query(`CALL refresh_continuous_aggregate('${view}', NULL, now())`);
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
    for (const view of LEVELS) {
      const started = Date.now();
      // Open at the start, but **capped at `now()`** — not `NULL, NULL`.
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
      await refreshLevel(client, view);
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

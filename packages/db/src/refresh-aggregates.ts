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

  try {
    for (const view of LEVELS) {
      const started = Date.now();
      // `NULL, NULL` is a full refresh over all of time — correct for a
      // backfill. The scheduled policies then maintain a bounded window
      // (ADR 0023 decision 5).
      await client.query(`CALL refresh_continuous_aggregate('${view}', NULL, NULL)`);
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

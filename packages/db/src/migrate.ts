import { config as loadEnv } from "dotenv";
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

async function main(): Promise<void> {
  const client = new pg.Client({ connectionString: resolveMigrationUrl(process.env) });
  await client.connect();
  const db = drizzle(client);

  try {
    await migrate(db, { migrationsFolder: resolve(pkgRoot, "drizzle") });
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

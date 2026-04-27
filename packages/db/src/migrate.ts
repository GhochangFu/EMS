import { config as loadEnv } from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { resolve } from "node:path";
import pg from "pg";

/** Scripts run with cwd = `packages/db` via `pnpm --filter @bms/db`. */
const pkgRoot = process.cwd();

loadEnv({ path: resolve(pkgRoot, "../../apps/api/.env") });
loadEnv({ path: resolve(pkgRoot, ".env") });

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for migrations");
  }

  const pool = new pg.Pool({ connectionString: databaseUrl });
  const db = drizzle(pool);

  try {
    await migrate(db, { migrationsFolder: resolve(pkgRoot, "drizzle") });
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

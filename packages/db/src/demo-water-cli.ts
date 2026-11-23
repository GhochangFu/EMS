import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

import pg from "pg";

import { IONX_ADMIN_EMAIL, IONX_ORG_CODE, runWaterDemo } from "./demo-water";
import { createSeedPool, resolveSeedSuperuserUrl } from "./seed-tenant";

/**
 * `pnpm --filter @bms/db demo:water` — ADR 0079 Amendment 1. A one-off,
 * idempotent command, run once on the demo host after `roles → migrate → seed`.
 * It is deliberately NOT called from `seed.ts`. Connects the way `seed.ts`
 * does: `DATABASE_URL` (`bms_owner`) for the tenant rows, the superuser for
 * the login. See `demo-water.ts`.
 */

const pkgRoot = process.cwd();

loadEnv({ path: resolve(pkgRoot, "../../apps/api/.env") });
loadEnv({ path: resolve(pkgRoot, ".env") });

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for demo:water");
  }
  const pool = createSeedPool(databaseUrl);
  const superuserPool = new pg.Pool({
    connectionString: resolveSeedSuperuserUrl(databaseUrl, process.env),
  });
  try {
    const result = await runWaterDemo(pool, superuserPool);
    const verdict =
      result.written === 0
        ? "already present — this run changed nothing"
        : `${result.written} row(s) written`;
    // stdout, not console.log: §4.5 reserves that for Pino, and a CLI has no
    // Nest container to resolve one from (the `roles.ts` convention).
    process.stdout.write(`[demo:water] ${IONX_ORG_CODE} (${result.organizationId}): ${verdict}.\n`);
    if (result.renamed > 0) {
      process.stdout.write(
        `[demo:water] ${result.renamed} row(s) still held a name from before ADR 0142 Amendment 4 and now hold the new one.\n`,
      );
    }
    process.stdout.write(
      `[demo:water] post-condition: ${JSON.stringify({ ...result.tenant, ...result.identity })}\n`,
    );
    process.stdout.write(
      `[demo:water] login ${IONX_ADMIN_EMAIL}. Restart the simulator so it reads the new assets.\n`,
    );
  } finally {
    await pool.end();
    await superuserPool.end();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

import pg from "pg";

import { IONX_ADMIN_EMAIL, IONX_ORG_CODE, runIonExchangeDemo } from "./demo-ion-exchange";
import { createSeedPool, resolveSeedSuperuserUrl } from "./seed-tenant";

/**
 * `pnpm --filter @bms/db demo:ion-exchange` — ADR 0079 Amendment 1. A one-off,
 * idempotent command, run once on the demo host after `roles → migrate → seed`.
 * It is deliberately NOT called from `seed.ts`. Connects the way `seed.ts`
 * does: `DATABASE_URL` (`bms_owner`) for the tenant rows, the superuser for
 * the login. See `demo-ion-exchange.ts`.
 */

const pkgRoot = process.cwd();

loadEnv({ path: resolve(pkgRoot, "../../apps/api/.env") });
loadEnv({ path: resolve(pkgRoot, ".env") });

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for demo:ion-exchange");
  }
  const pool = createSeedPool(databaseUrl);
  const superuserPool = new pg.Pool({
    connectionString: resolveSeedSuperuserUrl(databaseUrl, process.env),
  });
  try {
    const result = await runIonExchangeDemo(pool, superuserPool);
    const verdict =
      result.written === 0
        ? "already present — this run changed nothing"
        : `${result.written} row(s) written`;
    // stdout, not console.log: §4.5 reserves that for Pino, and a CLI has no
    // Nest container to resolve one from (the `roles.ts` convention).
    process.stdout.write(`[demo:ion-exchange] ${IONX_ORG_CODE} (${result.organizationId}): ${verdict}.\n`);
    process.stdout.write(
      `[demo:ion-exchange] post-condition: ${JSON.stringify({ ...result.tenant, ...result.identity })}\n`,
    );
    process.stdout.write(
      `[demo:ion-exchange] login ${IONX_ADMIN_EMAIL}. Restart the simulator so it reads the new assets.\n`,
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

import { createSeedPool } from "./seed-tenant";
import { verifyHierarchySeed } from "./verify-hierarchy-seed";

/**
 * `pnpm --filter @bms/db verify:hierarchy` — runs the boot gate on its own,
 * against a database that is already seeded.
 *
 * **Fail-closed on a live ladder-code collision, by design** (owner ruling 12,
 * 2026-09-28). `seed.ts` passes `verifyHierarchySeed` the collision skips its
 * own `seedEskomLadderRules` run returned, and the gate exempts exactly those
 * assets from its uncovered-electrical-asset check. This command runs no seed,
 * so it has no such list and passes none: an ESKOM electrical asset left with
 * no ladder rule because another rule holds its codes (a rename-and-reuse, for
 * example) fails here, while the same database boots through `pnpm db:seed`,
 * which logs the exemption. Re-run the seed to see which asset it exempts.
 */
async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }
  // `createSeedPool`, not a bare `pg.Pool`: `E7.1a` made the verifier run its
  // location counts inside per-organization transactions, and those need the
  // single-connection pool `withOrganization` asserts.
  const pool = createSeedPool(databaseUrl);
  try {
    await verifyHierarchySeed(pool);
    process.stdout.write("verifyHierarchySeed: ok\n");
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

import { createSeedPool } from "./seed-tenant";
import { verifyHierarchySeed } from "./verify-hierarchy-seed";

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

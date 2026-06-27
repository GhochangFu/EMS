import pg from "pg";

import { verifyHierarchySeed } from "./verify-hierarchy-seed";

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }
  const pool = new pg.Pool({ connectionString: databaseUrl });
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

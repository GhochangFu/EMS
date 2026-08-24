import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";

import * as schema from "./schema/index";

export type BmsDb = NodePgDatabase<typeof schema>;
/** The schema type `withTenant`'s `BmsTx` needs to type a transaction handle. */
export type BmsSchema = typeof schema;

/**
 * Creates a Drizzle client over a single `pg.Pool`. Caller owns pool lifecycle.
 */
export function createDb(pool: pg.Pool): BmsDb {
  return drizzle(pool, { schema });
}

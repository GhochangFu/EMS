import { sql } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import type { NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import type { ExtractTablesWithRelations } from "drizzle-orm";

import type { BmsDb, BmsSchema } from "@bms/db";

/**
 * `F4.16` / ADR 0043 decision 10 — runs `fn` inside a transaction that has named
 * its organization.
 *
 * `SET LOCAL`, not `SET`. `DatabaseModule` pools connections and reuses them
 * across requests, so a plain `SET` hands the previous request's tenant to the
 * next caller on the same connection. `SET LOCAL` is discarded at COMMIT or
 * ROLLBACK, which is why decision 10 requires the transaction for **reads** as
 * well as writes.
 *
 * `set_config(..., true)` rather than literal `SET LOCAL`: it takes a bind
 * parameter, so an organization id can never be concatenated into SQL.
 *
 * The callback receives the **transaction**, typed as what Drizzle actually
 * hands over. It is not cast to `BmsDb`: the two types differ, and a
 * `as unknown as BmsDb` would compile while hiding a caller reaching for a
 * method the transaction does not carry — including `.transaction` itself,
 * which would silently nest.
 */
export type BmsTx = PgTransaction<
  NodePgQueryResultHKT,
  BmsSchema,
  ExtractTablesWithRelations<BmsSchema>
>;

export async function withTenant<T>(
  db: BmsDb,
  organizationId: string,
  fn: (tx: BmsTx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_organization', ${organizationId}, true)`);
    return fn(tx);
  });
}

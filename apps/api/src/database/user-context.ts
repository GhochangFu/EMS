import { sql } from "drizzle-orm";

import type { BmsDb } from "@bms/db";

import type { BmsTx } from "./tenant-context";

/**
 * `F3.85` PR 4 / ADR 0099 decision 8 — runs `fn` inside a transaction that has
 * named its **user**, the per-user sibling of `withTenant`.
 *
 * The copilot's conversations, messages and pending changes are each one
 * user's alone: their `user_isolation` policy compares `user_id` with the
 * `app.current_user` setting, and there is no tenant policy on them.
 *
 * Transaction-local for the reason `withTenant` gives: the pool reuses
 * connections across requests, so a session-wide setting would hand one
 * user's id to the next caller on the same connection.
 *
 * Always `set_config`, never `SET` — `current_user` is a reserved word in
 * PostgreSQL and `SET LOCAL app.current_user` does not parse. `set_config` also
 * takes a bind parameter, so an id is never concatenated into SQL.
 *
 * `opts.organizationId` also sets `app.current_organization` in the same
 * transaction, so one transaction can write a per-user row and a tenant row
 * together (the two usage counters, ADR 0099 Amendment 1 A1).
 */
export async function withUser<T>(
  db: BmsDb,
  userId: string,
  fn: (tx: BmsTx) => Promise<T>,
  opts?: { organizationId?: string },
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_user', ${userId}, true)`);
    if (opts?.organizationId !== undefined) {
      await tx.execute(sql`select set_config('app.current_organization', ${opts.organizationId}, true)`);
    }
    return fn(tx);
  });
}

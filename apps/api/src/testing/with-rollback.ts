import { is, TransactionRollbackError } from "drizzle-orm";

import type { BmsDb } from "@bms/db";

/**
 * `F3.3` (plan §1 Q-G) — the one shared `withRollback`, for **new** suites.
 *
 * Eleven private copies of this body exist under `apps/api/src`, one of them
 * exported from `alarms/alarm-lifecycle.integration.spec.ts:87`. The body here
 * is that one verbatim. The eleven are deliberately left untouched (AGENTS.md
 * §9 rule 9 — a refactor of eleven suites is not a side effect of a feature
 * row); this exists so the twelfth copy is not written, and so the next new
 * integration suite has an obvious import rather than a paste.
 *
 * **What it does and why the shape matters.** `tx.rollback()` throws a
 * `TransactionRollbackError`, which Drizzle uses to unwind the transaction.
 * Catching exactly that and rethrowing everything else is what lets a suite
 * write "run this scenario, then discard it" in one line while a real failure
 * still reaches the runner.
 *
 * **A case that simply returns COMMITS**, and its fixture becomes permanent —
 * the `F3.60` defect that left 298 rows in the shared development database and
 * broke a suite it does not touch. `tests/f3.60-withrollback-cases-roll-back.test.ts`
 * gates that: every `await withRollback(` in a spec needs at least one
 * `tx.rollback()`, comments stripped. Importing this helper does not exempt a
 * caller from that rule; it is the same call, counted the same way.
 *
 * `is()`, not `instanceof`: a duplicated `drizzle-orm` in the dependency tree
 * gives two distinct `TransactionRollbackError` classes, and `instanceof` then
 * rethrows the very error this exists to swallow.
 */
export async function withRollback(
  db: BmsDb,
  run: Parameters<BmsDb["transaction"]>[0],
): Promise<void> {
  await db.transaction(run).catch((err: unknown) => {
    if (!is(err, TransactionRollbackError)) {
      throw err;
    }
  });
}

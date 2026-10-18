import type pg from "pg";

/**
 * `F4.132` / `F4.137` (ADR 0102, migration `0113`) — plant a row the database's
 * keys now forbid, so a suite can keep proving the service guard that refuses it.
 *
 * Since `0113`, three composite foreign keys hold an RTU's organization to its
 * location's, an asset's organization to its location's, and a wired asset's
 * `rtu_id` to an RTU at the asset's own location. A handful of suites prove that
 * a service guard (`resolveAgreedOrg`, the `rtus` join's organization predicate,
 * `canManageDashboard`'s asset arm, the onboarding inventory joins) refuses or
 * ignores exactly such a disagreeing row. The keys make that row unreachable
 * through any writer, but the guards are production code and stay the first
 * refusal; without a planted row they lose their only gate.
 *
 * **What it does.** `session_replication_role = replica` stops every trigger
 * whose firing mode is `origin` from running — the RI triggers that enforce the
 * foreign keys, and every ordinary trigger too (`locations_tree_guard` among
 * them). The setting is `SET LOCAL`, so it ends with the transaction.
 *
 * **Rules for a caller.**
 * - **Superuser only.** `session_replication_role` is a superuser setting;
 *   `bms_owner` and `bms_fleet` get `42501`. Open the pool with
 *   `resolveIntegrationRoleUrl(url, "superuser", process.env)`.
 * - **Plant only the forbidden state.** Everything the case then exercises runs
 *   with constraints on, so the production claim of each caller is unchanged.
 * - **Delete the row in teardown.** A committed plant is an FK-violating row on
 *   the shared database until then, exactly as the suites held before `0113`.
 *
 * Test infrastructure under `src/testing/`: no runtime file imports it.
 */

/**
 * Runs `fn` on one client inside `BEGIN … COMMIT` with constraints off, and
 * commits the plant (rolls back on a throw). For a fixture another pool must
 * then see.
 */
export async function plantWithConstraintsOff<T>(
  pool: pg.Pool,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL session_replication_role = replica");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * For a caller already inside a superuser transaction: switches constraints off,
 * runs `fn`, and switches them back on before returning, so the code under test
 * runs with every key enforced. `run` issues one SQL statement on that
 * transaction (for Drizzle, `(s) => tx.execute(sql.raw(s))`).
 *
 * On a throw it does not try to switch back: the transaction is aborted and
 * `SET LOCAL` ends with it.
 */
export async function withConstraintsOff<T>(
  run: (statement: string) => Promise<unknown>,
  fn: () => Promise<T>,
): Promise<T> {
  await run("SET LOCAL session_replication_role = replica");
  const result = await fn();
  await run("SET LOCAL session_replication_role = origin");
  return result;
}

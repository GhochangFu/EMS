import pg from "pg";

/**
 * `E3.1` (ADR 0122 decision 7.2) — the timeline of a suite's own work orders, removed
 * before the work orders themselves.
 *
 * `bms.work_order_events` is append-only for the two roles the API connects as:
 * migration `0144` revokes `UPDATE` and `DELETE` from `bms_tenant` and `bms_fleet`. So a
 * suite's usual cleanup connection (the fleet pool) cannot delete an event, and the
 * foreign key from an event to its work order then refuses the work order's delete.
 * This opens ONE short superuser connection — the migrator's role, the only one that
 * may delete here — runs one bounded delete, and closes it. The CALLER resolves the
 * superuser URL (`resolveIntegrationRoleUrl(url, "superuser", process.env)`) and passes
 * it in, as `constraints-off.ts` asks of its callers: only a test file may import the
 * integration gate (`tests/adr-0045-owner-and-superuser-url.test.ts`).
 *
 * Test-only. Nothing in `apps/api/src` outside `testing/` and the suites may import
 * this: the product never deletes an event.
 *
 * Every variant is bounded to rows the calling suite wrote: by its per-run asset code
 * prefix, by that family aged past a concurrent run (`olderThanMinutes`, the stale
 * sweep), or by the exact work-order ids it created.
 */
export type WorkOrderEventsCleanup =
  | { readonly assetCodeLike: string; readonly olderThanMinutes?: number }
  | { readonly workOrderIds: readonly string[] };

/**
 * Deletes the events of the work orders `by` names, on one short superuser connection
 * to `superuserUrl`. A no-op for an empty id list.
 */
export async function deleteWorkOrderEvents(superuserUrl: string, by: WorkOrderEventsCleanup): Promise<void> {
  if ("workOrderIds" in by && by.workOrderIds.length === 0) {
    return;
  }
  const client = new pg.Client({
    connectionString: superuserUrl,
    connectionTimeoutMillis: 5_000,
  });
  await client.connect();
  try {
    if ("workOrderIds" in by) {
      await client.query("DELETE FROM bms.work_order_events WHERE work_order_id = ANY($1)", [[...by.workOrderIds]]);
      return;
    }
    const minutes = by.olderThanMinutes ?? 0;
    await client.query(
      `DELETE FROM bms.work_order_events
        WHERE work_order_id IN (
          SELECT w.id FROM bms.work_orders w
            JOIN bms.assets a ON a.id = w.asset_id
           WHERE a.code LIKE $1
             AND a.created_at <= now() - make_interval(mins => $2::integer)
        )`,
      [by.assetCodeLike, minutes],
    );
  } finally {
    await client.end();
  }
}

/** Which fixture users to delete: one by id, or a family by email aged past a concurrent run. */
export type FixtureUsersCleanup =
  | { readonly userId: string }
  | { readonly emailLike: string; readonly olderThanMinutes: number };

/**
 * Deletes a suite's OWN fixture users on one short superuser connection: the fleet
 * role holds no `DELETE` on `bms.users`. Bounded to one id, or to an email family that
 * is older than a run still in flight could be. Call it after the user's events are
 * gone ({@link deleteWorkOrderEvents}); `actor_id` references the user.
 */
export async function deleteFixtureUsers(superuserUrl: string, by: FixtureUsersCleanup): Promise<void> {
  const client = new pg.Client({ connectionString: superuserUrl, connectionTimeoutMillis: 5_000 });
  await client.connect();
  try {
    if ("userId" in by) {
      await client.query("DELETE FROM bms.users WHERE id = $1", [by.userId]);
      return;
    }
    await client.query(
      "DELETE FROM bms.users WHERE email LIKE $1 AND created_at < now() - make_interval(mins => $2::integer)",
      [by.emailLike, by.olderThanMinutes],
    );
  } finally {
    await client.end();
  }
}

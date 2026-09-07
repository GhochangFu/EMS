function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

type Pool = {
  query: <R>(text: string, values?: unknown[]) => Promise<{ rows: R[] }>;
};

/**
 * `F3.46` / `F3.10` — the `dedupe_key` index proves against Postgres, because
 * the predicate as the planner stored it is not visible in the static `.sql`
 * file. Reads only; writes nothing.
 *
 * `0065` (F3.46) created `notification_deliveries_dedupe_skip_idx` on
 * `(channel_id, dedupe_key) WHERE status = 'skipped_deduped'` for
 * `hasRecordedSkip`. `0066` (F3.10 U3) replaced it with the wider
 * `notification_deliveries_channel_key_idx` — same key columns,
 * `WHERE dedupe_key IS NOT NULL` — which serves `hasRecordedSkip` and
 * `eventDeliveryBlocked` both (`dedupe_key = $x` implies `IS NOT NULL`; the
 * status filter is applied after), and dropped the narrower one as readerless.
 * `tests/f3.46-notification-deliveries-dedupe-index.test.ts` still asserts
 * the frozen `0065` file; this suite asserts what the database holds now.
 */
export async function runDedupeIndexTests(pool: Pool): Promise<void> {
  const { rows } = await pool.query<{ indexname: string; indexdef: string }>(
    `SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname = 'bms'
        AND tablename = 'notification_deliveries'
        AND indexname IN ('notification_deliveries_channel_key_idx',
                          'notification_deliveries_dedupe_skip_idx')`,
  );

  const wider = rows.find((row) => row.indexname === "notification_deliveries_channel_key_idx");
  assert(
    wider !== undefined,
    "notification_deliveries_channel_key_idx is missing. " +
      "Run pnpm db:migrate to apply 0066_alarm_lifecycle.sql.",
  );

  const indexdef = wider!.indexdef;
  assert(
    indexdef.includes("(channel_id, dedupe_key)"),
    `notification_deliveries_channel_key_idx's indexdef does not key on (channel_id, dedupe_key): ${indexdef}`,
  );
  // Postgres renders the stored predicate as `WHERE (dedupe_key IS NOT NULL)`;
  // the `IS NOT NULL` is what rules out a later recreate with the predicate
  // negated or narrowed back to one status.
  assert(
    indexdef.includes("dedupe_key IS NOT NULL"),
    `notification_deliveries_channel_key_idx's indexdef has no "dedupe_key IS NOT NULL" predicate: ${indexdef}`,
  );

  assert(
    rows.every((row) => row.indexname !== "notification_deliveries_dedupe_skip_idx"),
    "notification_deliveries_dedupe_skip_idx still exists. 0066 drops it: the channel-key " +
      "index has the same key columns and serves hasRecordedSkip, so the narrower one is " +
      "a write on every skip row for no reader of its own.",
  );
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

type Pool = {
  query: <R>(text: string, values?: unknown[]) => Promise<{ rows: R[] }>;
};

/**
 * `F3.46` — the partial index migration `0065` proves against Postgres,
 * because the predicate as the planner stored it is not visible in the
 * static `.sql` file. Reads only; writes nothing.
 */
export async function runDedupeIndexTests(pool: Pool): Promise<void> {
  const { rows } = await pool.query<{ indexdef: string }>(
    `SELECT indexdef FROM pg_indexes
      WHERE schemaname = 'bms'
        AND tablename = 'notification_deliveries'
        AND indexname = 'notification_deliveries_dedupe_skip_idx'`,
  );

  assert(
    rows.length === 1,
    `expected exactly one notification_deliveries_dedupe_skip_idx index, found ${rows.length}. ` +
      "Run pnpm db:migrate to apply 0065_notification_deliveries_dedupe_index.sql.",
  );

  const indexdef = rows[0].indexdef;
  assert(
    indexdef.includes("(channel_id, dedupe_key)"),
    `notification_deliveries_dedupe_skip_idx's indexdef does not key on (channel_id, dedupe_key): ${indexdef}`,
  );
  // `= 'skipped_deduped'` and not the bare value: Postgres renders the stored
  // predicate as `((status)::text = 'skipped_deduped'::text)`, and the equality
  // sign is what rules out a later recreate with the predicate negated.
  assert(
    indexdef.includes("= 'skipped_deduped'"),
    `notification_deliveries_dedupe_skip_idx's indexdef has no "= 'skipped_deduped'" predicate: ${indexdef}`,
  );
}

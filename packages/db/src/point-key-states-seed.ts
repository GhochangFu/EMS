import type pg from "pg";

/**
 * One row of `bms.point_key_states` (migration `0097`, `F3.74` D1): what one value of one point
 * key means. `tone` is `closed | open | tripped` — the CHECK in `0097`, which
 * `tests/f3.74-point-key-states-schema.test.ts` compares with `pointKeyStateToneSchema`.
 */
export interface PointKeyStateSeedEntry {
  readonly pointKeyCode: string;
  readonly value: number;
  readonly label: string;
  readonly tone: "closed" | "open" | "tripped";
}

/** D1 — `breaker_main` 0 is OPEN, 1 is CLOSED; `breaker_trip` 1 is TRIPPED. */
export const POINT_KEY_STATE_SEED: readonly PointKeyStateSeedEntry[] = [
  { pointKeyCode: "breaker_main", value: 0, label: "OPEN", tone: "open" },
  { pointKeyCode: "breaker_main", value: 1, label: "CLOSED", tone: "closed" },
  { pointKeyCode: "breaker_trip", value: 1, label: "TRIPPED", tone: "tripped" },
];

/**
 * D1 — seeds `bms.point_key_states`. The rows are seed-owned, so the conflict clause is `DO
 * UPDATE`: a label or tone edited by hand returns to the seeded value on the next `pnpm db:seed`.
 * `DO NOTHING` would leave the edit in place. The statement asserts its own row count — a row
 * that never landed (a missing `bms.point_keys` parent fails on the foreign key, but a future
 * change to the conflict clause could skip silently) is an error, not a quiet success.
 *
 * Call it after `seedPointKeyCatalog` (the foreign key needs `breaker_main` and `breaker_trip`),
 * with no tenant context: the table is global vocabulary with no policy.
 *
 * @param pool anything with `pg`'s `query` — the seed's pool, or one client inside a transaction.
 * @returns the number of rows written (always the seed's length).
 */
export async function seedPointKeyStates(pool: Pick<pg.Pool, "query">): Promise<number> {
  const params: Array<string | number> = [];
  const tuples: string[] = [];
  for (const entry of POINT_KEY_STATE_SEED) {
    const base = params.length;
    params.push(entry.pointKeyCode, entry.value, entry.label, entry.tone);
    tuples.push(`($${base + 1}, $${base + 2}::double precision, $${base + 3}, $${base + 4})`);
  }
  const result = await pool.query(
    `INSERT INTO bms.point_key_states (point_key_code, value, label, tone)
     VALUES ${tuples.join(", ")}
     ON CONFLICT (point_key_code, value) DO UPDATE SET label = EXCLUDED.label, tone = EXCLUDED.tone`,
    params,
  );
  const count = result.rowCount ?? 0;
  if (count !== POINT_KEY_STATE_SEED.length) {
    throw new Error(
      `seedPointKeyStates: expected ${POINT_KEY_STATE_SEED.length} rows written, got ${count}`,
    );
  }
  return count;
}

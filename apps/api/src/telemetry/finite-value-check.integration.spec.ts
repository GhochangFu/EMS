import type pg from "pg";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const ASSET = "00000000-0000-4000-8000-0000f4320001";
const POINT = "f4_32_probe";

/**
 * Runs one insert inside a transaction that is **always rolled back**, and
 * reports whether the database refused it.
 *
 * **Nothing here commits, deliberately.** The first version of this suite
 * committed its probe row into whatever `DATABASE_URL` names, which is the exact
 * hazard migration `0031`'s own exception message warns about: a raw row that a
 * continuous aggregate absorbs cannot be un-absorbed by deleting it (AGENTS.md
 * §4.4), so a `DELETE`-based cleanup is not a cleanup. Proving that a `CHECK`
 * rejects a value never needs a commit — and the round-trip assertion still sees
 * its own insert, because a transaction reads its own writes.
 *
 * The value is passed as **text** and cast in SQL rather than bound as a JS
 * number, because `node-postgres` serialises `NaN` and `Infinity` in ways that
 * would make this a test of the driver rather than of the constraint.
 */
async function withRolledBackInsert<T>(
  pool: pg.Pool,
  literal: string,
  onInserted: (client: pg.PoolClient) => Promise<T>,
): Promise<{ rejected: boolean; result?: T }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    try {
      await client.query(
        `INSERT INTO telemetry.point_values ("time", asset_id, point_key, value)
         VALUES (now(), $1::uuid, $2, $3::float8)`,
        [ASSET, POINT, literal],
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      assert(
        /point_values_value_finite_check/.test(message),
        `insert of ${literal} failed for the wrong reason: ${message}`,
      );
      return { rejected: true };
    }
    return { rejected: false, result: await onInserted(client) };
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
  }
}

/**
 * `F4.32` — the "telemetry values are finite" guarantee, asserted against the
 * database rather than against the application that used to hold it.
 *
 * ADR 0026 decision 5 found the guarantee living in `apps/ingest`'s normaliser
 * while `telemetry.point_values.value` carried no constraint at all, so any
 * direct writer could store `'NaN'::float8`. **This suite writes as that direct
 * writer** — raw SQL, bypassing the normaliser entirely — because a test that
 * went through the ingest path would prove only that the ingest path still
 * works, which was never in doubt.
 *
 * ## Why the constraint is a range test and not `CHECK (value = value)`
 *
 * `F4.32` prescribed the classic NaN idiom, which relies on IEEE 754's
 * `NaN != NaN`. **PostgreSQL deliberately does not implement that rule**: it
 * defines `NaN` as equal to itself and greater than every other value, so that
 * float columns can be sorted and used in tree indexes. `value = value` is
 * therefore TRUE for `NaN`, and the prescribed constraint accepts exactly the
 * value it was written to reject — measured, not reasoned about:
 *
 *     CREATE TEMP TABLE t (v float8 CHECK (v = v));
 *     INSERT INTO t VALUES ('NaN');   -- INSERT 0 1
 *
 * The range form rejects `NaN` *because of* that same ordering rule, and covers
 * `±Infinity` as well — which matches what the normaliser actually guarantees
 * (finite), rather than the narrower not-NaN the prescribed form aimed at.
 */
export async function assertNonFiniteValuesAreRejected(pool: pg.Pool): Promise<void> {
  for (const literal of ["NaN", "Infinity", "-Infinity"]) {
    const { rejected } = await withRolledBackInsert(pool, literal, async () => undefined);
    assert(
      rejected,
      `the database accepted ${literal} into telemetry.point_values.value — ` +
        `point_values_value_finite_check is missing or too weak`,
    );
  }
}

/**
 * The other direction, and the half that is easy to leave out: a constraint
 * rejecting *everything* would satisfy every case above.
 */
export async function assertFiniteValueStillAccepted(pool: pg.Pool): Promise<void> {
  const { rejected, result } = await withRolledBackInsert(pool, "42.5", async (client) => {
    // Bounded by `time` as well as `point_key`. Without a time predicate this
    // scans all 17 chunks and decompresses 6 of them — cheap on the pilot,
    // not cheap later, and the aggregates exist precisely so reads do not do
    // that.
    const { rows } = await client.query<{ value: number }>(
      `SELECT value FROM telemetry.point_values
        WHERE point_key = $1 AND "time" > now() - interval '1 minute'`,
      [POINT],
    );
    return rows;
  });

  assert(!rejected, "the constraint rejected a finite value — it is too strict");
  assert(result !== undefined && result.length === 1, `expected one probe row, found ${result?.length}`);
  assert(Number(result?.[0].value) === 42.5, `probe row round-tripped as ${result?.[0].value}`);
}

/**
 * The prescribed constraint, exercised directly so the reason it was rejected
 * is a *test* rather than a comment somebody has to trust.
 *
 * If a future Postgres ever adopted IEEE 754 comparison semantics this would
 * fail, which is the correct outcome: migration `0031`'s central claim would
 * have stopped being true and someone should look.
 */
export async function assertPrescribedIdiomWouldNotHaveWorked(pool: pg.Pool): Promise<void> {
  const { rows } = await pool.query<{ eq: boolean }>(
    `SELECT ('NaN'::float8 = 'NaN'::float8) AS eq`,
  );
  assert(
    rows[0].eq === true,
    "Postgres now reports NaN <> NaN. `CHECK (value = value)` would work after " +
      "all, and migration 0031's reasoning needs revisiting.",
  );
}

/**
 * The constraint reaches every chunk, not just the parent.
 *
 * TimescaleDB attaches chunks by PostgreSQL inheritance, and PostgreSQL refuses
 * to attach a child lacking the parent's `CHECK` — so this holds for chunks
 * created in the future too. Asserted because the migration review raised it and
 * "it should propagate" is not the same as "it did".
 */
export async function assertConstraintReachesEveryChunk(pool: pg.Pool): Promise<void> {
  const { rows } = await pool.query<{ parents: string; children: string }>(
    `SELECT count(*) FILTER (WHERE conrelid = 'telemetry.point_values'::regclass) AS parents,
            count(*) FILTER (WHERE conrelid <> 'telemetry.point_values'::regclass) AS children
       FROM pg_constraint WHERE conname = 'point_values_value_finite_check'`,
  );
  const parents = Number(rows[0].parents);
  const children = Number(rows[0].children);

  assert(parents === 1, `expected the constraint on the hypertable parent, found ${parents}`);

  const { rows: chunkRows } = await pool.query<{ n: string }>(
    `SELECT count(*) AS n FROM timescaledb_information.chunks
      WHERE hypertable_name = 'point_values'`,
  );
  assert(
    children === Number(chunkRows[0].n),
    `constraint is on ${children} chunks but the hypertable has ${chunkRows[0].n}`,
  );
}

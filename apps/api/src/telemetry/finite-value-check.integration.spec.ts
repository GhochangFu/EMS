import type pg from "pg";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const ASSET = "00000000-0000-4000-8000-0000f4320001";
const POINT = "f4_32_probe";

/** Removes anything this suite wrote, whatever it managed to write. */
export async function cleanup(pool: pg.Pool): Promise<void> {
  await pool.query(`DELETE FROM telemetry.point_values WHERE point_key = $1`, [POINT]);
}

/**
 * Attempts one insert and reports whether the database refused it.
 *
 * The value is passed as **text** and cast in SQL rather than bound as a JS
 * number, because `node-postgres` serialises `NaN` and `Infinity` in ways that
 * would make this test about the driver rather than about the constraint.
 */
async function insertRejected(pool: pg.Pool, literal: string): Promise<boolean> {
  try {
    await pool.query(
      `INSERT INTO telemetry.point_values ("time", asset_id, point_key, value)
       VALUES (now(), $1::uuid, $2, $3::float8)`,
      [ASSET, POINT, literal],
    );
    return false;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    assert(
      /point_values_value_finite_check/.test(message),
      `insert of ${literal} failed for the wrong reason: ${message}`,
    );
    return true;
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
 *
 * The `assertFiniteValueStillAccepted` case is the half that is easy to leave
 * out: a constraint that rejects everything would pass every case above it.
 */
export async function assertNonFiniteValuesAreRejected(pool: pg.Pool): Promise<void> {
  for (const literal of ["NaN", "Infinity", "-Infinity"]) {
    assert(
      await insertRejected(pool, literal),
      `the database accepted ${literal} into telemetry.point_values.value — ` +
        `point_values_value_finite_check is missing or too weak`,
    );
  }
}

/** The other direction: ordinary readings must still be writable. */
export async function assertFiniteValueStillAccepted(pool: pg.Pool): Promise<void> {
  const rejected = await insertRejected(pool, "42.5");
  assert(!rejected, "the constraint rejected a finite value — it is too strict");

  const { rows } = await pool.query<{ value: number }>(
    `SELECT value FROM telemetry.point_values WHERE point_key = $1`,
    [POINT],
  );
  assert(rows.length === 1, `expected exactly one probe row, found ${rows.length}`);
  assert(Number(rows[0].value) === 42.5, `probe row round-tripped as ${rows[0].value}`);
}

/**
 * The prescribed constraint, exercised directly so the reason it was rejected
 * is a *test* rather than a comment somebody has to trust.
 *
 * If a future Postgres ever adopted IEEE 754 comparison semantics this would
 * fail, which is the correct outcome: the migration's central claim would have
 * stopped being true and someone should look.
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

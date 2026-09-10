import pg from "pg";
import { expect } from "vitest";

import { buildUpsert, type PointValueRow } from "./normaliser.js";

/**
 * `F4.57` / ADR 0061 Amendment 1 item 1 — the `DO UPDATE` clause against real
 * Postgres.
 *
 * **What `normaliser.spec.ts` cannot reach.** That suite reads the SQL *text*
 * `buildUpsert` produces, which is the right gate for the bind order and the
 * column list and is blind to two things that decide whether the column works
 * at all: whether migration `0069` ran on the database this code is pointed at,
 * and whether `EXCLUDED.device_time` resolves to the value the *second*
 * delivery carried. A text assertion is green against a schema without the
 * column and green against a `SET` clause Postgres would reject.
 *
 * **Why the second delivery is the claim.** `UPSERT_TAIL` used to set only
 * `value` and `unit`, so a re-delivered reading refreshed those two and kept the
 * first delivery's `device_time`. The column would then describe a delivery that
 * is no longer the row — the exact failure ADR 0061 exists to prevent, one
 * column over. Amendment 1 item 1 extended decision 1 to set `device_time` too,
 * and asked for this assertion.
 *
 * **`buildUpsert` is driven directly, never `writeResolved`.** `writeResolved`
 * opens its own `BEGIN`/`COMMIT`. Called from inside the fixture transaction the
 * nested `BEGIN` only warns, and its `COMMIT` would commit the fixture rows into
 * a database another session shares. This suite owns exactly one transaction and
 * rolls it back.
 *
 * **The fixture is synthetic on purpose.** `telemetry.point_values` carries no
 * foreign key on `asset_id` (only the composite primary key and the finite-value
 * CHECK), so the rows need no asset, no RTU and no organization — nothing this
 * suite writes can collide with seeded data or with another suite's fixtures.
 * `time` is `now()` so the rows land in the live, uncompressed chunk: this table
 * is a compressed hypertable and an upsert into a compressed chunk is a
 * different code path that this claim has no business exercising.
 *
 * The two exported functions are two `it()`s. `expect` throws, so a claim
 * grouped behind another claim's failure never runs — and the column-existence
 * claim is the one a reader needs to see *first* when a database is missing
 * `0069`, not hidden behind a delivery that could not have worked.
 */

/** Nothing else in the schema uses it, so a leaked row is greppable by this alone. */
const FIXTURE_POINT_KEY = "F4_57_FIXTURE";
/** Synthetic; `point_values.asset_id` has no foreign key, so no asset has to exist. */
const FIXTURE_ASSET_ID = "f4570000-0000-4000-8000-000000000057";
const FIXTURE_UNIT = "kW";

/**
 * ADR 0061 §Context's two extremes, so the fixture's device times are the skew
 * the row was filed for rather than round numbers: `861736076128211` at
 * −3:02:36 and `861736076104923` at +34:31.
 */
const LAGGING_OFFSET_MS = -((3 * 60 + 2) * 60 + 36) * 1_000;
const LEADING_OFFSET_MS = (34 * 60 + 31) * 1_000;

type StoredRow = {
  readonly value: number;
  readonly device_time: Date | null;
};

/**
 * Reads the fixture back by `(asset_id, point_key)` — deliberately **not** by
 * the full primary key.
 *
 * "Delivery B lands on the same key" means B has to *update* the row, and a
 * `WHERE` naming the whole primary key cannot see a second row if the conflict
 * target were ever wrong: it would return one row and pass. Counting on the two
 * stable components is what makes the update observable.
 *
 * The `time >= $3` bound is chunk pruning, not identity. Without it this scans
 * every chunk of a ten-million-row hypertable; a minute-wide floor keeps a
 * second row at any *other* stamp fully visible, which is the case the count is
 * there to catch.
 */
const READ_BACK = `
  SELECT value, device_time
    FROM telemetry.point_values
   WHERE asset_id = $1
     AND point_key = $2
     AND time >= $3
   ORDER BY time
`;

function isoOrNull(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

/** One delivery, through the exact SQL the host writes. */
async function deliver(client: pg.PoolClient, row: PointValueRow): Promise<void> {
  const { text, values } = buildUpsert([row]);
  await client.query(text, values);
}

async function readBack(client: pg.PoolClient, floor: Date): Promise<readonly StoredRow[]> {
  const { rows } = await client.query<StoredRow>(READ_BACK, [
    FIXTURE_ASSET_ID,
    FIXTURE_POINT_KEY,
    floor,
  ]);
  return rows;
}

/**
 * Migration `0069` ran on the database this suite is pointed at, and the column
 * has the shape ADR 0061 decision 1 specifies.
 *
 * Nullable is half the decision, not a detail: `device_time` is NULL for every
 * one of the 10,016,481 rows written before the migration and for both of
 * decision 4's live cases, so a `NOT NULL` column would make the host unable to
 * write a reading whose device sent no timestamp.
 */
export async function assertDeviceTimeColumnExists(pool: pg.Pool): Promise<void> {
  const { rows } = await pool.query<{ data_type: string; is_nullable: string }>(
    `SELECT data_type, is_nullable
       FROM information_schema.columns
      WHERE table_schema = 'telemetry'
        AND table_name = 'point_values'
        AND column_name = 'device_time'`,
  );

  expect(
    rows.length,
    "telemetry.point_values has no device_time column. Migration 0069 has not been applied to " +
      "the database DATABASE_URL names — every assertion below would fail as SQL rather than " +
      "as a claim.",
  ).toBe(1);
  expect(
    rows[0].data_type,
    "device_time must be timestamptz (ADR 0061 decision 1). A `timestamp without time zone` " +
      "would silently reinterpret every device stamp in the server's zone.",
  ).toBe("timestamp with time zone");
  expect(
    rows[0].is_nullable,
    "device_time must be nullable: decision 4 says NULL means 'no trustworthy device time', " +
      "and a payload carrying no ts has nothing else to write.",
  ).toBe("YES");
}

/**
 * ADR 0061 Amendment 1 item 1 — a re-delivered reading moves the stored
 * `device_time`, and a re-delivery carrying none clears it.
 *
 * Three ordered claims, each owned by one mutation of the source:
 *
 * | Order | Claim | Mutation that must redden it |
 * |---|---|---|
 * | 1 | delivery A stores A's device time | bind `null` sixth in `buildUpsert` |
 * | 2 | delivery B moves `value` **and** `device_time` | drop `device_time = EXCLUDED.device_time` from `UPSERT_TAIL` |
 * | 3 | delivery C with no device time stores NULL | `COALESCE(EXCLUDED.device_time, point_values.device_time)` |
 *
 * Claim 3 is why the clause is a plain assignment rather than a coalesce. A
 * coalesce reads as defensive — "do not lose the stamp we had" — and is exactly
 * wrong here: the row describes its **latest** delivery, so a delivery whose
 * device said nothing must leave the column saying nothing, not keep an older
 * device's stamp beside a newer device's value.
 */
export async function assertSecondDeliveryMovesDeviceTime(pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  try {
    const receivedAt = new Date();
    const windowFloor = new Date(receivedAt.getTime() - 60_000);
    const deviceA = new Date(receivedAt.getTime() + LAGGING_OFFSET_MS);
    const deviceB = new Date(receivedAt.getTime() + LEADING_OFFSET_MS);

    // All three deliveries carry the same primary key, which is what makes B and
    // C conflicts rather than inserts.
    const key = {
      time: receivedAt,
      assetId: FIXTURE_ASSET_ID,
      pointKey: FIXTURE_POINT_KEY,
      unit: FIXTURE_UNIT,
    } as const;

    await client.query("BEGIN");
    try {
      await deliver(client, { ...key, value: 1, deviceTime: deviceA });
      const afterA = await readBack(client, windowFloor);
      expect(afterA.length, "delivery A wrote no row, or wrote more than one").toBe(1);
      expect(
        isoOrNull(afterA[0].device_time),
        "the first delivery's device time did not reach the column — buildUpsert is not binding " +
          "row.deviceTime into the sixth parameter",
      ).toBe(deviceA.toISOString());

      await deliver(client, { ...key, value: 2, deviceTime: deviceB });
      const afterB = await readBack(client, windowFloor);
      expect(
        afterB.length,
        "delivery B carried the same (time, asset_id, point_key), so it must have updated the " +
          "row rather than added one",
      ).toBe(1);
      expect(afterB[0].value, "the re-delivered value did not land").toBe(2);
      expect(
        isoOrNull(afterB[0].device_time),
        "the row kept the first delivery's device_time while taking the second delivery's " +
          "value: ON CONFLICT DO UPDATE is not setting device_time = EXCLUDED.device_time " +
          "(ADR 0061 Amendment 1 item 1). The column has stopped describing its own row.",
      ).toBe(deviceB.toISOString());

      await deliver(client, { ...key, value: 3, deviceTime: null });
      const afterC = await readBack(client, windowFloor);
      expect(afterC.length, "delivery C must still be one row").toBe(1);
      expect(
        isoOrNull(afterC[0].device_time),
        "a delivery carrying no device time left the previous device's stamp behind. The row " +
          "describes its latest delivery, so the clause must be a plain assignment and never a " +
          "COALESCE onto the stored value.",
      ).toBeNull();
    } finally {
      await client.query("ROLLBACK");
    }

    // The database is shared with other sessions; every write above has to be
    // gone. This runs only on the happy path — a thrown assertion propagates
    // past it — so it is a gate on the ROLLBACK, not the whole cleanup story.
    expect(
      (await readBack(client, windowFloor)).length,
      "the fixture rows survived ROLLBACK. Something in this suite committed — check that no " +
        "path calls writeResolved, which opens and commits its own transaction.",
    ).toBe(0);
  } finally {
    client.release();
  }
}

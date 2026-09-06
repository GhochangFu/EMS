import pg from "pg";
import { expect } from "vitest";

import { BINDING_QUERY, type BindingRow } from "./bindings.js";

/**
 * `F2.7` / ADR 0056 decision 4 — `BINDING_QUERY` against the real schema.
 *
 * `bindings.spec.ts` asserts the SQL *text* and the pure planning, which cannot
 * tell whether the five columns exist, whether the join compiles, or what
 * Postgres returns for a `double precision` column (`pg` parses `float8` to a
 * JS `number`, and `numeric` to a *string* — a silent type change would make
 * every scaled reading `NaN` with no error anywhere).
 *
 * The second half proves the per-column coalesce in the only way that can fail:
 * the asset side and the template side are given **different** columns, so an
 * argument-swapped `coalesce(tp.<c>, ap.<c>)` and a join on the wrong key both
 * come back wrong. Every write runs inside `BEGIN … ROLLBACK` on one client —
 * another suite runs against this database at the same time, and an uncommitted
 * row is invisible to it while the assertions read it through the same
 * connection.
 */

/** The five, in the order ADR 0056 decision 1 lists them. */
const NUMERIC_COLUMNS = ["scale_multiplier", "scale_offset", "eng_min", "eng_max"] as const;

type Pair = {
  readonly asset_id: string;
  readonly point_key: string;
  readonly organization_id: string;
};

/** A bound, ingest-enabled point. Named by the seed's oldest row, never positionally. */
const PAIR_QUERY = `
  SELECT ap.asset_id, ap.point_key, a.organization_id
    FROM bms.asset_points ap
    INNER JOIN bms.assets a ON a.id = ap.asset_id
    INNER JOIN bms.rtus r ON r.id = ap.rtu_id
   WHERE ap.active = true
     AND ap.source_kind = 'measured'
     AND r.ingest_enabled = true
   ORDER BY a.created_at, ap.asset_id, ap.point_key
   LIMIT 1
`;

const TEMPLATE_QUERY = `
  SELECT t.id
    FROM bms.asset_templates t
   WHERE t.organization_id = $1
   ORDER BY t.created_at
   LIMIT 1
`;

async function bindingRows(client: pg.Pool | pg.PoolClient): Promise<BindingRow[]> {
  const { rows } = await client.query<BindingRow>(BINDING_QUERY);
  return rows;
}

function rowFor(rows: readonly BindingRow[], pair: Pair): BindingRow {
  const row = rows.find((r) => r.asset_id === pair.asset_id && r.point_key === pair.point_key);
  expect(row, `the binding query lost ${pair.point_key} — the metadata join changed the row set`).toBeDefined();
  return row as BindingRow;
}

/**
 * Every row carries the five resolved columns, with the JS types
 * `planEndpoints` narrows on.
 */
export async function assertEveryRowCarriesResolvedMetadata(pool: pg.Pool): Promise<void> {
  const rows = await bindingRows(pool);

  // No seeded asset that ingest binds is templated, so an INNER JOIN onto
  // `template_points` would return nothing at all: this count is what proves the
  // join is a LEFT JOIN, not merely that it was spelled as one.
  expect(
    rows.length,
    "no bindings came back. The seeded PHE RTUs are ingest_enabled, so either the fixture is " +
      "gone or the template_points join dropped every unmatched row.",
  ).toBeGreaterThan(0);

  for (const row of rows) {
    for (const column of NUMERIC_COLUMNS) {
      expect(Object.prototype.hasOwnProperty.call(row, column), `${column} is missing`).toBe(true);
      const value = row[column];
      expect(
        value === null || typeof value === "number",
        `${column} came back as ${typeof value} (${String(value)}); the host multiplies it`,
      ).toBe(true);
    }
    expect(Object.prototype.hasOwnProperty.call(row, "quality_policy")).toBe(true);
    expect(
      row.quality_policy === null || typeof row.quality_policy === "string",
      `quality_policy came back as ${typeof row.quality_policy}`,
    ).toBe(true);
  }
}

/**
 * The coalesce resolves **per column**: the template default where the asset is
 * silent, the asset override where it is not.
 */
export async function assertCoalescePicksEachSidePerColumn(pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  try {
    const { rows: pairs } = await client.query<Pair>(PAIR_QUERY);
    expect(pairs.length, "no ingest-bound point to test the resolution against").toBe(1);
    const pair = pairs[0];

    const { rows: templates } = await client.query<{ id: string }>(TEMPLATE_QUERY, [
      pair.organization_id,
    ]);
    expect(templates.length, "the seeded organization has no template to inherit from").toBe(1);
    const templateId = templates[0].id;

    const baseline = await bindingRows(client);
    expect(rowFor(baseline, pair).scale_multiplier).toBeNull();

    await client.query("BEGIN");
    try {
      // The seed binds no templated asset, so the fixture has to make one: pin
      // the asset to its organization's template and give that template a point
      // with the same key. Both writes roll back.
      await client.query("UPDATE bms.assets SET template_id = $2 WHERE id = $1", [
        pair.asset_id,
        templateId,
      ]);
      await client.query(
        `INSERT INTO bms.template_points
           (template_id, point_key, organization_id, kind, scale_multiplier, eng_max)
         VALUES ($1, $2, $3, 'measured', 0.5, 50)
         ON CONFLICT (template_id, point_key)
         DO UPDATE SET scale_multiplier = 0.5, eng_max = 50`,
        [templateId, pair.point_key, pair.organization_id],
      );
      // The asset overrides one of the two columns the template now sets.
      await client.query(
        "UPDATE bms.asset_points SET eng_max = 100 WHERE asset_id = $1 AND point_key = $2",
        [pair.asset_id, pair.point_key],
      );

      const resolved = await bindingRows(client);
      expect(
        resolved.length,
        "the join changed the row count — a metadata join must never add or drop a binding",
      ).toBe(baseline.length);

      const row = rowFor(resolved, pair);
      expect(
        row.scale_multiplier,
        "the asset is silent on scale_multiplier, so the template default resolves",
      ).toBe(0.5);
      expect(
        row.eng_max,
        "the asset sets eng_max to 100 over the template's 50, so the override resolves",
      ).toBe(100);
      // The three the neither side sets stay NULL — "inherit nothing" is not "0".
      expect(row.scale_offset).toBeNull();
      expect(row.eng_min).toBeNull();
      expect(row.quality_policy).toBeNull();
    } finally {
      await client.query("ROLLBACK");
    }

    const afterRollback = rowFor(await bindingRows(client), pair);
    expect(afterRollback.scale_multiplier, "the fixture must leave nothing behind").toBeNull();
    expect(afterRollback.eng_max, "the fixture must leave nothing behind").toBeNull();
  } finally {
    client.release();
  }
}

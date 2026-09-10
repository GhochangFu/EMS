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

/**
 * The fixture template, created inside the rolled-back transaction. The seed
 * writes templates for ESKOM only, and every `ingest_enabled` RTU belongs to
 * PHEWB — so selecting "the ingest organization's template" is green on a
 * database someone once imported a stock template into and red on CI's fresh
 * seed (PR 1 code review, FG1). A row the fixture owns exists everywhere.
 */
const TEMPLATE_INSERT = `
  INSERT INTO bms.asset_templates (organization_id, code, version, name, asset_type, domain, status)
  VALUES (
    $1, 'F27-BINDINGS-FIXTURE', 1, 'F2.7 bindings fixture', 'fixture',
    (SELECT code FROM bms.asset_domains ORDER BY code LIMIT 1),
    'published'
  )
  RETURNING id
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

    const baseline = await bindingRows(client);
    expect(rowFor(baseline, pair).scale_multiplier).toBeNull();

    await client.query("BEGIN");
    try {
      // The seed binds no templated asset, so the fixture has to make one: create
      // a template for the asset's organization, pin the asset to it and give
      // that template a point with the same key. All three writes roll back.
      const { rows: inserted } = await client.query<{ id: string }>(TEMPLATE_INSERT, [
        pair.organization_id,
      ]);
      expect(inserted.length, "the fixture template insert returned no id").toBe(1);
      const templateId = inserted[0].id;
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

/** An ingest-bound RTU that has no `rtu_connection_configs` row — `rtu_id` is UNIQUE. */
const CONFIGLESS_RTU_QUERY = `
  SELECT r.id AS rtu_id, r.organization_id
    FROM bms.rtus r
    INNER JOIN bms.asset_points ap
            ON ap.rtu_id = r.id
           AND ap.active = true
           AND ap.source_kind = 'measured'
    LEFT JOIN bms.rtu_connection_configs c ON c.rtu_id = r.id
   WHERE r.ingest_enabled = true
     AND c.id IS NULL
   ORDER BY r.created_at, r.id
   LIMIT 1
`;

/**
 * `E8.4` / ADR 0062 decision 3 — `key_version` comes back from Postgres, and it
 * comes back as a JS **integer**.
 *
 * **This is the only gate for that claim in the repository.** Plan §13
 * correction 11 records that the API side has no equivalent: both integration
 * specs that reach `toChannelRow` plant channels with no ciphertext, so they
 * return at the null branch before the version is read. Do not weaken this one
 * into a unit assertion — `bindings-credentials.spec.ts` supplies
 * `key_version` from a fixture and therefore cannot see the column's type, or
 * its absence from the SQL. `pg` parses `int4` to a `number` and `numeric` to a
 * *string*; a version arriving as `"3"` would be refused by `keyForVersion`'s
 * `typeof !== "number"` guard on every RTU in the fleet, with the failure
 * surfacing as one skipped RTU at a time.
 *
 * `key_version = 3`, not 1: the column defaults to 1 and the current key
 * version defaults to 1, so 1 cannot distinguish a value read from the row from
 * either default.
 *
 * Every write runs inside `BEGIN … ROLLBACK` on one client, like the function
 * above — another suite runs against this database at the same time.
 */
export async function assertKeyVersionArrivesAsAnInteger(pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  try {
    const { rows: candidates } = await client.query<{
      rtu_id: string;
      organization_id: string;
    }>(CONFIGLESS_RTU_QUERY);
    expect(
      candidates.length,
      "no ingest-bound RTU without a connection config to plant one on",
    ).toBe(1);
    const { rtu_id: rtuId, organization_id: organizationId } = candidates[0];

    const baseline = await bindingRows(client);
    for (const row of baseline) {
      expect(
        Object.prototype.hasOwnProperty.call(row, "key_version"),
        "key_version is missing from the binding query — every stored version would arrive as " +
          "undefined and every credential would be refused",
      ).toBe(true);
    }
    const baselineRow = baseline.find((r) => r.rtu_id === rtuId);
    expect(baselineRow, "the chosen RTU dropped out of the binding query").toBeDefined();
    expect(
      (baselineRow as BindingRow).key_version,
      "an RTU with no config row reads null — the LEFT JOIN is the only source of one, " +
        "because the column itself is NOT NULL",
    ).toBeNull();

    await client.query("BEGIN");
    try {
      // `organization_id` is the **RTU's**, not the asset's: the column's own
      // comment says the org resolves via `rtu_id -> rtus`.
      await client.query(
        `INSERT INTO bms.rtu_connection_configs (organization_id, rtu_id, protocol, config, key_version)
         VALUES ($1, $2, 'mqtt', '{}'::jsonb, 3)`,
        [organizationId, rtuId],
      );

      const planted = await bindingRows(client);
      expect(
        planted.length,
        "the config join changed the row count — a LEFT JOIN onto a UNIQUE rtu_id may not fan out",
      ).toBe(baseline.length);
      const plantedRow = planted.find((r) => r.rtu_id === rtuId);
      expect(plantedRow, "the planted RTU dropped out of the binding query").toBeDefined();
      expect(
        typeof (plantedRow as BindingRow).key_version,
        `key_version came back as ${typeof (plantedRow as BindingRow).key_version} ` +
          `(${String((plantedRow as BindingRow).key_version)}); keyForVersion refuses anything ` +
          "that is not a number, so a string here refuses every credential in the fleet",
      ).toBe("number");
      expect(
        (plantedRow as BindingRow).key_version,
        "the planted version must be the one that comes back, not the column default",
      ).toBe(3);
    } finally {
      await client.query("ROLLBACK");
    }

    const afterRollback = (await bindingRows(client)).find((r) => r.rtu_id === rtuId);
    expect(
      (afterRollback as BindingRow).key_version,
      "the fixture must leave nothing behind",
    ).toBeNull();
  } finally {
    client.release();
  }
}

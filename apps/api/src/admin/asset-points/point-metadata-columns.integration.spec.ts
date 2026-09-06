import { randomUUID } from "node:crypto";

import type pg from "pg";

import { resolveSeededAssetByCode } from "../../testing/integration-fixtures";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * A seeded, named asset — never a positional `bms.assets` read.
 * `tests/integration-fixture-isolation.test.ts` gates this: a positional read
 * returns whatever currently sorts first, which is another suite's committed
 * fixture as often as it is the seed.
 */
// `CH-CRAC-103`, not `-101`/`-102`: `tests/integration-fixture-sharing.test.ts`
// requires every seeded code to be claimed by exactly one suite, and those two
// belong to the reports and point-aggregates suites. Any seeded asset serves
// here — the probe rows below live inside `BEGIN … ROLLBACK`.
const FIXTURE_ASSET_CODE = "CH-CRAC-103";

/**
 * `F2.7` Unit B — migration `0063` asserted against the database rather than
 * against the Drizzle model that describes it (`asset-point-calc-columns.
 * integration.spec.ts`'s model, ADR 0056 decisions 1 and 2).
 *
 * Drizzle's schema object is a *claim* about the columns; `pnpm typecheck` is
 * happy with a claim no migration ever made true. These assertions read
 * `information_schema` and `pg_constraint` directly, and reach every one of
 * the three within-row rules through a real `INSERT` that must fail with
 * SQLSTATE `23514` and name the constraint — never a committed row (`BEGIN …
 * ROLLBACK`, the `finite-value-check.integration.spec.ts` pattern), so the
 * compose re-seed's exact row counts never see this suite's writes.
 */

/** The five point-metadata columns, identical shape on both tables. */
const POINT_METADATA_COLUMNS: ReadonlyArray<{
  readonly name: string;
  readonly dataType: string;
  readonly maxLength: number | null;
}> = [
  { name: "scale_multiplier", dataType: "double precision", maxLength: null },
  { name: "scale_offset", dataType: "double precision", maxLength: null },
  { name: "eng_min", dataType: "double precision", maxLength: null },
  { name: "eng_max", dataType: "double precision", maxLength: null },
  { name: "quality_policy", dataType: "character varying", maxLength: 16 },
];

const CHECK_CONSTRAINTS: ReadonlyArray<{ readonly table: "template_points" | "asset_points"; readonly name: string }> =
  [
    { table: "template_points", name: "template_points_eng_range_check" },
    { table: "template_points", name: "template_points_scale_multiplier_check" },
    { table: "template_points", name: "template_points_quality_policy_check" },
    { table: "asset_points", name: "asset_points_eng_range_check" },
    { table: "asset_points", name: "asset_points_scale_multiplier_check" },
    { table: "asset_points", name: "asset_points_quality_policy_check" },
  ];

type ColumnRow = {
  column_name: string;
  data_type: string;
  is_nullable: string;
  character_maximum_length: number | null;
  column_default: string | null;
};

/**
 * The five columns exist on both tables, nullable, with no default. A
 * `DEFAULT` is checked because it is the one way `ADD COLUMN` can rewrite
 * meaning without touching a stored value: Postgres serves it to every
 * pre-existing row, so `DEFAULT 1` on `scale_multiplier` would silently
 * change every row's resolved reading from "no scaling" to itself times one
 * — harmless there, but the same mechanism on `quality_policy` would not be.
 */
export async function assertPointMetadataColumnsExistAndAreNullable(pool: pg.Pool): Promise<void> {
  for (const table of ["template_points", "asset_points"] as const) {
    const { rows } = await pool.query<ColumnRow>(
      `SELECT column_name, data_type, is_nullable, character_maximum_length, column_default
         FROM information_schema.columns
        WHERE table_schema = 'bms' AND table_name = $1
          AND column_name = ANY($2::text[])`,
      [table, POINT_METADATA_COLUMNS.map((c) => c.name)],
    );
    const byName = new Map(rows.map((r) => [r.column_name, r]));
    for (const expected of POINT_METADATA_COLUMNS) {
      const actual = byName.get(expected.name);
      assert(
        actual !== undefined,
        `bms.${table} is missing column "${expected.name}" — migration 0063_point_metadata ` +
          "did not run. Check that meta/_journal.json carries its entry.",
      );
      const column = actual as ColumnRow;
      assert(
        column.is_nullable === "YES",
        `bms.${table}.${expected.name} is NOT NULL. ADR 0056 decision 1 needs NULL to mean ` +
          '"inherit" (template_points) or "no override" (asset_points).',
      );
      assert(
        column.column_default === null,
        `bms.${table}.${expected.name} has default ${String(column.column_default)}. A default ` +
          "would silently change the resolved meaning of every pre-existing row.",
      );
      assert(
        column.data_type === expected.dataType,
        `bms.${table}.${expected.name} is ${column.data_type}, expected ${expected.dataType}.`,
      );
      assert(
        column.character_maximum_length === expected.maxLength,
        `bms.${table}.${expected.name} has width ${String(column.character_maximum_length)}, ` +
          `expected ${String(expected.maxLength)}.`,
      );
    }
  }
}

/**
 * The five columns are exactly as wide and as typed on `asset_points` as on
 * `template_points`, read from the database rather than from the table above
 * — `coalesce(asset_points.col, template_points.col)` (ADR 0056 decision 1)
 * of two different types is not the resolved value the ADR describes.
 */
export async function assertColumnsMirrorAcrossTables(pool: pg.Pool): Promise<void> {
  const { rows } = await pool.query<{
    column_name: string;
    asset_type: string | null;
    template_type: string | null;
    asset_len: number | null;
    template_len: number | null;
  }>(
    `SELECT k.column_name,
            a.data_type AS asset_type,
            t.data_type AS template_type,
            a.character_maximum_length AS asset_len,
            t.character_maximum_length AS template_len
       FROM unnest($1::text[]) AS k(column_name)
       LEFT JOIN information_schema.columns a
              ON a.table_schema = 'bms' AND a.table_name = 'asset_points'
             AND a.column_name = k.column_name
       LEFT JOIN information_schema.columns t
              ON t.table_schema = 'bms' AND t.table_name = 'template_points'
             AND t.column_name = k.column_name`,
    [POINT_METADATA_COLUMNS.map((c) => c.name)],
  );

  assert(rows.length === POINT_METADATA_COLUMNS.length, `expected ${POINT_METADATA_COLUMNS.length} rows, got ${rows.length}`);
  for (const row of rows) {
    assert(
      row.asset_type !== null && row.asset_type === row.template_type,
      `bms.asset_points.${row.column_name} is ${String(row.asset_type)} but ` +
        `bms.template_points.${row.column_name} is ${String(row.template_type)}.`,
    );
    assert(
      row.asset_len === row.template_len,
      `bms.asset_points.${row.column_name} is width ${String(row.asset_len)} but ` +
        `bms.template_points.${row.column_name} is ${String(row.template_len)}.`,
    );
  }
}

/** The six CHECK constraints exist, each on the table it names. */
export async function assertSixCheckConstraintsExist(pool: pg.Pool): Promise<void> {
  const { rows } = await pool.query<{ conname: string; conrelid: string }>(
    `SELECT conname, conrelid::regclass::text AS conrelid
       FROM pg_constraint
      WHERE conname = ANY($1::text[])`,
    [CHECK_CONSTRAINTS.map((c) => c.name)],
  );
  const byName = new Map(rows.map((r) => [r.conname, r.conrelid]));
  for (const expected of CHECK_CONSTRAINTS) {
    const actualRelid = byName.get(expected.name);
    assert(actualRelid !== undefined, `constraint ${expected.name} does not exist.`);
    assert(
      actualRelid === `bms.${expected.table}`,
      `constraint ${expected.name} is on ${String(actualRelid)}, expected bms.${expected.table}.`,
    );
  }
}

/** A pg error carrying a SQLSTATE and, for a CHECK violation, the constraint name. */
type PgError = Error & { code?: string; constraint?: string };

/**
 * Every row this function inserts is rolled back — never committed — so the
 * compose re-seed's exact row-count check never sees it (a lesson this repo
 * has already paid for with a leaked hypertable probe row).
 */
async function assertInsertRefused(
  pool: pg.Pool,
  sql: string,
  params: readonly unknown[],
  constraintName: string,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    try {
      await client.query(sql, params as unknown[]);
      assert(false, `expected the INSERT to be refused by ${constraintName}, but it succeeded.`);
    } catch (err) {
      const pgErr = err as PgError;
      assert(
        pgErr.code === "23514",
        `insert failed for the wrong reason (code ${String(pgErr.code)}): ${pgErr.message}`,
      );
      assert(
        pgErr.constraint === constraintName,
        `insert was refused by "${String(pgErr.constraint)}", expected "${constraintName}": ${pgErr.message}`,
      );
    }
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
  }
}

/** A seeded template to hang a probe `template_points` row off. */
async function seededTemplate(pool: pg.Pool): Promise<{ id: string; organizationId: string }> {
  const { rows } = await pool.query<{ id: string; organization_id: string }>(
    `SELECT id, organization_id FROM bms.asset_templates LIMIT 1`,
  );
  assert(rows.length === 1, "bms.asset_templates is empty. Run `pnpm db:seed` before this suite.");
  return { id: rows[0].id, organizationId: rows[0].organization_id };
}

/**
 * A seeded asset to hang a probe `asset_points` row off, resolved by name
 * (`resolveSeededAssetByCode`) rather than by position.
 */
async function seededAsset(pool: pg.Pool): Promise<{ id: string; organizationId: string }> {
  const id = await resolveSeededAssetByCode(pool, FIXTURE_ASSET_CODE);
  const { rows } = await pool.query<{ organization_id: string }>(
    `SELECT organization_id FROM bms.assets WHERE id = $1`,
    [id],
  );
  assert(rows.length === 1, `bms.assets row ${id} (code ${FIXTURE_ASSET_CODE}) vanished mid-suite.`);
  return { id, organizationId: rows[0].organization_id };
}

/** Each of the three rules, refused on `template_points`. */
export async function assertTemplatePointsChecksRefuseBadRows(pool: pg.Pool): Promise<void> {
  const template = await seededTemplate(pool);
  const prefix = `f27-check-${randomUUID().slice(0, 8)}`;

  await assertInsertRefused(
    pool,
    `INSERT INTO bms.template_points (organization_id, template_id, point_key, eng_min, eng_max)
     VALUES ($1, $2, $3, 150, 100)`,
    [template.organizationId, template.id, `${prefix}-range`],
    "template_points_eng_range_check",
  );

  await assertInsertRefused(
    pool,
    `INSERT INTO bms.template_points (organization_id, template_id, point_key, scale_multiplier)
     VALUES ($1, $2, $3, 0)`,
    [template.organizationId, template.id, `${prefix}-scale`],
    "template_points_scale_multiplier_check",
  );

  await assertInsertRefused(
    pool,
    `INSERT INTO bms.template_points (organization_id, template_id, point_key, quality_policy)
     VALUES ($1, $2, $3, 'clamp')`,
    [template.organizationId, template.id, `${prefix}-quality`],
    "template_points_quality_policy_check",
  );
}

/** Each of the three rules, refused on `asset_points`. */
export async function assertAssetPointsChecksRefuseBadRows(pool: pg.Pool): Promise<void> {
  const asset = await seededAsset(pool);
  const prefix = `f27-check-${randomUUID().slice(0, 8)}`;

  await assertInsertRefused(
    pool,
    `INSERT INTO bms.asset_points (organization_id, asset_id, point_key, source_data_key, eng_min, eng_max)
     VALUES ($1, $2, $3, $4, 150, 100)`,
    [asset.organizationId, asset.id, `${prefix}-range`, `${prefix}-range-key`],
    "asset_points_eng_range_check",
  );

  await assertInsertRefused(
    pool,
    `INSERT INTO bms.asset_points (organization_id, asset_id, point_key, source_data_key, scale_multiplier)
     VALUES ($1, $2, $3, $4, 0)`,
    [asset.organizationId, asset.id, `${prefix}-scale`, `${prefix}-scale-key`],
    "asset_points_scale_multiplier_check",
  );

  await assertInsertRefused(
    pool,
    `INSERT INTO bms.asset_points (organization_id, asset_id, point_key, source_data_key, quality_policy)
     VALUES ($1, $2, $3, $4, 'clamp')`,
    [asset.organizationId, asset.id, `${prefix}-quality`, `${prefix}-quality-key`],
    "asset_points_quality_policy_check",
  );
}

/**
 * No pre-existing row changed meaning, and the check is not vacuous. On the
 * seeded database every `template_points` and `asset_points` row reads `NULL`
 * across the five, and both tables have more than zero rows.
 */
export async function assertExistingRowsReadNullAndAreNonVacuous(pool: pg.Pool): Promise<void> {
  const predicate = POINT_METADATA_COLUMNS.map((c) => `${c.name} IS NOT NULL`).join(" OR ");
  for (const table of ["template_points", "asset_points"] as const) {
    const { rows } = await pool.query<{ total: string; violations: string }>(
      `SELECT count(*) AS total, count(*) FILTER (WHERE ${predicate}) AS violations
         FROM bms.${table}`,
    );
    const [row] = rows;
    assert(row !== undefined, `count query on bms.${table} returned no row`);
    assert(
      Number(row.total) > 0,
      `bms.${table} is empty, so this suite proved nothing. Run \`pnpm db:seed\` before this suite.`,
    );
    assert(
      Number(row.violations) === 0,
      `${row.violations} of ${row.total} bms.${table} rows carry a point-metadata value. ` +
        "Migration 0063 must be additive — NULL means inherit / no override.",
    );
  }
}

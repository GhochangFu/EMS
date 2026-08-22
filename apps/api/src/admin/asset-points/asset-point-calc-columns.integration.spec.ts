import type pg from "pg";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * `F2.6` U1 — migration `0037_asset_point_calc_override` asserted against the
 * database rather than against the Drizzle model that describes it.
 *
 * Drizzle's schema object is a *claim* about the columns. `pnpm typecheck` is
 * happy with a claim no migration ever made true, and the resolution merge U3
 * builds on top of this reads the real columns — so the model agreeing with
 * itself proves nothing. These assertions read `information_schema`.
 *
 * The assertion that matters most is not that the columns exist. It is that
 * **no existing row changed meaning**: ADR 0039 decision 6 makes `NULL` mean
 * "inherit from the pinned template version", which is exactly what every row
 * written before this migration already did implicitly. A migration that
 * defaulted any of these five to a non-NULL value would silently give every
 * asset in the estate an override of its template.
 */

/** The five override columns, with the `template_points` types they mirror. */
const CALC_OVERRIDE_COLUMNS: ReadonlyArray<{
  readonly name: string;
  readonly dataType: string;
  readonly maxLength: number | null;
}> = [
  { name: "formula", dataType: "text", maxLength: null },
  { name: "formula_dialect", dataType: "character varying", maxLength: 32 },
  { name: "calc_trigger", dataType: "character varying", maxLength: 16 },
  { name: "calc_interval_seconds", dataType: "integer", maxLength: null },
  { name: "max_input_age_seconds", dataType: "integer", maxLength: null },
];

type ColumnRow = {
  column_name: string;
  data_type: string;
  is_nullable: string;
  character_maximum_length: number | null;
  column_default: string | null;
};

/**
 * Every column landed, nullable, with no default, at the width
 * `template_points` uses.
 *
 * `column_default` is checked because a default is the one way an `ADD COLUMN`
 * can rewrite meaning without touching a row's stored value: Postgres 11+
 * serves the default to every pre-existing row, so `DEFAULT 'streaming'` here
 * would make the whole estate read as overridden while `\d` still looked
 * additive. The width is checked because the merge U3 builds coalesces these
 * with `template_points`, and a narrower `formula_dialect` here would truncate
 * a value the template accepted.
 */
export async function assertCalcOverrideColumnsExistAndAreNullable(pool: pg.Pool): Promise<void> {
  const { rows } = await pool.query<ColumnRow>(
    `SELECT column_name, data_type, is_nullable, character_maximum_length, column_default
       FROM information_schema.columns
      WHERE table_schema = 'bms' AND table_name = 'asset_points'
        AND column_name = ANY($1::text[])`,
    [CALC_OVERRIDE_COLUMNS.map((c) => c.name)],
  );

  const byName = new Map(rows.map((r) => [r.column_name, r]));
  for (const expected of CALC_OVERRIDE_COLUMNS) {
    const actual = byName.get(expected.name);
    assert(
      actual !== undefined,
      `bms.asset_points is missing column "${expected.name}" — migration ` +
        "0037_asset_point_calc_override did not run. Check that meta/_journal.json " +
        "carries its entry; drizzle silently skips a .sql file the journal omits.",
    );
    const column = actual as ColumnRow;
    assert(
      column.is_nullable === "YES",
      `bms.asset_points.${expected.name} is NOT NULL. ADR 0039 decision 6 needs ` +
        "NULL to mean \"inherit from the template\"; a NOT NULL column cannot say that.",
    );
    assert(
      column.column_default === null,
      `bms.asset_points.${expected.name} has default ${String(column.column_default)}. ` +
        "Postgres serves a default to every pre-existing row, so this would turn the " +
        "whole estate into overridden points without rewriting a single stored value.",
    );
    assert(
      column.data_type === expected.dataType,
      `bms.asset_points.${expected.name} is ${column.data_type}, expected ` +
        `${expected.dataType} to mirror bms.template_points.`,
    );
    assert(
      column.character_maximum_length === expected.maxLength,
      `bms.asset_points.${expected.name} has width ` +
        `${String(column.character_maximum_length)}, expected ${String(expected.maxLength)} — ` +
        "it must match bms.template_points or the coalesce can truncate.",
    );
  }
}

/**
 * The five columns are exactly as wide and as typed as their `template_points`
 * counterparts, read from the database rather than from this file's table.
 *
 * The constant above could drift from `template_points` without any test
 * noticing; this compares the two catalogs directly, so widening one side alone
 * fails here.
 */
export async function assertColumnsMirrorTemplatePoints(pool: pg.Pool): Promise<void> {
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
    [CALC_OVERRIDE_COLUMNS.map((c) => c.name)],
  );

  assert(
    rows.length === CALC_OVERRIDE_COLUMNS.length,
    `expected ${CALC_OVERRIDE_COLUMNS.length} rows, got ${rows.length}`,
  );
  for (const row of rows) {
    assert(
      row.asset_type !== null && row.asset_type === row.template_type,
      `bms.asset_points.${row.column_name} is ${String(row.asset_type)} but ` +
        `bms.template_points.${row.column_name} is ${String(row.template_type)} — ` +
        "coalesce() of two different types is not the override ADR 0039 decision 6 describes.",
    );
    assert(
      row.asset_len === row.template_len,
      `bms.asset_points.${row.column_name} is width ${String(row.asset_len)} but ` +
        `bms.template_points.${row.column_name} is ${String(row.template_len)}.`,
    );
  }
}

/**
 * No pre-existing row changed meaning, and the check is not vacuous.
 *
 * Scoped to rows the migration could not have been about: ADR 0039 decision 7
 * says only a `source_kind = 'computed'` row ever carries an override, so every
 * `measured`, `manual` and `unmapped` row must read NULL across all five —
 * before this migration and forever after. Asserting over *all* rows instead
 * would start failing the moment `U7`'s own suite writes a legitimate override,
 * which is a test that decays rather than one that guards.
 *
 * The non-vacuity guard matters more than it looks: on an unseeded database
 * every "no row violates X" query passes, and this suite would go green having
 * asserted nothing about a migration that never ran.
 */
export async function assertNoExistingRowGainedAnOverride(pool: pg.Pool): Promise<void> {
  const predicate = CALC_OVERRIDE_COLUMNS.map((c) => `${c.name} IS NOT NULL`).join(" OR ");
  const { rows } = await pool.query<{ total: string; non_computed: string; violations: string }>(
    `SELECT count(*) AS total,
            count(*) FILTER (WHERE source_kind <> 'computed') AS non_computed,
            count(*) FILTER (WHERE source_kind <> 'computed' AND (${predicate})) AS violations
       FROM bms.asset_points`,
  );

  const [row] = rows;
  assert(row !== undefined, "count query returned no row");
  const counts = row as { total: string; non_computed: string; violations: string };
  assert(
    Number(counts.total) > 0,
    "bms.asset_points is empty, so this suite proved nothing about existing rows. " +
      "Run `pnpm db:seed` against DATABASE_URL before the integration suites.",
  );
  assert(
    Number(counts.non_computed) > 0,
    "every bms.asset_points row is source_kind = 'computed', so the \"no measured " +
      "or manual row carries an override\" assertion is vacuous. Reseed.",
  );
  assert(
    Number(counts.violations) === 0,
    `${counts.violations} of ${counts.non_computed} non-computed bms.asset_points rows ` +
      "carry a calc override. Migration 0037 must be additive: NULL means \"inherit\", " +
      "and only a computed point may depart from its template (ADR 0039 decision 7).",
  );
}

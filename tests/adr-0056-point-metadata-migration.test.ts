import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

/**
 * `F2.7` / ADR 0056 decisions 1 and 2 — the five point-metadata columns
 * (`scale_multiplier`, `scale_offset`, `eng_min`, `eng_max`, `quality_policy`)
 * on `bms.template_points` and `bms.asset_points`, migration `0063`, and the
 * three within-row CHECKs each. Model: `tests/adr-0055-min-coverage-ratio-migration.test.ts`.
 *
 * **Assertions inline, no `.spec` sibling** — the top-level `tests/` carve-out
 * (§4.6).
 */
const MIGRATION_REL = "packages/db/drizzle/0063_point_metadata.sql";
const JOURNAL_REL = "packages/db/drizzle/meta/_journal.json";

/**
 * Comments stripped before every assertion. The `f3.1a` lesson: a header
 * quoting DDL in a comment kept a `toContain` green after the statement
 * itself was deleted.
 */
const sqlOnly = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

const COLUMN_ADDS: ReadonlyArray<{ table: "template_points" | "asset_points"; column: string; type: string }> = [
  { table: "template_points", column: "scale_multiplier", type: "double precision" },
  { table: "template_points", column: "scale_offset", type: "double precision" },
  { table: "template_points", column: "eng_min", type: "double precision" },
  { table: "template_points", column: "eng_max", type: "double precision" },
  { table: "template_points", column: "quality_policy", type: "varchar(16)" },
  { table: "asset_points", column: "scale_multiplier", type: "double precision" },
  { table: "asset_points", column: "scale_offset", type: "double precision" },
  { table: "asset_points", column: "eng_min", type: "double precision" },
  { table: "asset_points", column: "eng_max", type: "double precision" },
  { table: "asset_points", column: "quality_policy", type: "varchar(16)" },
];

const CONSTRAINTS: ReadonlyArray<{ table: "template_points" | "asset_points"; name: string }> = [
  { table: "template_points", name: "template_points_eng_range_check" },
  { table: "template_points", name: "template_points_scale_multiplier_check" },
  { table: "template_points", name: "template_points_quality_policy_check" },
  { table: "asset_points", name: "asset_points_eng_range_check" },
  { table: "asset_points", name: "asset_points_scale_multiplier_check" },
  { table: "asset_points", name: "asset_points_quality_policy_check" },
];

describe("F2.7 — migration 0063 exists", () => {
  it("0063_point_metadata.sql is present in packages/db/drizzle", () => {
    expect(() => read(MIGRATION_REL)).not.toThrow();
  });
});

describe("F2.7 point-metadata columns and CHECKs (ADR 0056 decisions 1, 2)", () => {
  const sql = sqlOnly(read(MIGRATION_REL));

  it("the stripped SQL is non-empty and substantial", () => {
    expect(sql.length).toBeGreaterThan(50);
  });

  it("adds all ten columns as ADD COLUMN IF NOT EXISTS <name> <type>", () => {
    for (const { column, type } of COLUMN_ADDS) {
      expect(
        sql.includes(`ADD COLUMN IF NOT EXISTS ${column} ${type}`),
        `migration 0063 must ADD COLUMN IF NOT EXISTS ${column} ${type}.`,
      ).toBe(true);
    }
  });

  it("guards each of the six constraint names inside an IF NOT EXISTS ... conrelid check", () => {
    for (const { table, name } of CONSTRAINTS) {
      const guardPattern = new RegExp(
        `IF NOT EXISTS \\(\\s*SELECT 1 FROM pg_constraint\\s*WHERE conname = '${name}'\\s*AND conrelid = 'bms\\.${table}'::regclass\\s*\\)`,
      );
      expect(
        guardPattern.test(sql),
        `constraint ${name} must be added inside an IF NOT EXISTS guard qualified on ` +
          `conname AND conrelid = 'bms.${table}'::regclass.`,
      ).toBe(true);
      // Each constraint name appears exactly once (the guard, and the ADD CONSTRAINT it protects).
      const occurrences = sql.split(name).length - 1;
      expect(occurrences, `${name} should appear exactly twice (guard check + ADD CONSTRAINT)`).toBe(2);
    }
  });

  it("does not add DEFAULT anywhere", () => {
    expect(/DEFAULT/i.test(sql), "no point-metadata column may have a DEFAULT — NULL means inherit").toBe(false);
  });

  it("takes the SET ROLE bms_owner / RESET ROLE bracket", () => {
    expect(sql.includes("SET ROLE bms_owner;"), "migration 0063 has no SET ROLE bms_owner.").toBe(true);
    expect(sql.includes("RESET ROLE;"), "migration 0063 has no RESET ROLE.").toBe(true);
  });

  it("journals migration 0063 with a tag equalling the filename stem, and a when strictly greater than 0062's", () => {
    const journal = JSON.parse(read(JOURNAL_REL)) as {
      entries: ReadonlyArray<{ idx: number; when: number; tag: string }>;
    };

    const entry62 = journal.entries.find((e) => e.idx === 62);
    expect(entry62, "journal entry idx 62 (0062_template_point_min_coverage_ratio) not found").toBeDefined();

    const stem = MIGRATION_REL.split("/").pop()!.replace(/\.sql$/, "");
    const entry63 = journal.entries.find((e) => e.tag === stem);
    expect(
      entry63,
      `no journal entry with tag "${stem}". Drizzle matches migrations to journal entries ` +
        "by tag; an unjournalled .sql file is silently skipped.",
    ).toBeDefined();

    expect(
      entry63?.when,
      "migration 0063's journal when must be strictly greater than 0062's — read both " +
        "from the file, never a literal copy, so a later regeneration mistake is caught.",
    ).toBeGreaterThan(entry62!.when);
  });

  it("bms-schema.ts declares the five drizzle columns on both template_points and asset_points", () => {
    const schemaSource = read("packages/db/src/schema/bms-schema.ts");

    for (const tableName of ["template_points", "asset_points"] as const) {
      const start = schemaSource.indexOf(`bmsSchema.table("${tableName}"`);
      expect(start, `bms.${tableName} table definition not found in bms-schema.ts`).toBeGreaterThan(-1);
      const end = schemaSource.indexOf("\n});", start);
      const block = schemaSource.slice(start, end + 4);

      expect(
        /scaleMultiplier:\s*doublePrecision\(\s*"scale_multiplier"/.test(block),
        `the ${tableName} drizzle table has no scaleMultiplier column`,
      ).toBe(true);
      expect(
        /scaleOffset:\s*doublePrecision\(\s*"scale_offset"/.test(block),
        `the ${tableName} drizzle table has no scaleOffset column`,
      ).toBe(true);
      expect(
        /engMin:\s*doublePrecision\(\s*"eng_min"/.test(block),
        `the ${tableName} drizzle table has no engMin column`,
      ).toBe(true);
      expect(
        /engMax:\s*doublePrecision\(\s*"eng_max"/.test(block),
        `the ${tableName} drizzle table has no engMax column`,
      ).toBe(true);
      expect(
        /qualityPolicy:\s*varchar\(\s*"quality_policy",\s*\{\s*length:\s*16\s*\}/.test(block),
        `the ${tableName} drizzle table has no qualityPolicy column`,
      ).toBe(true);
    }
  });
});

/**
 * Migration `0064` — the fourth within-row rule the PR 1 reviews asked for: the
 * four numeric metadata columns are finite. Postgres sorts `NaN` above every
 * float8, so `0063`'s `eng_min < eng_max` and `scale_multiplier <> 0` both
 * admit `NaN`; the `0031` range form (`> '-Infinity' AND < 'Infinity'`) is
 * the one that refuses it, and both infinities with it.
 */
describe("F2.7 point-metadata finite CHECKs (migration 0064, ADR 0056 decision 2)", () => {
  const FINITE_MIGRATION_REL = "packages/db/drizzle/0064_point_metadata_finite_check.sql";
  const FINITE_CONSTRAINTS = [
    { table: "template_points", name: "template_points_point_metadata_finite_check" },
    { table: "asset_points", name: "asset_points_point_metadata_finite_check" },
  ] as const;
  const NUMERIC_COLUMNS = ["scale_multiplier", "scale_offset", "eng_min", "eng_max"] as const;

  it("0064_point_metadata_finite_check.sql is present in packages/db/drizzle", () => {
    expect(existsSync(join(repoRoot, FINITE_MIGRATION_REL)), `${FINITE_MIGRATION_REL} is missing.`).toBe(true);
  });

  it("guards each of the two constraint names inside an IF NOT EXISTS ... conrelid check", () => {
    const sql = sqlOnly(read(FINITE_MIGRATION_REL));
    for (const { table, name } of FINITE_CONSTRAINTS) {
      const guard = new RegExp(
        `IF NOT EXISTS \\([^)]*conname = '${name}'[^)]*conrelid = 'bms\\.${table}'::regclass[^)]*\\)`,
        "s",
      );
      expect(guard.test(sql), `constraint ${name} on bms.${table} is not guarded by conname AND conrelid.`).toBe(true);
      expect(sql.split(`ADD CONSTRAINT ${name}`).length - 1, `${name} must be added exactly once.`).toBe(1);
    }
  });

  it("bounds every numeric column on both tables with the 0031 range form, NULL-permissive", () => {
    const sql = sqlOnly(read(FINITE_MIGRATION_REL));
    for (const column of NUMERIC_COLUMNS) {
      const clause = new RegExp(
        `\\(${column} IS NULL OR \\(${column} > '-Infinity'::float8 AND ${column} < 'Infinity'::float8\\)\\)`,
        "g",
      );
      const occurrences = (sql.match(clause) ?? []).length;
      expect(
        occurrences,
        `the finite clause for ${column} must appear once per table (2), found ${occurrences}. ` +
          "A `col = col` guard would be a no-op: PostgreSQL defines NaN = NaN as TRUE.",
      ).toBe(2);
    }
    expect(/quality_policy\s*[<>]/.test(sql), "quality_policy is a varchar and has no finite rule.").toBe(false);
    expect(/\bDEFAULT\b/.test(sql), "migration 0064 must not add a DEFAULT.").toBe(false);
  });

  it("takes the SET ROLE bms_owner / RESET ROLE bracket", () => {
    const sql = sqlOnly(read(FINITE_MIGRATION_REL));
    expect(sql.includes("SET ROLE bms_owner;"), "migration 0064 has no SET ROLE bms_owner.").toBe(true);
    expect(sql.includes("RESET ROLE;"), "migration 0064 has no RESET ROLE.").toBe(true);
  });

  it("journals migration 0064 with a tag equalling the filename stem, and a when strictly greater than 0063's", () => {
    const journal = JSON.parse(read(JOURNAL_REL)) as {
      entries: ReadonlyArray<{ idx: number; when: number; tag: string }>;
    };
    const entry63 = journal.entries.find((e) => e.idx === 63);
    expect(entry63, "journal entry idx 63 (0063_point_metadata) not found").toBeDefined();
    const stem = FINITE_MIGRATION_REL.split("/").pop()!.replace(/\.sql$/, "");
    const entry64 = journal.entries.find((e) => e.tag === stem);
    expect(entry64, `no journal entry with tag "${stem}".`).toBeDefined();
    expect(entry64?.idx).toBe(64);
    expect(entry64?.when, "0064's when must be strictly greater than 0063's").toBeGreaterThan(entry63!.when);
  });
});

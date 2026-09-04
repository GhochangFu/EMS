import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

/**
 * `F2.9` / ADR 0055 decision 11 — `bms.template_points.min_coverage_ratio`,
 * migration `0062`. Model: `tests/f2.13-asset-template-stock-stamp.test.ts`.
 *
 * **Assertions inline, no `.spec` sibling** — the top-level `tests/` carve-out
 * (§4.6).
 */
const MIGRATION_REL = "packages/db/drizzle/0062_template_point_min_coverage_ratio.sql";
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

describe("F2.9 — migration 0062 exists", () => {
  it("0062_template_point_min_coverage_ratio.sql is present in packages/db/drizzle", () => {
    expect(() => read(MIGRATION_REL)).not.toThrow();
  });
});

describe("F2.9 template_points.min_coverage_ratio (ADR 0055 decision 11)", () => {
  const sql = sqlOnly(read(MIGRATION_REL));

  it("the stripped SQL is non-empty and substantial", () => {
    expect(sql.length).toBeGreaterThan(50);
  });

  it("adds min_coverage_ratio as a plain nullable double precision column", () => {
    expect(
      sql.includes(
        "ADD COLUMN IF NOT EXISTS min_coverage_ratio double precision",
      ),
      "migration 0062 must ADD COLUMN IF NOT EXISTS min_coverage_ratio double precision to " +
        "bms.template_points.",
    ).toBe(true);
  });

  it("does not add NOT NULL, DEFAULT or CHECK — NULL is fail-closed, not a limit", () => {
    expect(
      /NOT NULL/i.test(sql),
      "min_coverage_ratio must stay nullable: NULL means every declared aggregate member " +
        "must be fresh (ADR 0055 decision 11), not 'no limit'.",
    ).toBe(false);
    expect(
      /DEFAULT/i.test(sql),
      "min_coverage_ratio must have no DEFAULT — an implicit default would silently change " +
        "the fail-closed meaning of NULL for every existing row.",
    ).toBe(false);
    expect(
      /CHECK/i.test(sql),
      "min_coverage_ratio must have no CHECK — the (0, 1] bound lives in apps/api's Zod " +
        "layer, the 0035/0036 precedent ADR 0055 names.",
    ).toBe(false);
  });

  it("takes the SET ROLE bms_owner / RESET ROLE bracket, per 0060's default branch", () => {
    expect(
      sql.includes("SET ROLE bms_owner;"),
      "migration 0062 has no SET ROLE bms_owner. bms_owner owns bms.template_points, and " +
        "the repo's default branch (0060's header) is to take the bracket even when the " +
        "file drops no policy.",
    ).toBe(true);
    expect(
      sql.includes("RESET ROLE;"),
      "migration 0062 has no RESET ROLE. A forgotten RESET ROLE leaks past COMMIT into " +
        "drizzle's own journal INSERT and every later migration in the same run.",
    ).toBe(true);
  });

  it("journals migration 0062 with a tag equalling the filename stem, and a when strictly greater than 0061's", () => {
    const journal = JSON.parse(read(JOURNAL_REL)) as {
      entries: ReadonlyArray<{ idx: number; when: number; tag: string }>;
    };

    const entry61 = journal.entries.find((e) => e.idx === 61);
    expect(entry61, "journal entry idx 61 (0061_asset_template_stock_stamp) not found").toBeDefined();

    const stem = MIGRATION_REL.split("/").pop()!.replace(/\.sql$/, "");
    const entry62 = journal.entries.find((e) => e.tag === stem);
    expect(
      entry62,
      `no journal entry with tag "${stem}". Drizzle matches migrations to journal entries ` +
        "by tag; an unjournalled .sql file is silently skipped.",
    ).toBeDefined();

    expect(
      entry62?.when,
      "migration 0062's journal when must be strictly greater than 0061's — read both " +
        "from the file, never a literal copy, so a later regeneration mistake is caught.",
    ).toBeGreaterThan(entry61!.when);
  });

  it("packages/db/src/schema/bms-schema.ts declares minCoverageRatio on templatePoints", () => {
    const schemaSource = read("packages/db/src/schema/bms-schema.ts");
    const start = schemaSource.indexOf('bmsSchema.table("template_points"');
    expect(start, "bms.template_points table definition not found in bms-schema.ts").toBeGreaterThan(-1);
    const end = schemaSource.indexOf("\n});", start);
    const block = schemaSource.slice(start, end + 4);

    expect(
      /minCoverageRatio:\s*doublePrecision\(\s*"min_coverage_ratio"/.test(block),
      "the templatePoints drizzle table has no minCoverageRatio column — SQL and ORM would drift.",
    ).toBe(true);
  });
});

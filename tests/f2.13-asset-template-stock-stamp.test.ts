import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const drizzleDir = join(repoRoot, "packages", "db", "drizzle");
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

/**
 * `F2.13` / ADR 0052 — `bms.asset_templates` gets the stock stamp
 * `bms.dashboard_templates` already carries (migration `0056`). Model:
 * `tests/f3.36-dashboard-templates-schema.test.ts`.
 *
 * **Assertions inline, no `.spec` sibling** — the top-level `tests/` carve-out
 * (§4.6).
 */
const MIGRATION_PREFIX = "0061_";
const JOURNAL_REL = "packages/db/drizzle/meta/_journal.json";
const PREVIOUS_WHEN = 1788870783386; // 0060's `when`.

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

const migrationFile = readdirSync(drizzleDir).find(
  (f) => f.startsWith(MIGRATION_PREFIX) && f.endsWith(".sql"),
);
const migration = migrationFile
  ? readFileSync(join(drizzleDir, migrationFile), "utf8")
  : null;

describe("F2.13 — migration 0061 exists", () => {
  it("0061_*.sql is present in packages/db/drizzle", () => {
    expect(
      migration,
      "0061_*.sql not found. Task 1 writes it before this suite goes green; 0056-0060 are " +
        "committed and frozen by the pre-commit hook, so the next number is 0061.",
    ).not.toBeNull();
  });
});

describe("F2.13 asset_templates stock stamp (ADR 0052, mirrors 0056)", () => {
  const sql = sqlOnly(migration ?? "");

  it("the stripped SQL is non-empty and substantial", () => {
    expect(sql.length).toBeGreaterThan(200);
  });

  it("adds stock_code and stock_version, neither NOT NULL — the table has live rows", () => {
    expect(
      /ADD COLUMN IF NOT EXISTS\s+stock_code\s+varchar\(64\)/i.test(sql),
      "migration 0061 must ADD COLUMN IF NOT EXISTS stock_code varchar(64) to " +
        "bms.asset_templates, mirroring 0056's dashboard_templates.stock_code.",
    ).toBe(true);
    expect(
      /ADD COLUMN IF NOT EXISTS\s+stock_version\s+integer/i.test(sql),
      "migration 0061 must ADD COLUMN IF NOT EXISTS stock_version integer to " +
        "bms.asset_templates, mirroring 0056's dashboard_templates.stock_version.",
    ).toBe(true);

    const stockCodeNotNull = /stock_code\s+varchar\(64\)\s+NOT NULL/i;
    expect(
      stockCodeNotNull.test(sql),
      "stock_code must NOT be NOT NULL — bms.asset_templates already has live rows, and a " +
        "hand-authored template has no stock stamp.",
    ).toBe(false);
    // Anti-vacuity twin.
    expect(stockCodeNotNull.test("stock_code varchar(64) NOT NULL")).toBe(true);

    const stockVersionNotNull = /stock_version\s+integer\s+NOT NULL/i;
    expect(
      stockVersionNotNull.test(sql),
      "stock_version must NOT be NOT NULL — same reason as stock_code.",
    ).toBe(false);
    expect(stockVersionNotNull.test("stock_version integer NOT NULL")).toBe(true);
  });

  it("closes the pair with asset_templates_stock_stamp_check, guarded by an IF NOT EXISTS DO block", () => {
    expect(sql).toContain("asset_templates_stock_stamp_check");
    expect(sql).toContain("(stock_code IS NULL) = (stock_version IS NULL)");

    const guardedBlock =
      /DO \$\$[\s\S]*?IF NOT EXISTS\s*\(\s*SELECT 1 FROM pg_constraint[\s\S]*?conname\s*=\s*'asset_templates_stock_stamp_check'[\s\S]*?conrelid\s*=\s*'bms\.asset_templates'::regclass[\s\S]*?\)\s*THEN[\s\S]*?asset_templates_stock_stamp_check[\s\S]*?END\s*\$\$;/i;
    expect(
      guardedBlock.test(sql),
      "asset_templates_stock_stamp_check must be added inside a " +
        "DO $$ ... IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = ... AND " +
        "conrelid = 'bms.asset_templates'::regclass) ... END $$; guard, exactly like 0056's " +
        "dashboard_templates_stock_stamp_check.",
    ).toBe(true);
  });

  it("takes the SET ROLE bms_owner / RESET ROLE bracket, per 0060's default branch", () => {
    expect(
      sql.includes("SET ROLE bms_owner;"),
      "migration 0061 has no SET ROLE bms_owner. bms_owner owns bms.asset_templates, and " +
        "the repo's default branch (0060's header) is to take the bracket even when the " +
        "file drops no policy.",
    ).toBe(true);
    expect(
      sql.includes("RESET ROLE;"),
      "migration 0061 has no RESET ROLE. A forgotten RESET ROLE leaks past COMMIT into " +
        "drizzle's own journal INSERT and every later migration in the same run.",
    ).toBe(true);
  });

  it("journals migration 0061 with a tag equalling the filename stem, and a when strictly greater than 0060's", () => {
    const journalText = read(JOURNAL_REL);
    const journal = JSON.parse(journalText) as {
      entries: ReadonlyArray<{ idx: number; when: number; tag: string }>;
    };

    expect(
      journal.entries.length,
      "the journal must parse at least 61 entries — idx 0 through 61 with the pre-existing gap " +
        "at idx 20, so 0000…0061 is 61 entries, not 62. Move the bound when 0062 lands.",
    ).toBeGreaterThanOrEqual(61);

    const stem = (migrationFile ?? "").replace(/\.sql$/, "");
    const entry = journal.entries.find((e) => e.tag === stem);
    expect(
      entry,
      `no journal entry with tag "${stem}". Drizzle matches migrations to journal entries ` +
        "by tag; an unjournalled .sql file is silently skipped.",
    ).toBeDefined();

    expect(
      entry?.when,
      "migration 0061's journal when must be strictly greater than 0060's " +
        `(${PREVIOUS_WHEN}). A generated when is behind 0060's — drizzle applies nothing on ` +
        "a database that already holds 0060, and every check downstream passes against a " +
        "schema short two columns.",
    ).toBeGreaterThan(PREVIOUS_WHEN);
  });

  it("packages/db/src/schema/bms-schema.ts declares stockCode/stockVersion on assetTemplates", () => {
    const schemaSource = read("packages/db/src/schema/bms-schema.ts");
    const start = schemaSource.indexOf('bmsSchema.table("asset_templates"');
    expect(start, "bms.asset_templates table definition not found in bms-schema.ts").toBeGreaterThan(-1);
    const end = schemaSource.indexOf("\n});", start);
    const block = schemaSource.slice(start, end + 4);

    expect(
      /stockCode:\s*varchar\(\s*"stock_code"/i.test(block),
      "the assetTemplates drizzle table has no stockCode column — SQL and ORM would drift.",
    ).toBe(true);
    expect(
      /stockVersion:\s*integer\(\s*"stock_version"/i.test(block),
      "the assetTemplates drizzle table has no stockVersion column — SQL and ORM would drift.",
    ).toBe(true);
  });
});

/**
 * Cheap belt to the pre-commit hook's braces. A committed migration is frozen
 * even before it merges, so `F2.13` writes `0061` rather than editing
 * `0056`-`0060`.
 */
describe("F2.13 — the committed migrations stay frozen", () => {
  const FROZEN: ReadonlyArray<readonly [string, string]> = [
    ["0056_dashboard_templates.sql", "-- F3.36 / ADR 0049 decision 1 + Amendment 1 decision 3 + Amendment 2 — section"],
    ["0060_asset_role_estate_shapes.sql", "-- 0060 — two role codes for the shapes the estate actually holds."],
  ];

  it.each(FROZEN)("%s is unchanged", (file, firstLine) => {
    const path = join(drizzleDir, file);
    expect(
      readFileSync(path, "utf8").split("\n")[0],
      `${file} was edited. Migrations are forward-only and a committed one is frozen even ` +
        `before it merges (§4.4). Write the next migration instead.`,
    ).toBe(firstLine);
  });
});

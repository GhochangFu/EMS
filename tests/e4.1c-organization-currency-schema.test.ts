import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const drizzleDir = join(repoRoot, "packages", "db", "drizzle");
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

/**
 * `E4.1c` / ADR 0070 decision 8 — migration `0076` adds
 * `bms.organizations.currency` (`char(3)`, `NOT NULL`, NO default, ISO 4217
 * shape enforced by a CHECK). Money has a currency, and the currency is the
 * organization's: every indicative-cost figure the dashboard and the energy
 * report return is labelled with it, and a fleet spanning two currencies
 * renders a dash rather than a sum (plan §3.2).
 *
 * **Why no DEFAULT.** A defaulted currency would be a silent guess the money
 * points then label with — the same argument `0075` makes for a timezone. The
 * backfill is fail-closed: the two seeded organizations are stamped by code
 * (`ESKOM` → `ZAR`, `PHEWB` → `INR`) and a `DO $$` block aborts naming any
 * other row still `NULL` BEFORE `SET NOT NULL` runs, so a deployed database
 * with a third organization stops the migration rather than guessing.
 *
 * **Assertions inline, no `.spec` sibling.** §4.6 carves out the top-level
 * `tests/` directory; `tests/e4.1b-location-timezone-schema.test.ts` is the
 * direct model (`sqlOnly`, the journal ordering read from the file).
 *
 * **What is NOT tested here.** What Postgres actually enforces is
 * `tests/e4.1c-organization-currency-schema.integration.test.ts`'s job; the
 * write-path validation (ISO 4217 through `Intl.supportedValuesOf`) is
 * `organizations.currency.integration.spec.ts`'s.
 */
const MIGRATION_PREFIX = "0076_";
const MIGRATION_TAG = "0076_organization_currency";
const JOURNAL_REL = "packages/db/drizzle/meta/_journal.json";

/** Comments stripped, so a header quoting the body cannot satisfy an assertion
 * about a statement that was actually deleted (`f3.1a`'s lesson). */
const sqlOnly = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

/** The `ADD COLUMN` statement alone, so a `DEFAULT` in a COMMENT string or in
 * a neighbouring statement cannot decide S2. */
const addColumnBlock = (migration: string): string => {
  const start = migration.indexOf("ADD COLUMN IF NOT EXISTS currency");
  if (start < 0) throw new Error("no ADD COLUMN IF NOT EXISTS currency");
  const end = migration.indexOf(";", start);
  return end < 0 ? migration.slice(start) : migration.slice(start, end + 1);
};

/** The `organizations` table literal in `bms-schema.ts`, from its declaration
 * to the closing `});` — so a `currency` column on another table cannot satisfy S7. */
const organizationsTableBlock = (schema: string): string => {
  const start = schema.indexOf('export const organizations = bmsSchema.table("organizations", {');
  if (start < 0) throw new Error("no organizations table in bms-schema.ts");
  const end = schema.indexOf("\n});", start);
  return end < 0 ? schema.slice(start) : schema.slice(start, end + 4);
};

/** The seed's `INSERT INTO bms.organizations … ` statement, comments dropped,
 * so a comment quoting the literal cannot keep S8 green with the value deleted. */
const seedInsertBlock = (source: string): string => {
  const start = source.indexOf("INSERT INTO bms.organizations");
  if (start < 0) throw new Error("no INSERT INTO bms.organizations in the seed");
  const end = source.indexOf("`", start);
  const block = end < 0 ? source.slice(start) : source.slice(start, end);
  return block
    .split("\n")
    .filter((line) => !line.trim().startsWith("--") && !line.trim().startsWith("//"))
    .join("\n");
};

const migrationFile = readdirSync(drizzleDir).find(
  (f) => f.startsWith(MIGRATION_PREFIX) && f.endsWith(".sql"),
);
const migration = migrationFile
  ? readFileSync(join(drizzleDir, migrationFile), "utf8")
  : null;

describe("E4.1c — migration 0076 exists", () => {
  it("0076_*.sql is present in packages/db/drizzle", () => {
    expect(
      migration,
      "0076_*.sql not found. U1 writes it before this suite goes green; 0051-0075 " +
        "are committed and frozen by the pre-commit hook, so the next number is 0076.",
    ).not.toBeNull();
  });
});

describe("E4.1c organizations.currency (ADR 0070 decision 8)", () => {
  const sql = sqlOnly(migration ?? "");
  const journal = JSON.parse(read(JOURNAL_REL)) as {
    entries: Array<{ idx: number; tag: string; when: number }>;
  };
  const entry75 = journal.entries.find((e) => e.idx === 75);
  const entry76 = journal.entries.find((e) => e.idx === 76);

  // S1
  it("adds the column: ADD COLUMN IF NOT EXISTS currency char(3)", () => {
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS currency char(3)");
  });

  // S2 — no default: a defaulted currency is a silent guess.
  it("the ADD COLUMN statement carries no DEFAULT", () => {
    const block = addColumnBlock(sql);
    expect(block, "a default currency would be a silent guess the money points label with").not.toMatch(
      /DEFAULT/i,
    );
    // Positive control for the slice: the block does contain the column itself.
    expect(block).toContain("currency char(3)");
  });

  // S3 — the fail-closed backfill order: UPDATE ESKOM, UPDATE PHEWB, RAISE, then SET NOT NULL.
  it("backfills ESKOM → ZAR and PHEWB → INR, aborts on any other NULL row, then SET NOT NULL — in that order", () => {
    const eskom = sql.search(/UPDATE bms\.organizations SET currency = 'ZAR'\s+WHERE code = 'ESKOM' AND currency IS NULL/);
    const phewb = sql.search(/UPDATE bms\.organizations SET currency = 'INR'\s+WHERE code = 'PHEWB' AND currency IS NULL/);
    const raise = sql.indexOf("RAISE EXCEPTION");
    const notNull = sql.indexOf("ALTER COLUMN currency SET NOT NULL");
    expect(eskom, "the ESKOM backfill, guarded by `currency IS NULL`").toBeGreaterThanOrEqual(0);
    expect(phewb, "the PHEWB backfill, guarded by `currency IS NULL`").toBeGreaterThanOrEqual(0);
    expect(raise, "a DO $$ block must RAISE EXCEPTION on a row still NULL").toBeGreaterThanOrEqual(0);
    expect(notNull, "SET NOT NULL is what the abort protects").toBeGreaterThanOrEqual(0);
    expect(eskom).toBeLessThan(raise);
    expect(phewb).toBeLessThan(raise);
    expect(raise).toBeLessThan(notNull);
    // The abort names the offending row(s) — a bare RAISE would send the operator to psql.
    const doBlock = sql.slice(sql.indexOf("DO $$"), sql.indexOf("$$;", raise) + 3);
    expect(doBlock).toContain("WHERE currency IS NULL");
    expect(doBlock).toMatch(/RAISE EXCEPTION '[^']*%[^']*',/);
  });

  // S4 — the CHECK: three upper-case ASCII letters, the ISO 4217 shape.
  it("adds organizations_currency_check CHECK (currency ~ '^[A-Z]{3}$'), idempotently", () => {
    expect(sql).toContain("DROP CONSTRAINT IF EXISTS organizations_currency_check");
    expect(sql).toContain(
      "ADD CONSTRAINT organizations_currency_check CHECK (currency ~ '^[A-Z]{3}$')",
    );
    expect(sql.indexOf("DROP CONSTRAINT IF EXISTS organizations_currency_check")).toBeLessThan(
      sql.indexOf("ADD CONSTRAINT organizations_currency_check"),
    );
  });

  // S5
  it("does not CREATE EXTENSION (AGENTS.md §4.4), brackets in SET ROLE / RESET ROLE, and comments the column", () => {
    expect(sql).not.toMatch(/CREATE EXTENSION/i);
    expect(sql.indexOf("SET ROLE bms_owner"), "SET ROLE bms_owner not found").toBeGreaterThanOrEqual(0);
    expect(sql).toContain("RESET ROLE");
    expect(sql).toContain("COMMENT ON COLUMN bms.organizations.currency IS");
  });

  // S6 — `when`s are read from the file, neither is a literal here.
  it("journal carries idx 76, tag equal to the file stem, when strictly after idx 75's and not ahead of the clock", () => {
    expect(
      entry76,
      "0076 has no journal entry — drizzle silently skips a migration with no journal row.",
    ).toBeDefined();
    expect(entry76?.tag).toBe(MIGRATION_TAG);
    expect(migrationFile).toBe(`${MIGRATION_TAG}.sql`);
    expect(entry75, "0075's journal entry is the baseline this test orders against").toBeDefined();
    expect(
      entry76?.when ?? 0,
      "F4.94: journal when must be strictly greater than 0075's, or drizzle applies nothing.",
    ).toBeGreaterThan(entry75?.when ?? Number.POSITIVE_INFINITY);
    expect(
      entry76?.when ?? 0,
      "F4.94: a journal `when` ahead of the clock is repaired by hand, never deleted.",
    ).toBeLessThanOrEqual(Date.now());
  });

  // S7
  it('bms-schema.ts declares char("currency", { length: 3 }).notNull() inside the organizations table', () => {
    const block = organizationsTableBlock(read("packages/db/src/schema/bms-schema.ts"));
    expect(block).toContain('currency: char("currency", { length: 3 }).notNull()');
    // No Drizzle-side default either: the column literal must not carry one.
    expect(block).not.toMatch(/currency:[^\n]*\.default\(/);
    // Positive control for the slice: a column organizations does NOT have counts 0 here.
    expect(block).not.toContain('varchar("email"');
  });

  // S8 — the seed owns the value (§3.12): both codes stamped, and re-seeding restates them.
  it("hierarchy-seed.ts stamps 'ZAR' for ESKOM and 'INR' for PHEWB, and the upsert restates currency", () => {
    const insert = seedInsertBlock(read("packages/db/src/hierarchy-seed.ts"));
    expect(insert).toMatch(/\('ESKOM',[^)]*'ZAR'[^)]*\)/);
    expect(insert).toMatch(/\('PHEWB',[^)]*'INR'[^)]*\)/);
    expect(insert).toContain("currency = EXCLUDED.currency");
    // Positive control for the slice: the statement's own column list is inside it.
    expect(insert).toContain("INSERT INTO bms.organizations (code, name, meta, currency)");
  });
});

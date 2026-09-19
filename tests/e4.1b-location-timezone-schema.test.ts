import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const drizzleDir = join(repoRoot, "packages", "db", "drizzle");
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

/**
 * `E4.1b` / ADR 0070 decision 6 — migration `0075` adds
 * `bms.locations.timezone` (IANA zone name, `varchar(64)`, NULLABLE, NO
 * default). `NULL` means "unset": a calendar window on an asset at that
 * location refuses `timezone_unset` (ADR 0070 ruling 6) rather than guessing.
 *
 * **Assertions inline, no `.spec` sibling.** §4.6 carves out the top-level
 * `tests/` directory for repo-wide invariants — `tests/e4.1a-calc-parameters-schema.test.ts`
 * is the direct model this file copies (`sqlOnly`, the journal ordering).
 *
 * **What is NOT tested here.** The write-path validation against
 * `pg_timezone_names` is `locations.timezone.integration.spec.ts`'s job; the
 * live column shape is the migrations job's (cold start) and §4.6's.
 */
const MIGRATION_PREFIX = "0075_";
const MIGRATION_TAG = "0075_location_timezone";
const JOURNAL_REL = "packages/db/drizzle/meta/_journal.json";

/** Comments stripped, so a header quoting the body cannot satisfy an assertion
 * about a statement that was actually deleted (`f3.1a`'s lesson). */
const sqlOnly = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

/** The one `ALTER TABLE bms.locations …;` statement, so a `DEFAULT` or a
 * `NOT NULL` in a COMMENT string or a neighbouring statement cannot decide it. */
const alterBlock = (migration: string): string => {
  const start = migration.indexOf("ALTER TABLE bms.locations");
  if (start < 0) throw new Error("no ALTER TABLE bms.locations");
  const end = migration.indexOf(";", start);
  return end < 0 ? migration.slice(start) : migration.slice(start, end + 1);
};

/** The `locations` table literal in `bms-schema.ts`, from its declaration to
 * the closing `});` — so a `timezone` column on another table cannot satisfy S6. */
const locationsTableBlock = (schema: string): string => {
  const start = schema.indexOf('export const locations = bmsSchema.table("locations", {');
  if (start < 0) throw new Error("no locations table in bms-schema.ts");
  const end = schema.indexOf("\n});", start);
  return end < 0 ? schema.slice(start) : schema.slice(start, end + 4);
};

const migrationFile = readdirSync(drizzleDir).find(
  (f) => f.startsWith(MIGRATION_PREFIX) && f.endsWith(".sql"),
);
const migration = migrationFile
  ? readFileSync(join(drizzleDir, migrationFile), "utf8")
  : null;

describe("E4.1b — migration 0075 exists", () => {
  it("0075_*.sql is present in packages/db/drizzle", () => {
    expect(
      migration,
      "0075_*.sql not found. U1 writes it before this suite goes green; 0051-0074 " +
        "are committed and frozen by the pre-commit hook, so the next number is 0075.",
    ).not.toBeNull();
  });
});

describe("E4.1b locations.timezone (ADR 0070 decision 6)", () => {
  const sql = sqlOnly(migration ?? "");
  const journal = JSON.parse(read(JOURNAL_REL)) as {
    entries: Array<{ idx: number; tag: string; when: number }>;
  };
  const entry74 = journal.entries.find((e) => e.idx === 74);
  const entry75 = journal.entries.find((e) => e.idx === 75);

  // S1
  it("adds the column: ADD COLUMN IF NOT EXISTS timezone varchar(64)", () => {
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS timezone varchar(64)");
  });

  // S2 — nullable, no default (ruling 6: NULL means unset, never a guessed zone).
  it("the ALTER TABLE statement carries neither DEFAULT nor NOT NULL", () => {
    const block = alterBlock(sql);
    expect(block, "a default zone would be a silent guess (ADR 0070 ruling 6)").not.toMatch(/DEFAULT/i);
    expect(block, "the column is nullable — NULL is the timezone_unset signal").not.toMatch(/NOT NULL/i);
    // Positive control for the slice: the block does contain the column itself.
    expect(block).toContain("timezone varchar(64)");
  });

  // S3
  it("does not CREATE EXTENSION (AGENTS.md §4.4) and brackets in SET ROLE / RESET ROLE", () => {
    expect(sql).not.toMatch(/CREATE EXTENSION/i);
    expect(sql.indexOf("SET ROLE bms_owner"), "SET ROLE bms_owner not found").toBeGreaterThanOrEqual(0);
    expect(sql).toContain("RESET ROLE");
  });

  // S4 — `when`s are read from the file, neither is a literal here.
  it("journal carries idx 75, tag equal to the file stem", () => {
    expect(
      entry75,
      "0075 has no journal entry — drizzle silently skips a migration with no journal row.",
    ).toBeDefined();
    expect(entry75?.tag).toBe(MIGRATION_TAG);
    expect(migrationFile).toBe(`${MIGRATION_TAG}.sql`);
  });

  // S5
  it("journal when of idx 75 is strictly after idx 74's and not ahead of the clock", () => {
    expect(entry74, "0074's journal entry is the baseline this test orders against").toBeDefined();
    expect(
      entry75?.when ?? 0,
      "F4.94: journal when must be strictly greater than 0074's, or drizzle applies nothing.",
    ).toBeGreaterThan(entry74?.when ?? Number.POSITIVE_INFINITY);
    expect(
      entry75?.when ?? 0,
      "F4.94: a journal `when` ahead of the clock is repaired by hand, never deleted.",
    ).toBeLessThanOrEqual(Date.now());
  });

  // S6
  it("bms-schema.ts declares varchar(\"timezone\", { length: 64 }) inside the locations table", () => {
    const block = locationsTableBlock(read("packages/db/src/schema/bms-schema.ts"));
    expect(block).toContain('varchar("timezone", { length: 64 })');
    // Positive control for the slice: a column locations does NOT have counts 0 here.
    expect(block).not.toContain('varchar("site_name"');
  });

  // S7 — Q12 ruling: the Eskom demo is SAST.
  it("eskom-locations-seed.ts sets timezone: \"Africa/Johannesburg\"", () => {
    expect(read("packages/db/src/eskom-locations-seed.ts")).toContain(
      'timezone: "Africa/Johannesburg"',
    );
  });

  // S8 — Q12 ruling: the PHE pilot site is in India (IST), against the plan's recommendation.
  it("phe-pilot-seed.ts sets timezone: \"Asia/Kolkata\"", () => {
    expect(read("packages/db/src/phe-pilot-seed.ts")).toContain('timezone: "Asia/Kolkata"');
  });
});

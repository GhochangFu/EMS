import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

/**
 * `F4.57` / ADR 0061 decision 1 — `telemetry.point_values` gains a nullable
 * `device_time timestamptz` in migration `0069`. No default, no backfill, no
 * index, no `refresh_continuous_aggregate` (Amendment 1 item 3). The primary
 * key is unchanged. Model: `tests/adr-0056-point-metadata-migration.test.ts`.
 *
 * **Assertions inline, no `.spec` sibling** — the top-level `tests/` carve-out
 * (§4.6).
 */
const MIGRATION_REL = "packages/db/drizzle/0069_point_values_device_time.sql";
const JOURNAL_REL = "packages/db/drizzle/meta/_journal.json";
const SCHEMA_REL = "packages/db/src/schema/telemetry-schema.ts";

/**
 * Comments stripped before every assertion. The `f3.1a` lesson: a header
 * quoting DDL in a comment kept a `toContain` green after the statement
 * itself was deleted.
 */
const sqlOnly = (source: string): string =>
  source
    // Block comments first: a `/* … */` spanning lines survives a line filter,
    // and a `DEFAULT` inside one would trip the forbidden-pattern scan below.
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    // `--` anywhere on the line, not only at its start: a trailing comment on a
    // real statement is the case a `startsWith` filter keeps.
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");

/**
 * The `ADD COLUMN` clause alone, so the forbidden-pattern scan below judges the
 * column definition rather than the whole file.
 *
 * Scanning the file made the gate wrong in both directions. `SET LOCAL
 * lock_timeout = DEFAULT` — the idiom `0028` uses on this very table — would
 * have failed it with "must not contain DEFAULT", and a `RESET`/`SET` line has
 * nothing to do with what decision 1 forbids *on the column*. Found by the
 * migration review, which was blocked by this gate while fixing a real defect.
 */
const addColumnClause = (source: string): string =>
  /ADD COLUMN[\s\S]*?;/.exec(source)?.[0] ?? "";

describe("F4.57 — migration 0069 exists", () => {
  it("0069_point_values_device_time.sql is present in packages/db/drizzle", () => {
    expect(() => read(MIGRATION_REL)).not.toThrow();
  });
});

describe("F4.57 point_values.device_time (ADR 0061 decision 1)", () => {
  const sql = sqlOnly(read(MIGRATION_REL));

  it("adds the column idempotently", () => {
    expect(
      /ALTER TABLE telemetry\.point_values\s+ADD COLUMN IF NOT EXISTS device_time timestamptz/.test(sql),
      "migration 0069 must ALTER TABLE telemetry.point_values ADD COLUMN IF NOT EXISTS device_time timestamptz.",
    ).toBe(true);
  });

  it("adds nothing decision 1 forbids to the column definition", () => {
    const clause = addColumnClause(sql);
    expect(clause, "the ADD COLUMN clause must be findable for this gate to mean anything").not.toBe(
      "",
    );

    const forbidden: ReadonlyArray<{ pattern: RegExp; label: string }> = [
      { pattern: /\bDEFAULT\b/i, label: "DEFAULT" },
      { pattern: /\bNOT NULL\b/i, label: "NOT NULL" },
    ];

    for (const { pattern, label } of forbidden) {
      expect(
        pattern.test(clause),
        `migration 0069's ADD COLUMN clause must not contain ${label} (ADR 0061 decision 1).`,
      ).toBe(false);
    }
  });

  it("rewrites no data and builds no index anywhere in the file", () => {
    // These three are file-wide on purpose, unlike DEFAULT and NOT NULL above:
    // decision 1 forbids a backfill, an index and a manual refresh ANYWHERE in
    // `0069`, not merely inside the column definition.
    const forbidden: ReadonlyArray<{ pattern: RegExp; label: string }> = [
      { pattern: /\bUPDATE\b/i, label: "UPDATE" },
      { pattern: /CREATE\s+INDEX/i, label: "CREATE INDEX" },
      { pattern: /refresh_continuous_aggregate/i, label: "refresh_continuous_aggregate" },
    ];

    for (const { pattern, label } of forbidden) {
      expect(pattern.test(sql), `migration 0069 must not contain ${label} (ADR 0061 decision 1).`).toBe(false);
    }
  });

  it("bounds its lock acquisition, as 0028 and 0031 do on this table", () => {
    // `ADD COLUMN` takes ACCESS EXCLUSIVE on the parent and every chunk. The
    // work is catalog-only; the hazard is the WAIT, which blocks every request
    // queued behind it on a table under continuous ingest. `0028:111` and
    // `0031:128` both bound it here and both RESET afterwards, so `0069`
    // inherits nothing. Raised by the migration review.
    expect(
      /SET\s+LOCAL\s+lock_timeout\s*=\s*'5s'/i.test(sql),
      "migration 0069 must bound its lock acquisition with SET LOCAL lock_timeout = '5s'.",
    ).toBe(true);
    expect(
      /RESET\s+lock_timeout/i.test(sql),
      "migration 0069 must RESET lock_timeout so the bound does not leak to a later statement.",
    ).toBe(true);
  });

  it("journals migration 0069 with idx 69, a tag equalling the filename stem, and a when strictly greater than 0068's", () => {
    const journal = JSON.parse(read(JOURNAL_REL)) as {
      entries: ReadonlyArray<{ idx: number; when: number; tag: string }>;
    };

    const entry68 = journal.entries.find((e) => e.idx === 68);
    expect(entry68, "journal entry idx 68 (0068_notification_deliveries_stale_status) not found").toBeDefined();

    const stem = MIGRATION_REL.split("/").pop()!.replace(/\.sql$/, "");
    const entry69 = journal.entries.find((e) => e.tag === stem);
    expect(
      entry69,
      `no journal entry with tag "${stem}". Drizzle matches migrations to journal entries ` +
        "by tag; an unjournalled .sql file is silently skipped.",
    ).toBeDefined();

    expect(entry69?.idx, "journal entry for 0069 must have idx === 69").toBe(69);

    expect(
      entry69?.when,
      "migration 0069's journal when must be strictly greater than 0068's — read both " +
        "from the file, never a literal copy, so a later regeneration mistake is caught.",
    ).toBeGreaterThan(entry68!.when);
  });

  it("drizzle declares device_time as nullable timestamptz", () => {
    const schemaSource = read(SCHEMA_REL);
    const line = schemaSource
      .split("\n")
      .find((l) => l.includes('deviceTime: timestamp("device_time"') && l.includes("withTimezone: true"));

    expect(line, "telemetry-schema.ts must declare deviceTime: timestamp(\"device_time\", { withTimezone: true })").toBeDefined();
    expect(line?.includes(".notNull()"), "device_time must remain nullable — .notNull() must not appear on this line").toBe(false);
  });

  it("the primary key is unchanged", () => {
    const schemaSource = read(SCHEMA_REL);
    expect(
      schemaSource.includes("primaryKey({ columns: [t.time, t.assetId, t.pointKey] })"),
      "pointValues primary key must remain (time, assetId, pointKey) — decision 1 does not change it.",
    ).toBe(true);
  });
});

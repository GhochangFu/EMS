import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

/**
 * `E1.3` / ADR 0050 + Amendment 1 — the in-range counter relations.
 *
 * **Assertions inline, no `.spec` sibling.** §4.6 carves out the top-level
 * `tests/` directory for repo-wide invariants;
 * `tests/f3.37-asset-role-vocabulary.test.ts` is the model this file follows.
 *
 * **What is NOT tested here: that the counts are right.** Nothing in this file
 * runs SQL. It gates the *shape* nobody should quietly change back — the four
 * relations, the ownership bracket, the absent GRANT, and the header
 * obligations. Arithmetic belongs to the roll-up's own specs, and the §4.6
 * database check owns "does it actually apply".
 */
const MIGRATION_REL = "packages/db/drizzle/0052_health_in_range_counters.sql";
const SCHEMA_REL = "packages/db/src/schema/telemetry-schema.ts";
const JOURNAL_REL = "packages/db/drizzle/meta/_journal.json";
const INVARIANTS_REL = "tests/repo-invariants.test.ts";

const LEVELS = ["1m", "5m", "1h", "1d"] as const;

/**
 * Comments stripped. `f3.1a` learned this the hard way: `RESET ROLE;` in a
 * header *comment* kept a `toContain` green after the statement itself was
 * deleted. This migration's header quotes most of what is asserted below, so
 * every assertion about a statement reads this and never the raw text.
 */
const sqlOnly = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

/** One table's `CREATE TABLE …( … );` body, so a per-table assertion cannot be
 * satisfied by a neighbour's column. */
const tableBlock = (migration: string, table: string): string => {
  const start = migration.indexOf(`CREATE TABLE IF NOT EXISTS telemetry.${table} (`);
  if (start < 0) throw new Error(`no CREATE TABLE for telemetry.${table}`);
  const end = migration.indexOf("\n);", start);
  if (end < 0) throw new Error(`unterminated CREATE TABLE for telemetry.${table}`);
  return migration.slice(start, end + 3);
};

describe("E1.3 in-range counter relations (ADR 0050 Amendment 1)", () => {
  const migration = read(MIGRATION_REL);
  const sql = sqlOnly(migration);

  it("is registered in the drizzle journal", () => {
    // Without an entry drizzle silently skips the file: the tables never exist,
    // and the first symptom is the roll-up job failing in an environment nobody
    // is watching. `.claude/hooks/check-drizzle-journal.mjs` catches it on write;
    // this catches a later hand-edit that removes the entry.
    const journal = JSON.parse(read(JOURNAL_REL)) as {
      entries: { idx: number; tag: string }[];
    };
    expect(journal.entries).toContainEqual(
      expect.objectContaining({ idx: 52, tag: "0052_health_in_range_counters" }),
    );
  });

  it("creates four relations, one per ADR 0023 level", () => {
    // Amendment 1 decision 1. The alternative it rejected — one table with a
    // `level` column — would satisfy a naive "does a counter table exist"
    // assertion, which is why this counts to four by name.
    for (const level of LEVELS) {
      expect(sql, `missing telemetry.point_in_range_${level}`).toContain(
        `CREATE TABLE IF NOT EXISTS telemetry.point_in_range_${level} (`,
      );
    }
    expect(sql).not.toMatch(/\blevel\s+(varchar|text)/i);
  });

  it("brackets the DDL in SET ROLE bms_owner and writes no GRANT", () => {
    // The load-bearing pair, and the second half is the one that rots.
    //
    // `0041` lines 112-119 set ALTER DEFAULT PRIVILEGES FOR ROLE bms_owner in
    // both `bms` and `telemetry`; those fire only for objects created by that
    // role, and `db:migrate` connects as `bms_app`. Without the bracket the
    // tables are owned by `bms_app`, no grant reaches `bms_tenant`, and the
    // roll-up job fails at runtime inside a background loop.
    //
    // A hand-written GRANT would make that failure invisible — the tables would
    // work while the bracket was broken — which is why `0050` and `0051` both
    // forbid one in their headers and why the negative is asserted here.
    expect(sql).toContain("SET ROLE bms_owner;");
    expect(sql).toContain("RESET ROLE;");
    expect(sql.indexOf("SET ROLE bms_owner;")).toBeLessThan(
      sql.indexOf("CREATE TABLE IF NOT EXISTS telemetry.point_in_range_1m ("),
    );
    expect(sql.lastIndexOf("RESET ROLE;")).toBeGreaterThan(
      sql.lastIndexOf("CREATE INDEX IF NOT EXISTS point_in_range_1d_asset_bucket_idx"),
    );
    expect(sql, "a GRANT here hides a broken SET ROLE bracket").not.toMatch(/\bGRANT\b/);
  });

  it("adds no organization_id, no RLS and no policy", () => {
    // ADR 0043 puts row-level security on `bms.*`; `telemetry.*` has none, and
    // these four must not become the only exception. The tenant containment
    // ADR 0050 decision 8 requires is on the rules side — `bms.automation_rules`
    // is org-bearing and forced — not here.
    expect(sql).not.toMatch(/organization_id/);
    expect(sql).not.toMatch(/ROW LEVEL SECURITY/i);
    expect(sql).not.toMatch(/CREATE POLICY/i);
  });

  it("constrains the counts and the rule tally on every level", () => {
    // Both directions of the same rule. `sample_count > 0` with `in_range_count`
    // inside `[0, sample_count]` is what stops a ratio above 1.0; the rule tally
    // is what stops a row that means nothing at all.
    //
    // `rule_count = 0` with `skipped_rule_count > 0` stays LEGAL on purpose —
    // Amendment 1 decision 7's all-rules-skipped state, which the read counts as
    // unscored rather than as a perfect score.
    for (const level of LEVELS) {
      const block = tableBlock(migration, `point_in_range_${level}`);
      expect(block).toContain(`CONSTRAINT point_in_range_${level}_counts_check`);
      expect(block).toContain("in_range_count BETWEEN 0 AND sample_count");
      expect(block).toContain(`CONSTRAINT point_in_range_${level}_rules_check`);
      expect(block).toContain("rule_count + skipped_rule_count > 0");
    }
  });

  it("records the deletion obligation for all four relations, finest first", () => {
    // ADR 0050 decision 9 as extended by Amendment 1 decision 8, and it is
    // asserted against the HEADER on purpose — the obligation is a note to a
    // human, so the comment is the artifact, not the SQL.
    //
    // The failure it prevents is silent: a deleted raw row leaves a stale
    // in-range count that reads as a correct score forever, and the job's
    // 24-hour trailing window never reaches back to repair it.
    expect(migration).toMatch(/DELETE FROM telemetry\.point_values/);
    expect(migration).toMatch(/FINEST FIRST/i);
    expect(migration).toMatch(/refresh_continuous_aggregate/);
    // Order, not mere presence: deriving a coarse level from a stale fine one
    // propagates the error upward, so a header listing 1d first would be wrong
    // while still naming all four.
    const obligation = migration.slice(
      migration.indexOf("A re-run of the health roll-up"),
      migration.indexOf("WHY FOUR TABLES"),
    );
    const order = LEVELS.map((level) => obligation.indexOf(`point_in_range_${level}`));
    expect(order.every((at) => at >= 0), "the header must name all four relations").toBe(true);
    expect(
      order.every((at, i) => i === 0 || at > order[i - 1]),
      `the header must name the re-run order 1m → 5m → 1h → 1d, found ${order.join(",")}`,
    ).toBe(true);
  });

  it("stays a plain table, and states the trigger for revisiting that", () => {
    // Amendment 1 decision 10. Unbounded growth is accepted WITH A NUMBER, so
    // that the acceptance can be checked rather than remembered — the current
    // fixtures have no tag carrying both telemetry and a published rule, which
    // is exactly the condition under which an unbounded table stays unnoticed.
    expect(sql).not.toMatch(/create_hypertable/i);
    expect(sql).not.toMatch(/add_retention_policy/i);
    expect(migration, "the 50M-row revisit trigger must stay in the header").toMatch(
      /50\s*\n?--?\s*MILLION ROWS|EXCEEDS 50/i,
    );
  });

  it("declares the four as tables in the drizzle schema, with numeric bigints", () => {
    // The aggregates above them are `.view().existing()` because migration 0027
    // owns them and `drizzle-kit generate` would otherwise emit colliding DDL.
    // These are real tables, so `.table()` is correct — and the distinction is
    // worth holding, because copying the neighbouring `.existing()` would make
    // every write typecheck against a read-only object.
    const schema = read(SCHEMA_REL);
    for (const level of LEVELS) {
      expect(schema).toContain(`telemetrySchema.table(\n  "point_in_range_${level}"`);
      expect(schema).toContain(`point_in_range_${level}_asset_bucket_idx`);
    }
    // `count`/`sum` are bigint in Postgres and arrive as strings without this —
    // the same trap ADR 0023's `sampleCount` docblock records.
    expect(schema).toContain('bigint("in_range_count", { mode: "number" })');
    expect(schema).toContain('bigint("sample_count", { mode: "number" })');
  });

  it("keeps the health roll-up out of the no-raw-bucketing invariant", () => {
    // `repo-invariants.test.ts` forbids `date_trunc` over raw telemetry in
    // `dashboard.service.ts` and `reports.service.ts`, because there a time
    // bucket over raw is a revert off the ADR 0023 aggregates.
    //
    // The health roll-up is the opposite case. ADR 0023's aggregates store
    // sum/count/min/max and no per-sample values, so the in-range predicate
    // cannot be evaluated against them at any level; reading raw at `1m` is what
    // ADR 0050 decision 4 REQUIRES. Adding a health file to that list would fail
    // CI for doing the thing the ADR specifies, and it is the kind of tidying a
    // future reader would think obviously correct.
    const invariants = read(INVARIANTS_REL);
    const list = invariants.slice(
      invariants.indexOf("const rollupFiles = ["),
      invariants.indexOf("];", invariants.indexOf("const rollupFiles = [")),
    );
    expect(list, "rollupFiles must not name a health file — see this test's comment").not.toMatch(
      /health/i,
    );
  });
});

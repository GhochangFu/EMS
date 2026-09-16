import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const drizzleDir = join(repoRoot, "packages", "db", "drizzle");
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

/**
 * `F3.2` / ADR 0067 decision 1 — migration `0073` gives `bms.dashboards` an
 * asset scope and an asset-template stamp.
 *
 * **Assertions inline, no `.spec` sibling.** §4.6 carves out the top-level
 * `tests/` directory for repo-wide invariants — `tests/f3.36-dashboard-templates-schema.test.ts`
 * is the direct model this file copies (`sqlOnly`, `policyBlock`, `countOf`).
 *
 * **What is NOT tested here.** DB-enforced behaviour (constraint refusals, the
 * RLS boundary, the cascade) is `tests/f3.2-asset-dashboards-schema.integration.test.ts`'s
 * job — a `CHECK` that is written but never applied looks identical to one that
 * is, from a text scan alone.
 */
const MIGRATION_PREFIX = "0073_";
const JOURNAL_REL = "packages/db/drizzle/meta/_journal.json";

/** Comments stripped, so a header quoting the body cannot satisfy an assertion
 * about a statement that was actually deleted (`f3.1a`'s lesson). */
const sqlOnly = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

/**
 * One `CREATE POLICY … ON bms.<table> …;` statement, so a count below cannot be
 * satisfied by a neighbouring table's policy. Ends at the next top-level
 * `ALTER TABLE` / `CREATE` / `DROP` / `RESET ROLE`, or at the end of the file.
 */
const policyBlock = (migration: string, table: string): string => {
  const start = migration.indexOf(`CREATE POLICY tenant_isolation ON bms.${table}`);
  if (start < 0) throw new Error(`no CREATE POLICY for bms.${table}`);
  const rest = migration.slice(start + 1);
  const next = rest.search(/\n(?:ALTER TABLE|CREATE |DROP |RESET ROLE)/);
  return next < 0 ? migration.slice(start) : migration.slice(start, start + 1 + next);
};

const countOf = (haystack: string, needle: string): number =>
  haystack.split(needle).length - 1;

const migrationFile = readdirSync(drizzleDir).find(
  (f) => f.startsWith(MIGRATION_PREFIX) && f.endsWith(".sql"),
);
const migration = migrationFile
  ? readFileSync(join(drizzleDir, migrationFile), "utf8")
  : null;

describe("F3.2 — migration 0073 exists", () => {
  it("0073_*.sql is present in packages/db/drizzle", () => {
    expect(
      migration,
      "0073_*.sql not found. Task 1 writes it before this suite goes green; 0051-0072 " +
        "are committed and frozen by the pre-commit hook, so the next number is 0073.",
    ).not.toBeNull();
  });
});

describe("F3.2 asset default dashboards (ADR 0067 decision 1)", () => {
  const sql = sqlOnly(migration ?? "");
  const journal = JSON.parse(read(JOURNAL_REL)) as {
    entries: Array<{ idx: number; tag: string; when: number }>;
  };
  const entry = journal.entries.find((e) => e.idx === 73);

  // S1
  it("journal carries idx 73 with a tag and a when strictly after 0072's", () => {
    expect(
      entry,
      "0073 has no journal entry — drizzle silently skips a migration with no journal row.",
    ).toBeDefined();
    expect(entry?.tag).toMatch(/^0073_/);
    expect(
      entry?.when,
      "F4.94: journal when must not run ahead of the clock, but it must be strictly " +
        "greater than 0072's 1789451212123.",
    ).toBeGreaterThan(1789451212123);
    // The other half of the sentence above, and it was missing: a `when` in the
    // future orders correctly against 0072 and still breaks `F4.94`'s rule.
    expect(
      entry?.when ?? 0,
      "F4.94: a journal `when` ahead of the clock is repaired by hand, never deleted.",
    ).toBeLessThanOrEqual(Date.now());
  });

  // S2
  it("asset_id references bms.assets with ON DELETE CASCADE", () => {
    expect(sql).toMatch(
      /asset_id\s+uuid\s+REFERENCES bms\.assets\(id\)\s+ON DELETE CASCADE/i,
    );
  });

  // S3
  it("asset_template_id references bms.asset_templates with no ON DELETE clause", () => {
    const match = sql.match(/asset_template_id\s+uuid\s+REFERENCES bms\.asset_templates\(id\)[^\n]*/i);
    expect(match, "asset_template_id column definition not found").not.toBeNull();
    expect(match?.[0]).not.toMatch(/ON DELETE/i);
  });

  // S4
  it("declares the three constraint names, and the scope check is a count form naming asset_id", () => {
    for (const name of [
      "dashboards_scope_check",
      "dashboards_template_stamp_check",
      "dashboards_asset_stamp_check",
    ]) {
      expect(sql, `constraint ${name} not found`).toContain(name);
    }

    const start = sql.indexOf("dashboards_scope_check");
    const end = sql.indexOf("END $$;", start);
    const block = sql.slice(start, end < 0 ? undefined : end);
    expect(block).toContain("asset_id IS NOT NULL");
    expect(block).toContain("<= 1");
  });

  // S5
  it("re-creates tenant_isolation with five legs, each present in both USING and WITH CHECK", () => {
    const policy = policyBlock(sql, "dashboards");
    expect(countOf(policy, "bms.assets a")).toBe(2);
    expect(countOf(policy, "bms.asset_templates at")).toBe(2);
    expect(countOf(policy, "bms.locations l")).toBe(2);
    expect(countOf(policy, "bms.asset_groups g")).toBe(2);
    expect(countOf(policy, "bms.dashboard_templates t")).toBe(2);
    expect(countOf(policy, "a.organization_id = nullif(")).toBe(2);
    expect(countOf(policy, "at.organization_id = nullif(")).toBe(2);
  });

  // S6
  it("brackets in SET ROLE bms_owner / RESET ROLE, and never CREATE INDEX CONCURRENTLY", () => {
    expect(sql).toContain("SET ROLE bms_owner");
    expect(sql).toContain("RESET ROLE");
    expect(sql).not.toContain("CREATE INDEX CONCURRENTLY");
  });
});

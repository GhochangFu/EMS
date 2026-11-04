import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

const MIGRATION_REL = "packages/db/drizzle/0123_calc_backfill_runs.sql";
const TAG = "0123_calc_backfill_runs";
const TABLE = "calc_backfill_runs";
const OWN_ORG = "organization_id = nullif(current_setting('app.current_organization', true), '')::uuid";

/** Strip `--` comment lines before a scan (the f3.67 lesson): a raw scan is
 * satisfied by a comment that quotes the statement it explains. */
const sqlOnly = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

/** The `CREATE POLICY tenant_isolation` statement for the table, split at WITH CHECK. */
const policyHalves = (migration: string): { policy: string; using: string; withCheck: string } => {
  const start = migration.indexOf(`CREATE POLICY tenant_isolation ON bms.${TABLE}\n`);
  if (start < 0) throw new Error(`no tenant_isolation policy for bms.${TABLE}`);
  const end = migration.indexOf(";\n", start);
  if (end < 0) throw new Error(`unterminated tenant_isolation policy for bms.${TABLE}`);
  const policy = migration.slice(start, end + 1);
  const split = policy.indexOf("WITH CHECK");
  if (split < 0) throw new Error("the policy carries no WITH CHECK clause");
  return { policy, using: policy.slice(0, split), withCheck: policy.slice(split) };
};

/**
 * `F4.311` / ADR 0109 decision 7 — the static half of migration `0123`
 * (`bms.calc_backfill_runs`). `tests/f4.311-calc-backfill-runs-schema.integration.test.ts`
 * asserts what Postgres enforces. Assertions inline (§4.6, top-level `tests/`).
 */
describe("F4.311 — bms.calc_backfill_runs (migration 0123)", () => {
  it("is not scanning an empty or misnamed file", () => {
    expect(existsSync(join(repoRoot, MIGRATION_REL)), `${MIGRATION_REL} must exist`).toBe(true);
    const migration = sqlOnly(read(MIGRATION_REL));
    expect(migration.length).toBeGreaterThan(1000);
    // Anti-vacuity: more than 8 statements.
    expect(migration.split(";").filter((s) => s.trim().length > 0).length).toBeGreaterThan(8);
  });

  it("registers migration 0123 in the journal, after 0122 and before now", () => {
    const journal = JSON.parse(read("packages/db/drizzle/meta/_journal.json")) as {
      entries: Array<Record<string, unknown>>;
    };
    const entry = journal.entries.find((e) => e.tag === TAG);

    expect(entry, "migration 0123 must have a journal entry, or drizzle never runs it").toBeDefined();
    expect(entry?.idx).toBe(124);
    expect(entry?.version).toBe("7");
    expect(entry?.breakpoints).toBe(true);
    // 0122's `when` — the F4.94 class.
    expect(entry?.when as number).toBeGreaterThan(1793640000000);
    expect(entry?.when as number).toBeLessThan(Date.now());
  });

  it("brackets the migration in SET ROLE bms_owner / RESET ROLE and issues no GRANT", () => {
    const migration = sqlOnly(read(MIGRATION_REL));
    expect(migration).toContain("SET ROLE bms_owner;");
    expect(migration).toContain("RESET ROLE;");
    expect(migration).not.toMatch(/\bGRANT\b/i);
  });

  it("creates the table and enables and forces row level security", () => {
    const migration = sqlOnly(read(MIGRATION_REL));
    expect(migration).toContain(`CREATE TABLE IF NOT EXISTS bms.${TABLE}`);
    expect(migration).toContain(`ALTER TABLE bms.${TABLE} ENABLE ROW LEVEL SECURITY;`);
    expect(migration).toContain(`ALTER TABLE bms.${TABLE} FORCE ROW LEVEL SECURITY;`);
  });

  it("drops then creates the tenant_isolation policy", () => {
    const migration = sqlOnly(read(MIGRATION_REL));
    const drop = migration.indexOf(`DROP POLICY IF EXISTS tenant_isolation ON bms.${TABLE};`);
    const create = migration.indexOf(`CREATE POLICY tenant_isolation ON bms.${TABLE}\n`);
    expect(drop).toBeGreaterThanOrEqual(0);
    expect(create).toBeGreaterThan(drop);
  });

  it("the policy checks the own organization_id in USING and WITH CHECK, with no NULL disjunct", () => {
    const { policy, using, withCheck } = policyHalves(sqlOnly(read(MIGRATION_REL)));
    expect(using, "USING must check the own organization_id").toContain(OWN_ORG);
    expect(withCheck, "WITH CHECK must check the own organization_id").toContain(OWN_ORG);
    expect(policy).not.toMatch(/organization_id\s+IS\s+NULL/i);
  });

  it("the policy checks the parent asset_points row's organization in USING and WITH CHECK", () => {
    const { using, withCheck } = policyHalves(sqlOnly(read(MIGRATION_REL)));
    for (const [half, text] of [["USING", using], ["WITH CHECK", withCheck]] as const) {
      expect(text, `${half} must read the parent asset_points row`).toContain(
        "EXISTS (SELECT 1 FROM bms.asset_points p",
      );
      expect(text, `${half} must join the parent on the run's asset_point_id`).toContain(
        "WHERE p.id = calc_backfill_runs.asset_point_id",
      );
      expect(text, `${half} must check the parent point's organization (0050 shape)`).toContain(`p.${OWN_ORG}`);
    }
  });

  it("one active run per point is a partial unique index over queued and running", () => {
    const migration = sqlOnly(read(MIGRATION_REL));
    expect(migration).toContain(
      `CREATE UNIQUE INDEX IF NOT EXISTS calc_backfill_runs_one_active\n  ON bms.${TABLE}(asset_point_id) WHERE status IN ('queued','running');`,
    );
  });

  it("asset_point_id cascades on delete; organization_id and requested_by do not", () => {
    const migration = sqlOnly(read(MIGRATION_REL));
    expect(migration).toContain("asset_point_id uuid NOT NULL REFERENCES bms.asset_points(id) ON DELETE CASCADE");
    expect(migration).toContain("organization_id uuid NOT NULL REFERENCES bms.organizations(id),");
    expect(migration).toContain("requested_by uuid REFERENCES bms.users(id),");
  });

  it("closes the status vocabulary, the 31-day window and written_rows with CHECKs", () => {
    const migration = sqlOnly(read(MIGRATION_REL));
    expect(migration).toContain("CHECK (status IN ('queued','running','done','failed'))");
    expect(migration).toContain("CHECK (from_at < to_at AND to_at - from_at <= interval '31 days')");
    expect(migration).toContain("CHECK (written_rows >= 0)");
  });

  it("proves the partial index and forced RLS in a DO block", () => {
    const migration = sqlOnly(read(MIGRATION_REL));
    expect(migration).toContain("DO $$");
    expect(migration).toContain("i.indpred IS NOT NULL");
    expect(migration).toContain("c.relforcerowsecurity");
  });

  it("declares the Drizzle table and exports it", () => {
    expect(read("packages/db/src/schema/index.ts")).toContain('export * from "./calc-backfill-schema";');
    expect(read("packages/db/src/schema/calc-backfill-schema.ts")).toContain(`bmsSchema.table("${TABLE}"`);
  });
});

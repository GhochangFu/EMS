import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const drizzleDir = join(repoRoot, "packages", "db", "drizzle");
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

/**
 * `E4.1a` / ADR 0070 decision 2 — migration `0074` creates the calc parameter
 * vocabulary (`bms.calc_parameter_keys`, global) and the parameter store
 * (`bms.calc_parameters`, tenant, effective-dated, nearest scope wins).
 *
 * **Assertions inline, no `.spec` sibling.** §4.6 carves out the top-level
 * `tests/` directory for repo-wide invariants — `tests/f3.2-asset-dashboards-schema.test.ts`
 * is the direct model this file copies (`sqlOnly`, `policyBlock`, `countOf`).
 *
 * **What is NOT tested here.** DB-enforced behaviour (the constraint refusals,
 * the exclusion constraint, the RLS boundary as `bms_tenant`) is
 * `tests/e4.1a-calc-parameters-schema.integration.test.ts`'s job — a `CHECK`
 * that is written but never applied looks identical to one that is, from a
 * text scan alone.
 */
const MIGRATION_PREFIX = "0074_";
const MIGRATION_TAG = "0074_calc_parameters";
const JOURNAL_REL = "packages/db/drizzle/meta/_journal.json";

/** The twelve stock keys of ADR 0070 decision 2, fixed at the E4.1a plan gate (Q3). */
const STOCK_KEYS = [
  "energy_tariff_per_kwh",
  "water_tariff_per_kl",
  "effluent_tariff_per_kl",
  "grid_carbon_factor_kgco2_per_kwh",
  "energy_baseline_kwh_per_day",
  "water_baseline_kl_per_day",
  "chemical_baseline_kg_per_day",
  "rated_kw",
  "installed_kwp",
  "contract_demand_kva",
  "tank_capacity_l",
  "tariff_pf_band",
] as const;

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

/** One `CREATE TABLE IF NOT EXISTS bms.<table> (…);` statement, up to its closing `);`. */
const tableBlock = (migration: string, table: string): string => {
  const start = migration.indexOf(`CREATE TABLE IF NOT EXISTS bms.${table} (`);
  if (start < 0) throw new Error(`no CREATE TABLE for bms.${table}`);
  const end = migration.indexOf("\n);", start);
  return end < 0 ? migration.slice(start) : migration.slice(start, end + 3);
};

/** The `INSERT INTO bms.<table> … ;` statement, so a key named in a comment or a
 * policy cannot satisfy the seed count. */
const insertBlock = (migration: string, table: string): string => {
  const start = migration.indexOf(`INSERT INTO bms.${table}`);
  if (start < 0) throw new Error(`no INSERT INTO bms.${table}`);
  const end = migration.indexOf(";", start);
  return end < 0 ? migration.slice(start) : migration.slice(start, end + 1);
};

const countOf = (haystack: string, needle: string): number =>
  haystack.split(needle).length - 1;

const migrationFile = readdirSync(drizzleDir).find(
  (f) => f.startsWith(MIGRATION_PREFIX) && f.endsWith(".sql"),
);
const migration = migrationFile
  ? readFileSync(join(drizzleDir, migrationFile), "utf8")
  : null;

describe("E4.1a — migration 0074 exists", () => {
  it("0074_*.sql is present in packages/db/drizzle", () => {
    expect(
      migration,
      "0074_*.sql not found. U4 writes it before this suite goes green; 0051-0073 " +
        "are committed and frozen by the pre-commit hook, so the next number is 0074.",
    ).not.toBeNull();
  });
});

describe("E4.1a calc parameters (ADR 0070 decision 2)", () => {
  const sql = sqlOnly(migration ?? "");
  const journal = JSON.parse(read(JOURNAL_REL)) as {
    entries: Array<{ idx: number; tag: string; when: number }>;
  };
  const entry73 = journal.entries.find((e) => e.idx === 73);
  const entry74 = journal.entries.find((e) => e.idx === 74);

  // S1 — both `when`s are read from the file, neither is a literal here.
  it("journal carries idx 74, tag equal to the file stem, when strictly after 0073's", () => {
    expect(
      entry74,
      "0074 has no journal entry — drizzle silently skips a migration with no journal row.",
    ).toBeDefined();
    expect(entry73, "0073's journal entry is the baseline this test orders against").toBeDefined();
    expect(entry74?.tag).toBe(MIGRATION_TAG);
    expect(migrationFile).toBe(`${MIGRATION_TAG}.sql`);
    expect(
      entry74?.when ?? 0,
      "F4.94: journal when must be strictly greater than 0073's, or drizzle applies nothing.",
    ).toBeGreaterThan(entry73?.when ?? Number.POSITIVE_INFINITY);
    expect(
      entry74?.when ?? 0,
      "F4.94: a journal `when` ahead of the clock is repaired by hand, never deleted.",
    ).toBeLessThanOrEqual(Date.now());
  });

  // S2
  it("creates btree_gist BEFORE SET ROLE bms_owner, and brackets in SET ROLE / RESET ROLE", () => {
    const ext = sql.indexOf("CREATE EXTENSION IF NOT EXISTS btree_gist");
    const setRole = sql.indexOf("SET ROLE bms_owner");
    expect(ext, "CREATE EXTENSION IF NOT EXISTS btree_gist not found").toBeGreaterThanOrEqual(0);
    expect(setRole, "SET ROLE bms_owner not found").toBeGreaterThanOrEqual(0);
    expect(
      ext,
      "CREATE EXTENSION must run as the connecting superuser, i.e. before SET ROLE bms_owner",
    ).toBeLessThan(setRole);
    expect(sql).toContain("RESET ROLE");
    expect(sql).not.toContain("CREATE INDEX CONCURRENTLY");
  });

  // S3
  it("creates bms.calc_parameter_keys as a GLOBAL table — no organization_id, no RLS, no policy", () => {
    const block = tableBlock(sql, "calc_parameter_keys");
    expect(block).toContain("code varchar(64) PRIMARY KEY");
    expect(block).toContain("calc_parameter_keys_code_charset_check");
    expect(block).toContain("'^[a-z][a-z0-9_]{0,63}$'");
    expect(block, "the vocabulary is global (ADR 0070 decision 2)").not.toContain("organization_id");
    expect(sql).not.toMatch(/ALTER TABLE\s+bms\.calc_parameter_keys\s+(ENABLE|FORCE) ROW LEVEL SECURITY/i);
    expect(/CREATE POLICY[\s\S]{0,200}calc_parameter_keys/i.test(sql)).toBe(false);
  });

  // S4
  it("seeds the twelve stock keys, each exactly once, ON CONFLICT DO NOTHING with a bare arbiter", () => {
    const insert = insertBlock(sql, "calc_parameter_keys");
    for (const key of STOCK_KEYS) {
      expect(countOf(insert, `'${key}'`), `stock key ${key}`).toBe(1);
    }
    expect(countOf(insert, "\n  ('"), "exactly twelve VALUES rows").toBe(STOCK_KEYS.length);
    expect(insert).toMatch(/ON CONFLICT DO NOTHING;$/);
    // Positive control for the "exactly once" gate: a key absent from the seed counts 0.
    expect(countOf(insert, "'not_a_stock_key'")).toBe(0);
  });

  // S5
  it("creates bms.calc_parameters with the four named constraints and the gist exclusion", () => {
    const block = tableBlock(sql, "calc_parameters");
    expect(block).toContain("organization_id uuid NOT NULL REFERENCES bms.organizations(id)");
    expect(block).toContain("key varchar(64) NOT NULL REFERENCES bms.calc_parameter_keys(code)");
    expect(block).toMatch(/location_id uuid REFERENCES bms\.locations\(id\) ON DELETE CASCADE/);
    expect(block).toMatch(/asset_id uuid REFERENCES bms\.assets\(id\) ON DELETE CASCADE/);
    expect(block).toContain("value double precision NOT NULL");
    expect(block).toContain("effective_from timestamptz NOT NULL");
    for (const name of [
      "calc_parameters_scope_check",
      "calc_parameters_validity_check",
      "calc_parameters_value_finite_check",
      "calc_parameters_no_overlap",
    ]) {
      expect(block, `constraint ${name} not found`).toContain(`CONSTRAINT ${name}`);
    }
    expect(block).toContain("((location_id IS NOT NULL)::int + (asset_id IS NOT NULL)::int) <= 1");
    expect(block).toContain("effective_to IS NULL OR effective_to > effective_from");
    // 0031's form, not `value = value`: in Postgres NaN = NaN is TRUE, so the
    // equality form is a no-op (0031_*.sql lines 21-25 record the measurement).
    expect(block).toContain("value > '-Infinity'::float8 AND value < 'Infinity'::float8");
    expect(block).toContain("EXCLUDE USING gist");
    expect(block).toContain("tstzrange(effective_from, effective_to, '[)') WITH &&");
    expect(countOf(block, "'00000000-0000-0000-0000-000000000000'::uuid")).toBe(2);
  });

  // S6
  it("declares the three indexes", () => {
    expect(sql).toContain(
      "CREATE INDEX IF NOT EXISTS calc_parameters_org_key_idx ON bms.calc_parameters (organization_id, key)",
    );
    expect(sql).toContain(
      "CREATE INDEX IF NOT EXISTS calc_parameters_location_idx ON bms.calc_parameters (location_id)",
    );
    expect(sql).toContain(
      "CREATE INDEX IF NOT EXISTS calc_parameters_asset_idx ON bms.calc_parameters (asset_id)",
    );
  });

  // S7
  it("ENABLEs and FORCEs row level security on bms.calc_parameters only", () => {
    expect(sql).toMatch(/ALTER TABLE\s+bms\.calc_parameters\s+ENABLE ROW LEVEL SECURITY/i);
    expect(sql).toMatch(/ALTER TABLE\s+bms\.calc_parameters\s+FORCE ROW LEVEL SECURITY/i);
    // One FORCE in the file, so the assertion above cannot be satisfied by a
    // FORCE on the keys table that a lax regex would also match.
    expect(countOf(sql, "FORCE ROW LEVEL SECURITY")).toBe(1);
  });

  // S8
  it("re-creates tenant_isolation with the organization leg and both parent legs in USING and WITH CHECK", () => {
    expect(sql).toContain("DROP POLICY IF EXISTS tenant_isolation ON bms.calc_parameters");
    const policy = policyBlock(sql, "calc_parameters");
    expect(countOf(policy, "USING (")).toBe(1);
    expect(countOf(policy, "WITH CHECK (")).toBe(1);
    // The own-column leg, anchored to the line start so the `l.` / `a.` legs
    // below cannot satisfy it — one in USING, one in WITH CHECK.
    expect(
      policy.match(
        /^\s*organization_id = nullif\(current_setting\('app\.current_organization', true\), ''\)::uuid$/gm,
      )?.length,
    ).toBe(2);
    expect(countOf(policy, "location_id IS NULL OR EXISTS")).toBe(2);
    expect(countOf(policy, "asset_id IS NULL OR EXISTS")).toBe(2);
    expect(countOf(policy, "bms.locations l")).toBe(2);
    expect(countOf(policy, "bms.assets a")).toBe(2);
    expect(countOf(policy, "l.organization_id = nullif(")).toBe(2);
    expect(countOf(policy, "a.organization_id = nullif(")).toBe(2);
    // Positive control: a leg 0073 has and this table does not must count 0 here.
    expect(countOf(policy, "asset_group_id IS NULL OR EXISTS")).toBe(0);
  });

  // S9
  it("schema/index.ts exports the calc-parameters-schema module", () => {
    const index = read("packages/db/src/schema/index.ts");
    expect(index).toContain('export * from "./calc-parameters-schema";');
    const schema = read("packages/db/src/schema/calc-parameters-schema.ts");
    expect(countOf(schema, "bmsSchema.table(")).toBe(2);
    expect(schema).toContain('"calc_parameter_keys"');
    expect(schema).toContain('"calc_parameters"');
    expect(schema, "the schema names its pinning test").toContain(
      "tests/e4.1a-calc-parameters-schema.test.ts",
    );
  });
});

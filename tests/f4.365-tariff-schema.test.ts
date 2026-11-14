import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const drizzleDir = join(repoRoot, "packages", "db", "drizzle");
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

/**
 * `F4.365` / ADR 0134 — migrations `0154` (the global tariff catalog) and
 * `0155` (organization versions and location mappings). Assertions inline, the
 * `tests/e4.1a-calc-parameters-schema.test.ts` model. What Postgres enforces is
 * `tests/f4.365-tariff-schema.integration.test.ts`'s job.
 */
const JOURNAL_REL = "packages/db/drizzle/meta/_journal.json";

const sqlOnly = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

const policyBlock = (migration: string, table: string): string => {
  const start = migration.indexOf(`CREATE POLICY tenant_isolation ON bms.${table}`);
  if (start < 0) throw new Error(`no CREATE POLICY for bms.${table}`);
  const rest = migration.slice(start + 1);
  const next = rest.search(/\n(?:ALTER TABLE|CREATE |DROP |RESET ROLE)/);
  return next < 0 ? migration.slice(start) : migration.slice(start, start + 1 + next);
};

const countOf = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

const migration = (prefix: string): string => {
  const file = readdirSync(drizzleDir).find((f) => f.startsWith(prefix) && f.endsWith(".sql"));
  if (!file) throw new Error(`no migration ${prefix}*.sql`);
  return sqlOnly(readFileSync(join(drizzleDir, file), "utf8"));
};

type JournalEntry = { idx: number; when: number; tag: string };
const journal = (): JournalEntry[] => (JSON.parse(read(JOURNAL_REL)) as { entries: JournalEntry[] }).entries;

describe("F4.365 — tariff migrations (static)", () => {
  const a = migration("0154_tariff_catalog");
  const b = migration("0155_location_tariffs");

  it("both are journaled after 0153 (F4.364), strictly increasing, never ahead of the clock", () => {
    const entries = journal();
    const at = (tag: string) => entries.find((e) => e.tag === tag);
    const prev = at("0153_organization_energy_features");
    const ea = at("0154_tariff_catalog");
    const eb = at("0155_location_tariffs");
    expect(prev && ea && eb).toBeTruthy();
    expect(ea!.idx).toBe(prev!.idx + 1);
    expect(eb!.idx).toBe(ea!.idx + 1);
    expect(ea!.when).toBeGreaterThan(prev!.when);
    expect(eb!.when).toBeGreaterThan(ea!.when);
    expect(eb!.when).toBeLessThanOrEqual(Date.now() + 3_600_000);
  });

  it("each is bracketed by SET ROLE bms_owner … RESET ROLE and writes no GRANT and no row", () => {
    for (const m of [a, b]) {
      expect(m).toContain("SET ROLE bms_owner;");
      expect(m).toContain("RESET ROLE;");
      expect(m.indexOf("SET ROLE bms_owner;")).toBeLessThan(m.indexOf("RESET ROLE;"));
      expect(m).not.toMatch(/\bGRANT\b/);
      expect(m).not.toMatch(/INSERT INTO/);
      expect(m).not.toMatch(/CREATE EXTENSION|CONCURRENTLY/);
    }
  });

  it("0154 names every catalog constraint", () => {
    for (const name of [
      "tariff_categories_key_effective_from_key",
      "tariff_categories_energy_unit_check",
      "tariff_categories_fixed_basis_check",
      "tariff_categories_data_status_check",
      "tariff_categories_effective_from_month_start_check",
      "tariff_categories_key_not_custom_check",
      "tariff_categories_key_trim_check",
      "tariff_categories_source_url_check",
      "tariff_slabs_slab_no_check",
      "tariff_slabs_bounds_check",
      "tariff_slabs_rates_check",
    ]) {
      expect(a, name).toContain(`CONSTRAINT ${name}`);
    }
  });

  it("0154 keeps the catalog global and read-only for bms_tenant, with the 0085 proof", () => {
    expect(a).not.toContain("organization_id");
    expect(a).not.toContain("ROW LEVEL SECURITY");
    expect(a).not.toContain("CREATE POLICY");
    expect(a).toContain("REVOKE INSERT, UPDATE, DELETE ON bms.tariff_categories FROM bms_tenant;");
    expect(a).toContain("REVOKE INSERT, UPDATE, DELETE ON bms.tariff_slabs FROM bms_tenant;");
    const proof = a.slice(a.indexOf("RESET ROLE;"));
    expect(proof).toContain("has_table_privilege('bms_tenant', t, 'INSERT')");
    expect(proof).toContain("has_table_privilege('bms_fleet', t, 'SELECT')");
  });

  it("0155 forces RLS on its three tenant tables with one policy each", () => {
    for (const t of ["org_tariff_categories", "org_tariff_slabs", "location_tariffs"]) {
      expect(b, t).toContain(`ALTER TABLE bms.${t} ENABLE ROW LEVEL SECURITY;`);
      expect(b, t).toContain(`ALTER TABLE bms.${t} FORCE ROW LEVEL SECURITY;`);
      expect(countOf(b, `CREATE POLICY tenant_isolation ON bms.${t}`), t).toBe(1);
      const block = policyBlock(b, t);
      expect(countOf(block, "organization_id = nullif(current_setting('app.current_organization', true), '')::uuid")).toBeGreaterThanOrEqual(2);
      expect(block).toContain("WITH CHECK");
    }
  });

  it("location_tariffs' policy checks the location AND the billing-meter asset, in USING and WITH CHECK", () => {
    const block = policyBlock(b, "location_tariffs");
    const [using, check] = block.split("WITH CHECK");
    for (const half of [using, check]) {
      expect(half).toContain("l.id = location_tariffs.location_id");
      expect(half).toContain("a.id = location_tariffs.billing_meter_asset_id");
    }
  });

  it("0155 names its constraints, the composite slab FK and the gist exclusion", () => {
    for (const name of [
      "org_tariff_categories_org_key_effective_from_key",
      "org_tariff_categories_id_org_key",
      "org_tariff_categories_effective_from_month_start_check",
      "org_tariff_categories_reason_check",
      "org_tariff_slabs_category_fk",
      "location_tariffs_validity_check",
      "location_tariffs_month_start_check",
      "location_tariffs_sanctioned_load_unit_check",
      "location_tariffs_no_overlap",
    ]) {
      expect(b, name).toContain(`CONSTRAINT ${name}`);
    }
    expect(b).toContain("FOREIGN KEY (category_id, organization_id)");
    expect(b).toContain("daterange(effective_from, effective_to, '[)') WITH &&");
  });
});

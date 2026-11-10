import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

const MIGRATION_REL = "packages/db/drizzle/0140_work_order_reference_sla.sql";
const TAG = "0140_work_order_reference_sla";
const OWN_ORG = "organization_id = nullif(current_setting('app.current_organization', true), '')::uuid";
const NEW_TABLES = ["work_order_counters", "work_order_sla_policies"] as const;

/** Strip `--` comment lines before a scan (the f3.67 lesson): a raw scan is
 * satisfied by a comment that quotes the statement it explains. */
const sqlOnly = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

const migrationSql = (): string => sqlOnly(read(MIGRATION_REL));

/** The `CREATE POLICY tenant_isolation` statement for a table, split at WITH CHECK. */
const policyHalves = (migration: string, table: string): { policy: string; using: string; withCheck: string } => {
  const start = migration.indexOf(`CREATE POLICY tenant_isolation ON bms.${table}\n`);
  if (start < 0) throw new Error(`no tenant_isolation policy for bms.${table}`);
  const end = migration.indexOf(";\n", start);
  if (end < 0) throw new Error(`unterminated tenant_isolation policy for bms.${table}`);
  const policy = migration.slice(start, end + 1);
  const split = policy.indexOf("WITH CHECK");
  if (split < 0) throw new Error(`the bms.${table} policy carries no WITH CHECK clause`);
  return { policy, using: policy.slice(0, split), withCheck: policy.slice(split) };
};

/**
 * `E3.1` / ADR 0122 decisions 2, 3 and 9 — the static half of migration `0140`
 * (work-order references, SLA columns, the per-organization counter and the SLA policy
 * table). `apps/api/src/work-orders/work-order-reference.integration.spec.ts` asserts
 * what Postgres enforces. Assertions inline (section 4.6, top-level `tests/`).
 */
describe("E3.1 — work-order reference and SLA (migration 0140)", () => {
  it("is not scanning an empty or misnamed file", () => {
    expect(existsSync(join(repoRoot, MIGRATION_REL)), `${MIGRATION_REL} must exist`).toBe(true);
    const migration = migrationSql();
    expect(migration.length).toBeGreaterThan(2000);
    expect(migration.split(";").filter((s) => s.trim().length > 0).length).toBeGreaterThan(20);
  });

  it("registers migration 0140 in the journal, after 0139 and before now", () => {
    const journal = JSON.parse(read("packages/db/drizzle/meta/_journal.json")) as {
      entries: Array<Record<string, unknown>>;
    };
    const entry = journal.entries.find((e) => e.tag === TAG);

    expect(entry, "migration 0140 must have a journal entry, or drizzle never runs it").toBeDefined();
    expect(entry?.idx).toBe(141);
    expect(entry?.version).toBe("7");
    expect(entry?.breakpoints).toBe(true);
    // 0139's `when` — the F4.94 class.
    expect(entry?.when as number).toBeGreaterThan(1794312817982);
    expect(entry?.when as number).toBeLessThan(Date.now());
  });

  it("balances SET ROLE bms_owner with RESET ROLE and issues no GRANT and no CONCURRENTLY", () => {
    const migration = migrationSql();
    const sets = migration.match(/^SET ROLE bms_owner;$/gm) ?? [];
    const resets = migration.match(/^RESET ROLE;$/gm) ?? [];
    expect(sets.length).toBeGreaterThanOrEqual(1);
    expect(resets.length).toBe(sets.length);
    expect(migration).not.toMatch(/\bGRANT\b/i);
    expect(migration).not.toMatch(/\bCONCURRENTLY\b/i);
  });

  it("backfills work orders and counters only after the first RESET ROLE", () => {
    // Under SET ROLE bms_owner, FORCE row security makes an UPDATE of bms.work_orders
    // match zero rows and raise nothing (AGENTS.md section 4.4). The backfill has to
    // run as the migrator's own superuser role.
    const migration = migrationSql();
    const firstReset = migration.indexOf("RESET ROLE;");
    const secondSet = migration.indexOf("SET ROLE bms_owner;", firstReset);
    const backfill = migration.indexOf("UPDATE bms.work_orders");
    const counters = migration.indexOf("INSERT INTO bms.work_order_counters");
    expect(firstReset).toBeGreaterThan(0);
    expect(secondSet).toBeGreaterThan(firstReset);
    for (const [name, at] of [["the work_orders backfill", backfill], ["the counters backfill", counters]] as const) {
      expect(at, `${name} must exist`).toBeGreaterThan(0);
      expect(at, `${name} must run after the first RESET ROLE`).toBeGreaterThan(firstReset);
      expect(at, `${name} must run before the second SET ROLE`).toBeLessThan(secondSet);
    }
    expect(migration.match(/UPDATE bms\.work_orders/g)?.length, "exactly one work_orders backfill").toBe(1);
  });

  it("backfills only rows with no seq, in created_at then id order, and widens past six digits", () => {
    const migration = migrationSql();
    expect(migration).toContain("PARTITION BY w.organization_id ORDER BY w.created_at, w.id");
    expect(migration).toContain("WHERE w.seq IS NULL");
    expect(migration).toContain("lpad(r.seq::text, greatest(6, length(r.seq::text)), '0')");
    expect(migration).toContain("coalesce(d.work_order_prefix, 'GEN')");
  });

  it("raises before SET NOT NULL when a work order still has no seq or reference", () => {
    const migration = migrationSql();
    const guard = migration.indexOf("a work order still has no seq or reference");
    const notNull = migration.indexOf("ALTER COLUMN seq SET NOT NULL");
    expect(guard).toBeGreaterThan(0);
    expect(notNull).toBeGreaterThan(guard);
    expect(migration).toContain("ALTER COLUMN reference SET NOT NULL");
  });

  it("adds the four work_orders columns nullable and bounds the SLA", () => {
    const migration = migrationSql();
    for (const column of ["seq integer", "reference varchar(32)", "sla_minutes integer", "sla_due_at timestamptz"]) {
      expect(migration).toContain(`ADD COLUMN IF NOT EXISTS ${column}`);
    }
    expect(migration).toContain("CHECK (sla_minutes IS NULL OR sla_minutes BETWEEN 1 AND 525600)");
    expect(migration).toContain("CHECK ((sla_minutes IS NULL) = (sla_due_at IS NULL))");
  });

  it("makes seq and reference unique per organization", () => {
    const migration = migrationSql();
    expect(migration).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS work_orders_organization_seq_key\n  ON bms.work_orders(organization_id, seq);",
    );
    expect(migration).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS work_orders_organization_reference_key\n  ON bms.work_orders(organization_id, reference);",
    );
  });

  it("puts a prefix column and the same format CHECK on asset_domains and asset_templates", () => {
    const migration = migrationSql();
    for (const table of ["asset_domains", "asset_templates"]) {
      expect(migration).toContain(`ALTER TABLE bms.${table}\n  ADD COLUMN IF NOT EXISTS work_order_prefix varchar(8);`);
      expect(migration).toContain(
        `ALTER TABLE bms.${table}\n  ADD CONSTRAINT ${table}_work_order_prefix_check CHECK (work_order_prefix ~ '^[A-Z0-9]{2,8}$');`,
      );
    }
  });

  it("fills a domain prefix only where none is set", () => {
    const migration = migrationSql();
    expect(migration).toContain("UPDATE bms.asset_domains d");
    expect(migration).toContain("AND d.work_order_prefix IS NULL");
    for (const pair of ["('electrical', 'ELEC')", "('hvac', 'HVAC')", "('it', 'IT')", "('environment', 'ENV')", "('water', 'WATER')", "('mechanical', 'MECH')", "('ups', 'UPS')", "('facility', 'FAC')"]) {
      expect(migration).toContain(pair);
    }
  });

  it("creates the two tenant tables and enables and forces row level security", () => {
    const migration = migrationSql();
    for (const table of NEW_TABLES) {
      expect(migration).toContain(`CREATE TABLE IF NOT EXISTS bms.${table}`);
      expect(migration).toContain(`ALTER TABLE bms.${table} ENABLE ROW LEVEL SECURITY;`);
      expect(migration).toContain(`ALTER TABLE bms.${table} FORCE ROW LEVEL SECURITY;`);
    }
  });

  it("each policy is dropped then created and checks the own organization in USING and WITH CHECK", () => {
    const migration = migrationSql();
    for (const table of NEW_TABLES) {
      const drop = migration.indexOf(`DROP POLICY IF EXISTS tenant_isolation ON bms.${table};`);
      const create = migration.indexOf(`CREATE POLICY tenant_isolation ON bms.${table}\n`);
      expect(drop, `bms.${table}: DROP POLICY`).toBeGreaterThanOrEqual(0);
      expect(create, `bms.${table}: CREATE POLICY after DROP`).toBeGreaterThan(drop);
      const { policy, using, withCheck } = policyHalves(migration, table);
      expect(using, `bms.${table} USING`).toContain(OWN_ORG);
      expect(withCheck, `bms.${table} WITH CHECK`).toContain(OWN_ORG);
      expect(policy).not.toMatch(/organization_id\s+IS\s+NULL/i);
    }
  });

  it("closes the policy table's priority vocabulary and bounds its minutes", () => {
    const migration = migrationSql();
    expect(migration).toContain("PRIMARY KEY (organization_id, priority)");
    expect(migration).toContain("CHECK (priority IN ('low','medium','high','critical'))");
    expect(migration).toContain("CHECK (resolution_minutes BETWEEN 1 AND 525600)");
    expect(migration).toContain("organization_id uuid PRIMARY KEY REFERENCES bms.organizations(id)");
  });

  it("refuses to backfill as a role that row security binds", () => {
    const migration = migrationSql();
    const roleCheck = migration.indexOf("r.rolsuper OR r.rolbypassrls");
    expect(roleCheck).toBeGreaterThan(migration.indexOf("RESET ROLE;"));
    expect(roleCheck).toBeLessThan(migration.indexOf("UPDATE bms.work_orders"));
  });

  it("proves each pool privilege on its own, never as a comma list", () => {
    const migration = migrationSql();
    expect(migration).toContain("FOREACH priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP");
    expect(migration).toContain("has_table_privilege('bms_tenant', 'bms.' || tbl, priv)");
    expect(migration).toContain("has_table_privilege('bms_fleet', 'bms.' || tbl, priv)");
    expect(migration).not.toMatch(/has_table_privilege\([^)]*'[A-Z]+,\s*[A-Z]+/);
  });

  it("proves forced RLS, the policies, the prefix checks and NOT NULL in a DO block", () => {
    const migration = migrationSql();
    expect(migration.match(/DO \$\$/g)?.length).toBeGreaterThanOrEqual(3);
    expect(migration).toContain("c.relforcerowsecurity");
    expect(migration).toContain("pg_policies");
    expect(migration).toContain("attnotnull");
  });

  it("declares the Drizzle columns and tables", () => {
    const maintenance = read("packages/db/src/schema/maintenance-schema.ts");
    expect(maintenance).toContain('bmsSchema.table("work_order_counters"');
    expect(maintenance).toMatch(/bmsSchema\.table\(\s*"work_order_sla_policies"/);
    expect(maintenance).toContain('reference: varchar("reference", { length: 32 }).notNull()');
    expect(maintenance).toContain('seq: integer("seq").notNull()');
    const core = read("packages/db/src/schema/bms-schema.ts");
    expect(core.match(/workOrderPrefix: varchar\("work_order_prefix", \{ length: 8 \}\)/g)?.length).toBe(2);
  });
});

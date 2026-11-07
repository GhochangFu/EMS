import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

const MIGRATION_REL = "packages/db/drizzle/0126_organization_control_room_views_and_catalog.sql";
const TAG = "0126_organization_control_room_views_and_catalog";
const TABLE = "organization_control_room_views";
const BUILDER_REL = "packages/shared/src/contracts/dashboard-builder.ts";
const TEMPLATES_REL = "packages/shared/src/contracts/dashboard-templates.ts";
const OWN_ORG = "organization_id = nullif(current_setting('app.current_organization', true), '')::uuid";

/** Strip `--` comment lines before a scan: a raw scan is satisfied by a comment
 * quoting the statement it explains (the `f3.1a-dashboard-schema.test.ts` lesson). */
const sqlOnly = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

/** The table's `CREATE POLICY tenant_isolation` statement, split at `WITH CHECK`. */
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

/** One column declaration inside `CREATE TABLE`, from its name to the next comma. */
const columnLine = (migration: string, marker: string): string => {
  const start = migration.indexOf(marker);
  if (start < 0) throw new Error(`no column declaration starting ${marker}`);
  const end = migration.indexOf(",", start);
  if (end < 0) throw new Error(`unterminated column declaration ${marker}`);
  return migration.slice(start, end);
};

/** The `IN (...)` list of an `ADD CONSTRAINT <name> CHECK (<column> IN (...))`, sorted. */
const checkList = (sql: string, constraint: string, column: string): string[] => {
  const match = new RegExp(`ADD CONSTRAINT ${constraint}\\s+CHECK \\(${column} IN \\(([^)]*)\\)\\)`).exec(sql);
  if (match === null) throw new Error(`could not read ${constraint}'s IN list from 0126 — fix this parser.`);
  return (match[1] ?? "")
    .split(",")
    .map((value) => value.trim().replace(/^'|'$/g, ""))
    .filter(Boolean)
    .sort();
};

/** A `z.enum([...])` body parsed from a contract source; throws rather than return `[]`. */
const enumValues = (rel: string, name: string): string[] => {
  const block = new RegExp(`export const ${name} = z\\.enum\\(\\[([\\s\\S]*?)\\]\\)`).exec(read(rel));
  if (block === null) throw new Error(`could not find ${name}'s z.enum([...]) in ${rel}`);
  const values = (block[1] ?? "")
    .split(",")
    .map((line) => line.trim().replace(/^"|"$/g, ""))
    .filter((line) => line.length > 0 && !line.startsWith("//"));
  if (values.length === 0) throw new Error(`${name} parsed to an empty list`);
  return values.sort();
};

/**
 * `F4.317` / ADR 0112 decisions 2, 4 and 9 — the static half of migration `0126`:
 * the pointer table `bms.organization_control_room_views` (FORCE RLS, two legs),
 * the `organization` dashboard section, and the two widened CHECKs.
 * `tests/f4.317-organization-control-room-views-schema.integration.test.ts`
 * asserts what Postgres enforces. Assertions inline, no `.spec` sibling (§4.6).
 */
describe("F4.317 — migration 0126: organization control room views and catalog keys", () => {
  it("is not scanning an empty or misnamed file", () => {
    expect(existsSync(join(repoRoot, MIGRATION_REL)), `${MIGRATION_REL} must exist`).toBe(true);
    const migration = read(MIGRATION_REL);
    expect(migration.length).toBeGreaterThan(1000);
    expect(sqlOnly(migration)).toContain(`CREATE TABLE IF NOT EXISTS bms.${TABLE}`);
  });

  it("registers migration 0126 in the journal, after 0125 and before now", () => {
    const journal = JSON.parse(read("packages/db/drizzle/meta/_journal.json")) as {
      entries: { idx: number; tag: string; when: number; breakpoints: boolean }[];
    };
    const entry = journal.entries.find((e) => e.tag === TAG);
    expect(entry, "migration 0126 must have a journal entry, or drizzle never runs it").toBeDefined();
    expect(entry?.idx).toBe(127);
    expect(entry?.breakpoints).toBe(true);
    // 0125's `when` — the F4.94 class: a stamp ahead of the clock is silently skipped.
    expect(entry?.when as number).toBeGreaterThan(1793860900000);
    expect(entry?.when as number).toBeLessThanOrEqual(Date.now());
    const whens = journal.entries.map((row) => row.when);
    expect(whens.every((value, index) => index === 0 || (whens[index - 1] ?? 0) < value)).toBe(true);
  });

  it("creates the table inside SET ROLE bms_owner / RESET ROLE, and issues no GRANT", () => {
    const sql = sqlOnly(read(MIGRATION_REL));
    const setAt = sql.indexOf("SET ROLE bms_owner;");
    const createAt = sql.indexOf(`CREATE TABLE IF NOT EXISTS bms.${TABLE}`);
    const resetAt = sql.indexOf("RESET ROLE;");
    expect(setAt).toBeGreaterThan(-1);
    expect(setAt).toBeLessThan(createAt);
    expect(createAt).toBeLessThan(resetAt);
    expect(sql).not.toMatch(/\bGRANT\b/i);
  });

  it("organization_id is the primary key and cascades; dashboard_id is ON DELETE SET NULL", () => {
    const sql = sqlOnly(read(MIGRATION_REL));
    const orgId = columnLine(sql, "organization_id uuid PRIMARY KEY REFERENCES bms.organizations(id)");
    expect(orgId).toContain("ON DELETE CASCADE");

    const dashboardId = columnLine(sql, "dashboard_id uuid REFERENCES bms.dashboards(id)");
    expect(dashboardId).toContain("ON DELETE SET NULL");
    expect(dashboardId).not.toContain("CASCADE");

    expect(sql).toContain("updated_at timestamptz NOT NULL DEFAULT now()");
    expect(sql).toContain("updated_by uuid REFERENCES bms.users(id)");
  });

  it("enables and forces row level security", () => {
    const sql = sqlOnly(read(MIGRATION_REL));
    expect(sql).toContain(`ALTER TABLE bms.${TABLE} ENABLE ROW LEVEL SECURITY;`);
    expect(sql).toContain(`ALTER TABLE bms.${TABLE} FORCE ROW LEVEL SECURITY;`);
  });

  it("both policy halves check the own organization and carry the correlated dashboards leg", () => {
    const { policy, using, withCheck } = policyHalves(sqlOnly(read(MIGRATION_REL)));
    for (const [name, half] of [["USING", using], ["WITH CHECK", withCheck]] as const) {
      const ownOnly = half.replaceAll(`d.${OWN_ORG}`, "");
      expect(ownOnly, `${name} must check the own organization_id`).toContain(OWN_ORG);
      expect(half, `${name} must hold the dashboards leg`).toContain(
        "dashboard_id IS NULL OR EXISTS (SELECT 1 FROM bms.dashboards d",
      );
      expect(half, `${name} dashboards leg must correlate to the row's dashboard`).toContain(
        `d.id = ${TABLE}.dashboard_id`,
      );
      expect(half, `${name} dashboards leg must pin the dashboard's organization`).toContain(`d.${OWN_ORG}`);
    }
    expect(policy).not.toMatch(/organization_id\s+IS\s+NULL/i);
  });

  it("creates no index beyond the primary key", () => {
    const sql = sqlOnly(read(MIGRATION_REL));
    expect(sql).not.toMatch(/CREATE\s+(UNIQUE\s+)?INDEX/i);
  });

  it("comments the table with the fail-safe", () => {
    expect(sqlOnly(read(MIGRATION_REL))).toContain(
      `COMMENT ON TABLE bms.${TABLE} IS 'No row = the stock strip (ADR 0112 decision 3).';`,
    );
  });

  it("inserts the 'organization' dashboard section, and asserts it landed", () => {
    const sql = sqlOnly(read(MIGRATION_REL));
    expect(sql).toMatch(
      /INSERT INTO bms\.dashboard_sections \(code, label, sort_order\) VALUES\s*\('organization', 'Organization layouts', 950\)\s*ON CONFLICT DO NOTHING;/,
    );
    expect(sql).toContain("SELECT 1 FROM bms.dashboard_sections WHERE code = 'organization'");
  });

  it("widens the template target CHECK to exactly dashboardTemplateTargetSchema", () => {
    const sql = sqlOnly(read(MIGRATION_REL));
    const listed = checkList(sql, "dashboard_templates_target_check", "target");
    expect(listed).toEqual(["asset_group", "organization", "site"]);
    expect(listed).toEqual(enumValues(TEMPLATES_REL, "dashboardTemplateTargetSchema"));
  });

  it("widens the catalog-key CHECK with the three new keys (frozen at thirteen since 0129)", () => {
    const sql = sqlOnly(read(MIGRATION_REL));
    const listed = checkList(sql, "dashboard_widget_sources_catalog_key_check", "catalog_key");
    // ADR 0112 Amendment 1 (owner ruling Q1b): `alarms.critical.count` is the thirteenth key.
    expect(listed.length).toBe(13);
    expect(listed).toContain("sites.live.count");
    expect(listed).toContain("pue.ratio");
    expect(listed).toContain("alarms.critical.count");
    // `F4.332` (ADR 0112 Amendment 3): `0129` widens the CHECK again, so `0126` is frozen at
    // these thirteen and the enum is a superset; `tests/f3.35-metric-catalog-schema.test.ts`
    // holds `0129` equal to the enum.
    const current = enumValues(BUILDER_REL, "metricCatalogKeySchema");
    for (const key of listed) expect(current).toContain(key);

    // The ten 0096 admitted are all still admitted — read from 0096, not retyped.
    const previous = checkList(
      sqlOnly(read("packages/db/drizzle/0096_site_widget_types_and_assets_catalog.sql")),
      "dashboard_widget_sources_catalog_key_check",
      "catalog_key",
    );
    for (const key of previous) expect(listed, `${key} must stay accepted`).toContain(key);
  });

  it("drops each widened constraint before adding it, after RESET ROLE, with no IF NOT EXISTS guard", () => {
    const sql = sqlOnly(read(MIGRATION_REL));
    const resetAt = sql.indexOf("RESET ROLE;");
    for (const constraint of ["dashboard_templates_target_check", "dashboard_widget_sources_catalog_key_check"]) {
      const dropAt = sql.indexOf(`DROP CONSTRAINT IF EXISTS ${constraint}`);
      const addAt = sql.indexOf(`ADD CONSTRAINT ${constraint}`);
      expect(dropAt, `${constraint} must be dropped`).toBeGreaterThan(resetAt);
      expect(addAt, `${constraint} must be added after the DROP`).toBeGreaterThan(dropAt);
    }
    expect(/ADD CONSTRAINT[\s\S]*IF NOT EXISTS/.test(sql)).toBe(false);
  });

  it("declares the Drizzle table and exports it from the schema index", () => {
    expect(read("packages/db/src/schema/index.ts")).toContain(
      'export * from "./organization-control-room-views-schema";',
    );
    const schema = read("packages/db/src/schema/organization-control-room-views-schema.ts");
    expect(schema).toContain(`bmsSchema.table("${TABLE}"`);
  });
});

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

const MIGRATION_REL = "packages/db/drizzle/0095_site_template_target_and_group_domain.sql";
const TAG = "0095_site_template_target_and_group_domain";
const CONTRACT_REL = "packages/shared/src/contracts/dashboard-templates.ts";

/** Strip `--` comment lines before a scan — the `f3.1a-dashboard-schema.test.ts`
 * lesson: a raw scan is satisfied by a comment quoting the statement it
 * explains, so a deleted statement stays green as long as a comment still
 * spells it. */
const sqlOnly = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

/** Every `UPDATE bms.asset_groups` statement's start offset in comment-free SQL. */
const groupUpdateOffsets = (sql: string): number[] =>
  [...sql.matchAll(/UPDATE bms\.asset_groups\b/g)].map((m) => m.index as number);

/**
 * `F3.73` — the static half of migration `0095` (plan Task 2.1): the template
 * `target` column, the group `domain` column, the `site` section, two role
 * codes and the backfill. `tests/f3.73-site-template-schema.integration.test.ts`
 * asserts what Postgres enforces. Assertions inline, no `.spec` sibling (§4.6).
 */
describe("F3.73 — migration 0095: template target and group domain", () => {
  it("is not scanning an empty or misnamed file", () => {
    expect(existsSync(join(repoRoot, MIGRATION_REL)), `${MIGRATION_REL} must exist`).toBe(true);
    const migration = read(MIGRATION_REL);
    expect(migration.length).toBeGreaterThan(1000);
    expect(sqlOnly(migration)).toContain("ALTER TABLE bms.dashboard_templates");
  });

  it("registers migration 0095 in the journal, after 0094 and before now", () => {
    const journal = JSON.parse(read("packages/db/drizzle/meta/_journal.json")) as {
      entries: Array<Record<string, unknown>>;
    };
    const entry = journal.entries.find((e) => e.tag === TAG);

    expect(entry, "migration 0095 must have a journal entry, or drizzle never runs it").toBeDefined();
    expect(entry?.idx).toBe(95);
    expect(entry?.breakpoints).toBe(true);
    // 0094's `when` — the F4.94 class.
    expect(entry?.when as number).toBeGreaterThan(1790768303628);
    expect(entry?.when as number).toBeLessThanOrEqual(Date.now());
  });

  it("adds target with the 'asset_group' default and a named CHECK", () => {
    const sql = sqlOnly(read(MIGRATION_REL));
    expect(sql).toContain(
      "ALTER TABLE bms.dashboard_templates ADD COLUMN IF NOT EXISTS target varchar(32) NOT NULL DEFAULT 'asset_group'",
    );
    expect(sql).toContain("dashboard_templates_target_check");
    expect(sql).toMatch(/CHECK \(target IN \('asset_group', 'site'\)\)/);
  });

  it("keeps the CHECK values equal to dashboardTemplateTargetSchema's options", () => {
    const check = /CHECK \(target IN \(([^)]*)\)\)/.exec(sqlOnly(read(MIGRATION_REL)));
    expect(check, "0095 must carry the target CHECK").not.toBeNull();
    const sqlValues = [...(check?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);

    const source = read(CONTRACT_REL);
    const decl = /dashboardTemplateTargetSchema\s*=\s*z\.enum\(\[([^\]]*)\]/.exec(source);
    expect(decl, `${CONTRACT_REL} must declare dashboardTemplateTargetSchema = z.enum([...])`).not.toBeNull();
    const enumValues = [...(decl?.[1] ?? "").matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);

    expect(enumValues.length).toBeGreaterThan(0);
    expect(sqlValues).toEqual(enumValues);
  });

  it("adds asset_groups.domain as a nullable FK to asset_domains(code)", () => {
    const sql = sqlOnly(read(MIGRATION_REL));
    expect(sql).toContain(
      "ALTER TABLE bms.asset_groups ADD COLUMN IF NOT EXISTS domain varchar(64) REFERENCES bms.asset_domains(code)",
    );
    expect(sql).not.toMatch(/domain varchar\(64\) NOT NULL/);
  });

  it("inserts the 'site' dashboard section", () => {
    const sql = sqlOnly(read(MIGRATION_REL));
    expect(sql).toMatch(
      /INSERT INTO bms\.dashboard_sections \(code, label, sort_order\) VALUES\s*\('site', 'Site layouts', 900\)\s*ON CONFLICT DO NOTHING;/,
    );
  });

  it("inserts leak-sensor and smoke-detector roles at free sort orders", () => {
    const sql = sqlOnly(read(MIGRATION_REL));
    expect(sql).toContain("INSERT INTO bms.asset_roles (code, label, sort_order) VALUES");
    expect(sql).toMatch(/\('leak-sensor',\s+'Leak Sensors',\s+850\)/);
    expect(sql).toMatch(/\('smoke-detector',\s+'Smoke Detectors',\s+860\)/);
  });

  it("re-creates no policy and grants nothing", () => {
    const sql = sqlOnly(read(MIGRATION_REL));
    expect(sql).not.toMatch(/CREATE POLICY|DROP POLICY|ALTER POLICY/);
    expect(sql).not.toMatch(/\bGRANT\b/);
  });

  it("runs every UPDATE bms.asset_groups after the last RESET ROLE, outside comments", () => {
    const sql = sqlOnly(read(MIGRATION_REL));
    const updates = groupUpdateOffsets(sql);
    const lastReset = sql.lastIndexOf("RESET ROLE;");
    // Anti-vacuity: the four backfill statements and the RESET ROLE are found.
    expect(updates.length).toBe(4);
    expect(lastReset).toBeGreaterThan(0);
    for (const at of updates) {
      expect(at, "an UPDATE on a FORCE-RLS table sits inside the bms_owner bracket").toBeGreaterThan(lastReset);
    }
  });

  it("excludes IT_LOAD from the same-code backfill and maps the three named groups", () => {
    const sql = sqlOnly(read(MIGRATION_REL));
    expect(sql).toContain("g.code <> 'IT_LOAD'");
    expect(sql).toMatch(/SET domain = 'electrical' WHERE domain IS NULL AND code = 'ups-battery'/);
    expect(sql).toMatch(/SET domain = 'it' WHERE domain IS NULL AND code = 'it-rack'/);
    expect(sql).toMatch(/SET domain = 'water' WHERE domain IS NULL AND code = 'demo-water-plant'/);
  });
});

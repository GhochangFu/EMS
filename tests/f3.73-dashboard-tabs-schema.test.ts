import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

const MIGRATION_REL = "packages/db/drizzle/0094_dashboard_tabs.sql";
const TAG = "0094_dashboard_tabs";
const TABLE = "dashboard_tabs";
const OWN_ORG = "organization_id = nullif(current_setting('app.current_organization', true), '')::uuid";

/** Strip `--` comment lines before a scan — the `f3.1a-dashboard-schema.test.ts`
 * lesson: a raw scan is satisfied by a comment quoting the statement it
 * explains, so a deleted statement stays green as long as a comment still
 * spells it. */
const sqlOnly = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

/** The text of the table's `CREATE POLICY tenant_isolation` statement,
 * terminator included, split at `WITH CHECK` — scoped so a per-table
 * assertion cannot be satisfied by prose elsewhere in the file. */
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

/** One named constraint clause, from `CONSTRAINT <name>` to the next `,\n` or
 * `\n)` — so an `ON DELETE` assertion reads that constraint and no other (the
 * dashboard FK's CASCADE must not satisfy a scan of the group FK). */
const constraintClause = (migration: string, name: string): string => {
  const start = migration.indexOf(`CONSTRAINT ${name} `);
  if (start < 0) throw new Error(`no constraint named ${name}`);
  const ends = [migration.indexOf(",\n", start), migration.indexOf("\n)", start), migration.indexOf(";", start)]
    .filter((i) => i >= 0);
  return migration.slice(start, Math.min(...ends));
};

/**
 * `F3.73` — the static half of `bms.dashboard_tabs`'s schema guarantees
 * (migration `0094`, ADR 0087 Amendment 1; plan D1 and Task 1.2).
 * `tests/f3.73-dashboard-tabs-schema.integration.test.ts` asserts what Postgres
 * enforces; this asserts the migration's text, including what a behavioural
 * probe cannot reach (the absent GRANT, the `RESTRICT` spelling that `NO ACTION`
 * would also satisfy at run time). Assertions inline, no `.spec` sibling (§4.6).
 */
describe("F3.73 — bms.dashboard_tabs schema (migration 0094)", () => {
  it("is not scanning an empty or misnamed file", () => {
    expect(existsSync(join(repoRoot, MIGRATION_REL)), `${MIGRATION_REL} must exist`).toBe(true);
    const migration = read(MIGRATION_REL);
    expect(migration.length).toBeGreaterThan(1000);
    expect(migration).toContain(`CREATE TABLE IF NOT EXISTS bms.${TABLE}`);
  });

  it("registers migration 0094 in the journal, after 0093 and before now", () => {
    const journal = JSON.parse(read("packages/db/drizzle/meta/_journal.json")) as {
      entries: Array<Record<string, unknown>>;
    };
    const entry = journal.entries.find((e) => e.tag === TAG);

    expect(entry, "migration 0094 must have a journal entry, or drizzle never runs it").toBeDefined();
    expect(entry?.idx).toBe(94);
    expect(entry?.breakpoints).toBe(true);
    // 0093's `when` — the F4.94 class: a stamp ahead of the wall clock sorts
    // after a later real-clock stamp and is silently skipped wherever the
    // later one applies.
    expect(entry?.when as number).toBeGreaterThan(1790731287289);
    expect(entry?.when as number).toBeLessThanOrEqual(Date.now());
  });

  it("brackets the whole migration in SET ROLE bms_owner / RESET ROLE", () => {
    const migration = sqlOnly(read(MIGRATION_REL));
    expect(migration).toContain("SET ROLE bms_owner;");
    expect(migration).toContain("RESET ROLE;");
  });

  it("issues no GRANT statement — 0041's default privileges do it", () => {
    expect(sqlOnly(read(MIGRATION_REL))).not.toMatch(/\bGRANT\b/i);
  });

  it("creates the table with organization_id NOT NULL", () => {
    const migration = sqlOnly(read(MIGRATION_REL));
    expect(migration).toMatch(/organization_id uuid NOT NULL REFERENCES bms\.organizations\(id\)/);
  });

  it("enables and forces row level security", () => {
    const migration = sqlOnly(read(MIGRATION_REL));
    expect(migration).toContain(`ALTER TABLE bms.${TABLE} ENABLE ROW LEVEL SECURITY;`);
    expect(migration).toContain(`ALTER TABLE bms.${TABLE} FORCE ROW LEVEL SECURITY;`);
  });

  it("the policy checks the own organization_id, in USING and in WITH CHECK, with no NULL disjunct", () => {
    const { policy, using, withCheck } = policyHalves(sqlOnly(read(MIGRATION_REL)));

    for (const [name, half] of [["USING", using], ["WITH CHECK", withCheck]] as const) {
      // The legs spell the same comparison on `d.` / `g.`; remove those first
      // so only the row's own column can satisfy this.
      const ownOnly = half.replaceAll(`d.${OWN_ORG}`, "").replaceAll(`g.${OWN_ORG}`, "");
      expect(ownOnly, `${name} must check the own organization_id`).toContain(OWN_ORG);
    }
    expect(policy).not.toMatch(/organization_id\s+IS\s+NULL/i);
    // Positive control: the policy does spell `IS NULL` (the group leg's own
    // guard), so the negative above is scoped, not vacuous.
    expect(policy).toContain("asset_group_id IS NULL OR EXISTS");
  });

  it("the policy carries the dashboards leg and the asset-groups leg, in USING and in WITH CHECK", () => {
    const { using, withCheck } = policyHalves(sqlOnly(read(MIGRATION_REL)));

    for (const [name, half] of [["USING", using], ["WITH CHECK", withCheck]] as const) {
      expect(half, `${name} must hold the dashboards leg`).toContain("FROM bms.dashboards d");
      expect(half, `${name} must hold the asset-groups leg`).toContain("FROM bms.asset_groups g");
      expect(half, `${name} dashboards leg must pin the parent's organization`).toContain(`d.${OWN_ORG}`);
      expect(half, `${name} asset-groups leg must pin the parent's organization`).toContain(`g.${OWN_ORG}`);
      // The correlation predicates (the 0082 migration review M1): without them
      // each EXISTS asks "does the organization own *any* dashboard / group".
      expect(half, `${name} dashboards leg must correlate`).toContain("d.id = dashboard_tabs.dashboard_id");
      expect(half, `${name} asset-groups leg must correlate`).toContain("g.id = dashboard_tabs.asset_group_id");
    }
  });

  it("the dashboard FK and the (dashboard_id, location_id) FK are ON DELETE CASCADE", () => {
    const migration = sqlOnly(read(MIGRATION_REL));

    const dashboard = constraintClause(migration, "dashboard_tabs_dashboard_id_fkey");
    expect(dashboard).toContain("FOREIGN KEY (dashboard_id) REFERENCES bms.dashboards(id)");
    expect(dashboard).toContain("ON DELETE CASCADE");

    const pinned = constraintClause(migration, "dashboard_tabs_dashboard_id_location_id_fkey");
    expect(pinned).toContain("FOREIGN KEY (dashboard_id, location_id) REFERENCES bms.dashboards(id, location_id)");
    expect(pinned).toContain("ON DELETE CASCADE");
  });

  it("the (asset_group_id, location_id) FK is ON DELETE RESTRICT", () => {
    const group = constraintClause(sqlOnly(read(MIGRATION_REL)), "dashboard_tabs_asset_group_id_location_id_fkey");
    expect(group).toContain(
      "FOREIGN KEY (asset_group_id, location_id) REFERENCES bms.asset_groups(id, location_id)",
    );
    expect(group).toContain("ON DELETE RESTRICT");
    expect(group).not.toContain("CASCADE");
  });

  it("names the per-dashboard unique keys", () => {
    const migration = sqlOnly(read(MIGRATION_REL));
    expect(constraintClause(migration, "dashboard_tabs_dashboard_id_tab_key_key")).toContain(
      "UNIQUE (dashboard_id, tab_key)",
    );
    expect(constraintClause(migration, "dashboard_tabs_dashboard_id_id_key")).toContain("UNIQUE (dashboard_id, id)");
  });

  it("adds the two (id, location_id) unique keys the composite FKs target", () => {
    const migration = sqlOnly(read(MIGRATION_REL));
    expect(migration).toContain(
      "ALTER TABLE bms.asset_groups ADD CONSTRAINT asset_groups_id_location_key UNIQUE (id, location_id)",
    );
    expect(migration).toContain(
      "ALTER TABLE bms.dashboards ADD CONSTRAINT dashboards_id_location_key UNIQUE (id, location_id)",
    );
  });

  it("adds dashboard_widgets.tab_id with the composite FK to its own dashboard's tab", () => {
    const migration = sqlOnly(read(MIGRATION_REL));
    expect(migration).toContain("ALTER TABLE bms.dashboard_widgets ADD COLUMN IF NOT EXISTS tab_id uuid;");
    const fk = constraintClause(migration, "dashboard_widgets_dashboard_id_tab_id_fkey");
    expect(fk).toContain("FOREIGN KEY (dashboard_id, tab_id) REFERENCES bms.dashboard_tabs(dashboard_id, id)");
    expect(fk).toContain("ON DELETE CASCADE");
  });

  it("refuses the reserved tab key 'assets' and pins the key charset", () => {
    const check = constraintClause(sqlOnly(read(MIGRATION_REL)), "dashboard_tabs_tab_key_check");
    expect(check).toContain("tab_key ~ '^[a-z0-9-]{1,64}$'");
    expect(check).toContain("tab_key <> 'assets'");
  });

  it("an Overview tab has neither group nor location, a group tab has both", () => {
    const check = constraintClause(sqlOnly(read(MIGRATION_REL)), "dashboard_tabs_group_location_check");
    expect(check).toContain("CHECK ((asset_group_id IS NULL) = (location_id IS NULL))");
  });

  it("creates the three indexes", () => {
    const migration = sqlOnly(read(MIGRATION_REL));
    expect(migration).toContain(
      "CREATE INDEX IF NOT EXISTS dashboard_tabs_dashboard_idx ON bms.dashboard_tabs (dashboard_id, sort_order);",
    );
    expect(migration).toContain(
      "CREATE INDEX IF NOT EXISTS dashboard_tabs_asset_group_idx ON bms.dashboard_tabs (asset_group_id);",
    );
    expect(migration).toContain(
      "CREATE INDEX IF NOT EXISTS dashboard_widgets_tab_idx ON bms.dashboard_widgets (tab_id);",
    );
    expect(migration).not.toMatch(/CONCURRENTLY/i);
  });

  it("declares the Drizzle table, the widget column and both named unique keys", () => {
    const dashboardSchema = read("packages/db/src/schema/dashboard-schema.ts");
    expect(dashboardSchema).toContain(`bmsSchema.table(\n  "${TABLE}"`);
    expect(dashboardSchema).toContain('tabId: uuid("tab_id")');
    expect(dashboardSchema).toContain('unique("dashboard_tabs_dashboard_id_tab_key_key")');
    expect(dashboardSchema).toContain('unique("dashboard_tabs_dashboard_id_id_key")');
    expect(dashboardSchema).toContain('unique("dashboards_id_location_key")');
    expect(read("packages/db/src/schema/bms-schema.ts")).toContain('unique("asset_groups_id_location_key")');
  });
});

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

const MIGRATION_REL = "packages/db/drizzle/0082_site_control_room_views.sql";
const TAG = "0082_site_control_room_views";
const TABLE = "site_control_room_views";
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

/** One column declaration inside `CREATE TABLE`, from its name to the next
 * comma — so an `ON DELETE` assertion reads that column's line and no other
 * (the `location_id` CASCADE must not satisfy a scan for `dashboard_id`). */
const columnLine = (migration: string, marker: string): string => {
  const start = migration.indexOf(marker);
  if (start < 0) throw new Error(`no column declaration starting ${marker}`);
  const end = migration.indexOf(",", start);
  if (end < 0) throw new Error(`unterminated column declaration ${marker}`);
  return migration.slice(start, end);
};

/**
 * `F3.67` — the static half of `bms.site_control_room_views`'s schema
 * guarantees (migration `0082`, ADR 0076 decisions 3–4; plan U1, T1–T10).
 * `tests/f3.67-site-control-room-views-schema.integration.test.ts` asserts
 * what Postgres enforces (its I9c/I9d read probes reach the `USING` legs);
 * this asserts the migration's text, including what a behavioural probe
 * cannot reach (the absent GRANT and index). Assertions inline, no `.spec`
 * sibling (§4.6).
 */
describe("F3.67 — bms.site_control_room_views schema (migration 0082)", () => {
  it("is not scanning an empty or misnamed file", () => {
    expect(existsSync(join(repoRoot, MIGRATION_REL)), `${MIGRATION_REL} must exist`).toBe(true);
    const migration = read(MIGRATION_REL);
    expect(migration.length).toBeGreaterThan(1000);
    expect(migration).toContain(`CREATE TABLE IF NOT EXISTS bms.${TABLE}`);
  });

  // T1
  it("registers migration 0082 in the journal, after 0081 and before now", () => {
    const journal = JSON.parse(read("packages/db/drizzle/meta/_journal.json")) as {
      entries: Array<Record<string, unknown>>;
    };
    const entry = journal.entries.find((e) => e.tag === TAG);

    expect(entry, "migration 0082 must have a journal entry, or drizzle never runs it").toBeDefined();
    expect(entry?.idx).toBe(82);
    expect(entry?.tag).toBe(TAG);
    expect(entry?.breakpoints).toBe(true);
    // 0081's `when` — the F4.94 class: a stamp ahead of the wall clock sorts
    // after a later real-clock stamp and is silently skipped wherever the
    // later one applies.
    expect(entry?.when as number).toBeGreaterThan(1790163679446);
    expect(entry?.when as number).toBeLessThan(Date.now());
  });

  // T2
  it("brackets the whole migration in SET ROLE bms_owner / RESET ROLE", () => {
    const migration = sqlOnly(read(MIGRATION_REL));
    expect(migration).toContain("SET ROLE bms_owner;");
    expect(migration).toContain("RESET ROLE;");
  });

  // T3
  it("issues no GRANT statement — 0041's default privileges do it", () => {
    expect(sqlOnly(read(MIGRATION_REL))).not.toMatch(/\bGRANT\b/i);
  });

  // T4
  it("enables and forces row level security", () => {
    const migration = sqlOnly(read(MIGRATION_REL));
    expect(migration).toContain(`ALTER TABLE bms.${TABLE} ENABLE ROW LEVEL SECURITY;`);
    expect(migration).toContain(`ALTER TABLE bms.${TABLE} FORCE ROW LEVEL SECURITY;`);
  });

  // T5
  it("the policy checks the own organization_id column, in USING and in WITH CHECK, with no NULL disjunct", () => {
    const { policy, using, withCheck } = policyHalves(sqlOnly(read(MIGRATION_REL)));

    for (const [name, half] of [["USING", using], ["WITH CHECK", withCheck]] as const) {
      // The legs spell the same comparison on `l.` / `d.`; remove those first
      // so only the row's own column can satisfy this.
      const ownOnly = half.replaceAll(`l.${OWN_ORG}`, "").replaceAll(`d.${OWN_ORG}`, "");
      expect(ownOnly, `${name} must check the own organization_id`).toContain(OWN_ORG);
    }
    expect(policy).not.toMatch(/organization_id\s+IS\s+NULL/i);
    // Positive control: the policy does spell `IS NULL` (the dashboards leg's
    // own guard), so the negative above is scoped, not vacuous.
    expect(policy).toContain("dashboard_id IS NULL OR EXISTS");
  });

  // T6
  it("the policy carries the locations leg and the dashboards leg, in USING and in WITH CHECK", () => {
    const { using, withCheck } = policyHalves(sqlOnly(read(MIGRATION_REL)));

    for (const [name, half] of [["USING", using], ["WITH CHECK", withCheck]] as const) {
      expect(half, `${name} must hold the locations leg`).toContain("FROM bms.locations l");
      expect(half, `${name} must hold the dashboards leg`).toContain("FROM bms.dashboards d");
      expect(half, `${name} locations leg must pin the parent's organization`).toContain(
        `l.${OWN_ORG}`,
      );
      expect(half, `${name} dashboards leg must pin the parent's organization`).toContain(
        `d.${OWN_ORG}`,
      );
      // The correlation predicates (migration review M1): without them each
      // EXISTS asks "does the organization own *any* location / dashboard",
      // which every tenant satisfies.
      expect(half, `${name} locations leg must correlate to the row's location`).toContain(
        "l.id = site_control_room_views.location_id",
      );
      expect(half, `${name} dashboards leg must correlate to the row's dashboard`).toContain(
        "d.id = site_control_room_views.dashboard_id",
      );
    }
  });

  // T7
  it("names all four CHECK constraints", () => {
    const migration = sqlOnly(read(MIGRATION_REL));
    for (const name of [
      "CONSTRAINT site_control_room_views_kind_check",
      "CONSTRAINT site_control_room_views_builtin_key_check",
      "CONSTRAINT site_control_room_views_dashboard_id_check",
      "CONSTRAINT site_control_room_views_builtin_pair_check",
    ]) {
      expect(migration, `${name} must be named, not derived`).toContain(name);
    }
  });

  // T8
  it("dashboard_id is ON DELETE SET NULL, and location_id is ON DELETE CASCADE, each on its own line", () => {
    const migration = sqlOnly(read(MIGRATION_REL));

    const dashboardId = columnLine(migration, "dashboard_id uuid REFERENCES bms.dashboards(id)");
    expect(dashboardId).toContain("ON DELETE SET NULL");
    expect(dashboardId).not.toContain("CASCADE");

    const locationId = columnLine(migration, "location_id uuid PRIMARY KEY REFERENCES bms.locations(id)");
    expect(locationId).toContain("ON DELETE CASCADE");
  });

  // T9
  it("creates no index beyond the primary key (plan D7)", () => {
    const migration = sqlOnly(read(MIGRATION_REL));
    expect(migration).not.toMatch(/CREATE\s+(UNIQUE\s+)?INDEX/i);
    expect(migration).not.toMatch(/CONCURRENTLY/i);
  });

  // T10
  it("declares the Drizzle table and exports it from the schema index", () => {
    const index = read("packages/db/src/schema/index.ts");
    expect(index).toContain('export * from "./site-control-room-views-schema";');
    const schema = read("packages/db/src/schema/site-control-room-views-schema.ts");
    expect(schema).toContain(`bmsSchema.table("${TABLE}"`);
  });
});

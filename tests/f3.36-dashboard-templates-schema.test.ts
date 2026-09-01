import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const drizzleDir = join(repoRoot, "packages", "db", "drizzle");
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

/**
 * `F3.36` / ADR 0049 + Amendment 1 + Amendment 2 — the section dashboard
 * template tables.
 *
 * **Assertions inline, no `.spec` sibling.** §4.6 carves out the top-level
 * `tests/` directory for repo-wide invariants. Do not "fix" this into the
 * split; `tests/f3.37-asset-role-vocabulary.test.ts` is the direct model and
 * `tests/f3.1a-dashboard-schema.test.ts` is the other.
 *
 * **What is NOT tested here, and why.** The seeded section rows' *contents* are
 * rows, so a list asserted here would be a copy of `0056` — the duplication
 * `adr-0034`'s header rules out. The six-row count belongs to the §4.6 database
 * check. What remains checkable from the repo is the *shape* nobody should
 * quietly change back.
 *
 * **`tests/adr-0043-tenant-columns.test.ts` is deliberately NOT edited for
 * either new table**, and that is a decision rather than an omission (ADR 0049
 * Amendment 2 Consequences). Its `TENANT_TABLES` and `NO_COLUMN` lists are both
 * scanned against migration **0046**'s text, so a table born in `0056` cannot
 * appear in either — adding `dashboard_templates` to `TENANT_TABLES` would fail
 * its `ADD COLUMN organization_id` assertion, because `0046` has never heard of
 * the table. This file is the gate for `0056`.
 */
const MIGRATION_PREFIX = "0056_";
const JOURNAL_REL = "packages/db/drizzle/meta/_journal.json";

/**
 * Comments stripped. `f3.1a` learned this the hard way: `RESET ROLE;` in a
 * header *comment* kept a `toContain` green after the statement itself was
 * deleted. Every assertion about a statement reads this, never the raw text —
 * and this migration's header quotes most of what is asserted below.
 */
const sqlOnly = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

/** One table's `CREATE TABLE …( … );` body, so a per-table assertion cannot be
 * satisfied by a neighbour's column. */
const tableBlock = (migration: string, table: string): string => {
  const start = migration.indexOf(`CREATE TABLE IF NOT EXISTS bms.${table} (`);
  if (start < 0) throw new Error(`no CREATE TABLE for bms.${table}`);
  const end = migration.indexOf("\n);", start);
  if (end < 0) throw new Error(`unterminated CREATE TABLE for bms.${table}`);
  return migration.slice(start, end + 3);
};

/**
 * One `CREATE POLICY … ON bms.<table> …;` statement, so the two-leg count below
 * cannot be satisfied by a neighbouring table's policy. Ends at the next
 * top-level `ALTER TABLE` / `CREATE` / `DROP`, or at the end of the file.
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

describe("F3.36 — migration 0056 exists", () => {
  it("0056_*.sql is present in packages/db/drizzle", () => {
    expect(
      migration,
      "0056_*.sql not found. Part A writes it before this suite goes green; 0051-0055 " +
        "are committed and frozen by the pre-commit hook, so the next number is 0056.",
    ).not.toBeNull();
  });
});

describe("F3.36 dashboard templates (ADR 0049 decision 1, Amendment 1 decision 3)", () => {
  const sql = sqlOnly(migration ?? "");

  /**
   * **The half of the ADR's "Two migrations" bullet that is TRUE.**
   *
   * ADR 0049's Consequences says of the two migrations it schedules: "Both
   * forward-only and both tenant-scoped in the migration that creates them."
   * Amendment 1 records that the sentence is false for `bms.asset_roles` and
   * **holds in full for this table** (Amendment 1 decision 3).
   */
  it("creates bms.dashboard_templates TENANT-SCOPED — organization_id, ENABLE, FORCE, policy", () => {
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS bms.dashboard_templates (");

    const block = tableBlock(sql, "dashboard_templates");
    expect(
      block,
      "bms.dashboard_templates must carry organization_id NOT NULL REFERENCES " +
        "bms.organizations(id) in the migration that creates it. ADR 0043/0045 and " +
        "ADR 0049 Amendment 1 decision 3 — E7.1b's 0046/0047 are the recorded cost of " +
        "retrofitting this instead.",
    ).toMatch(/organization_id\s+uuid\s+NOT NULL\s+REFERENCES bms\.organizations\(id\)/i);

    expect(
      /ALTER TABLE bms\.dashboard_templates ENABLE ROW LEVEL SECURITY/i.test(sql),
      "bms.dashboard_templates has no ENABLE ROW LEVEL SECURITY.",
    ).toBe(true);
    expect(
      /ALTER TABLE bms\.dashboard_templates FORCE ROW LEVEL SECURITY/i.test(sql),
      "bms.dashboard_templates has ENABLE without FORCE. ENABLE alone exempts the table " +
        "owner, and bms_owner IS the owner, so the policy would be decorative for the " +
        "one role that matters — the exact defect ADR 0045 exists for (F4.16's FORCE was " +
        "a no-op while bms_app owned the schema).",
    ).toBe(true);
    expect(sql).toContain("CREATE POLICY tenant_isolation ON bms.dashboard_templates");
  });

  /**
   * **The half that is FALSE, held one table over.**
   *
   * `tests/f3.37-asset-role-vocabulary.test.ts` assertion 1 fails the build if
   * `bms.asset_roles` gains an `organization_id`, an RLS flip or a policy. This
   * is the mirror for the second global vocabulary, required by Amendment 2's
   * Consequences: without it `0056` creates one tenant-scoped table and one
   * global table side by side with a gate on only the first, and the next
   * reader cannot tell the global one was deliberate.
   */
  it("creates bms.dashboard_sections GLOBAL — no organization_id, no RLS, no policy", () => {
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS bms.dashboard_sections (");

    const block = tableBlock(sql, "dashboard_sections");
    expect(
      block.includes("organization_id"),
      "bms.dashboard_sections gained an organization_id. It is a GLOBAL vocabulary, the " +
        "sixth of the class migration 0047 deliberately left alone (asset_domains, " +
        "rule_categories, alarm_severities, alarm_skills, and asset_roles since 0051). " +
        "ADR 0049 Amendment 2 decision 5 applies Amendment 1 decision 2(b) to this " +
        "vocabulary: decision 3's stock catalog only works if a SECTION code means the " +
        "same thing in every organization. A nullable organization_id is the shape " +
        "decision 3 rejected outright on E7.1c and ADR 0043 Amendment 5.",
    ).toBe(false);

    const rlsOnSections = /ALTER TABLE bms\.dashboard_sections[\s\S]{0,120}ROW LEVEL SECURITY/i;
    expect(
      rlsOnSections.test(sql),
      "migration 0056 enables row-level security on bms.dashboard_sections. It is a " +
        "global vocabulary — see above.",
    ).toBe(false);
    // Anti-vacuity: the regex must be capable of matching.
    expect(
      rlsOnSections.test("ALTER TABLE bms.dashboard_sections ENABLE ROW LEVEL SECURITY;"),
    ).toBe(true);

    const policyOnSections = /CREATE POLICY[\s\S]{0,200}bms\.dashboard_sections/i;
    expect(
      policyOnSections.test(sql),
      "migration 0056 creates a policy naming bms.dashboard_sections. It is global.",
    ).toBe(false);
    expect(
      policyOnSections.test("CREATE POLICY tenant_isolation ON bms.dashboard_sections"),
    ).toBe(true);
  });

  /**
   * Amendment 2 decision 5: the plant-domain vocabulary does not move. The
   * recommendation at the gate was to extend it with `stp`, `etp` and
   * `sustainability`; the owner declined it in favour of the separate table, so
   * every existing plant-domain picker — `assets`, `asset_templates`, the rules
   * surface — is untouched by this row.
   */
  it("does not touch bms.asset_domains", () => {
    const touchesDomains = /(?:INSERT INTO|ALTER TABLE)\s+bms\.asset_domains/i;

    expect(
      touchesDomains.test(sql),
      "migration 0056 reaches for bms.asset_domains. ADR 0049 Amendment 2 decision 5 " +
        "keeps that vocabulary at five codes and closes dashboard_templates.section with " +
        "the new global bms.dashboard_sections table instead, precisely so the " +
        "plant-domain picker does not change for every organization — the product " +
        "decision migration 0051's header refused to take alone.",
    ).toBe(false);
    // Anti-vacuity twin.
    expect(touchesDomains.test("INSERT INTO bms.asset_domains (code) VALUES ('stp');")).toBe(
      true,
    );
  });

  /**
   * The section column is closed by a FOREIGN KEY into the lookup table, never
   * by a CHECK — §4.8's test as ADR 0032 rewrote it, the same way `0051` closed
   * the role column. A section's behaviour is "group these templates", which is
   * the code itself, so a section declared by an INSERT arrives fully
   * functional.
   */
  it("closes dashboard_templates.section with a foreign key, never a CHECK", () => {
    expect(sql).toContain("REFERENCES bms.dashboard_sections(code)");

    const checkOnSection = /CHECK\s*\(\s*section\s+IN/i;
    expect(
      checkOnSection.test(sql),
      "migration 0056 closes section with a CHECK. ADR 0049 Amendment 2 decision 5 makes " +
        "it a lookup table, as ADR 0031/0032 ruled for rule categories and alarm " +
        "severities and as 0051 ruled for roles. A CHECK would need a migration to add a " +
        "seventh section, which is exactly what Sheet 04's 'adding a seventh is " +
        "configuration, not a release' refuses.",
    ).toBe(false);
    expect(checkOnSection.test("CHECK (section IN ('electrical'))")).toBe(true);
  });

  /**
   * **The leg that ships a hole if it is skipped.**
   *
   * `0050`'s header records the finding, proved on the running stack by that
   * item's security review rather than reasoned about: "Postgres runs a
   * referential-integrity check with row security OFF, so a foreign key never
   * consults the parent's policy. As `bms_tenant` with the ESKOM tenant set, an
   * ESKOM-stamped `dashboard_widget_points` row bound a PHEWB `asset_points` id
   * and the INSERT succeeded." `dashboards`' `location_id` and `asset_group_id`
   * legs exist because of that. A `template_id` with no leg re-opens it one
   * column over.
   */
  it("re-creates the bms.dashboards policy with a template_id parent leg, in BOTH halves", () => {
    expect(
      sql,
      "0056 adds dashboards.template_id without re-creating the tenant_isolation policy. " +
        "The policy is replaced, not altered: DROP POLICY IF EXISTS then CREATE (0050's " +
        "idiom).",
    ).toContain("DROP POLICY IF EXISTS tenant_isolation ON bms.dashboards");

    const block = policyBlock(sql, "dashboards");

    expect(
      countOf(block, "bms.dashboard_templates t"),
      "the rewritten bms.dashboards policy must check the template parent in USING AND in " +
        "WITH CHECK — twice. 0047 section 3c's rule: check every org-bearing parent with " +
        "an EXISTS in both halves. USING alone leaves a cross-org write unrefused.",
    ).toBe(2);
    expect(
      countOf(block, "t.organization_id = nullif(current_setting('app.current_organization', true), '')::uuid"),
      "the template leg must compare the parent's organization_id to the current org " +
        "EXPLICITLY, not lean on bms.dashboard_templates' own policy to filter the " +
        "subquery. That is 0047 section 3c's rule, and it is what makes this correct " +
        "under bms_owner, which is FORCE-bound but filtered differently from bms_tenant.",
    ).toBe(2);

    // The rewrite must not quietly drop the two legs 0050 already shipped.
    expect(
      countOf(block, "bms.locations l"),
      "the rewritten policy dropped the location_id parent leg 0050 shipped.",
    ).toBe(2);
    expect(
      countOf(block, "bms.asset_groups g"),
      "the rewritten policy dropped the asset_group_id parent leg 0050 shipped.",
    ).toBe(2);
    expect(
      countOf(
        block,
        "organization_id = nullif(current_setting('app.current_organization', true), '')::uuid",
      ),
      "the rewritten policy dropped the own-column check.",
    ).toBeGreaterThanOrEqual(2);
  });

  /**
   * Amendment 1 decision 1: `bms.asset_roles` is global and `F3.36` does not
   * touch it. The amendment exists because a review of `F3.37` predicted this
   * exact failure path — an implementer reading the ADR's original "both
   * tenant-scoped" bullet and adding organization_id to it in 0056.
   */
  it("names bms.asset_roles in no DDL at all", () => {
    const touchesRoles = /(?:ALTER|CREATE|DROP)\s+(?:TABLE|POLICY|INDEX)[\s\S]{0,120}asset_roles/i;

    expect(
      touchesRoles.test(sql),
      "migration 0056 issues DDL against bms.asset_roles. ADR 0049 Amendment 1 decision " +
        "1: it is a GLOBAL vocabulary and F3.36 does not touch it. The amendment exists " +
        "because F3.37's review predicted exactly this — an implementer following the " +
        "ADR's original 'both tenant-scoped' Consequences bullet as written.",
    ).toBe(false);
    // Anti-vacuity twin.
    expect(
      touchesRoles.test("ALTER TABLE bms.asset_roles ADD COLUMN organization_id uuid;"),
    ).toBe(true);
  });

  /**
   * Load-bearing here for the reason `0051`'s header spells out: not
   * `FORCE ROW LEVEL SECURITY`, but `0041`:112-113's
   * `ALTER DEFAULT PRIVILEGES FOR ROLE bms_owner`, which fires only for objects
   * created by the role it names. `pnpm db:migrate` connects as `bms_app`.
   */
  it("brackets the migration in SET ROLE bms_owner / RESET ROLE", () => {
    expect(
      sql.includes("SET ROLE bms_owner;"),
      "migration 0056 lost its SET ROLE bms_owner. Without it both new tables are owned " +
        "by bms_app, 0041's default privileges never fire, and bms_tenant cannot read " +
        "them — a failure 0039 records as surfacing 'one endpoint at a time'.",
    ).toBe(true);
    expect(
      sql.includes("RESET ROLE;"),
      "migration 0056 lost its RESET ROLE. 0041's comment records that a leaked SET ROLE " +
        "reaches the drizzle migrator's own journal write and every later migration in " +
        "the same run.",
    ).toBe(true);
  });

  /**
   * Two stamps, two columns, two reasons — ADR 0049 decision 2 (the instance
   * records the template version it came from) and decision 3 (the imported row
   * records the stock version it came from). Collapsing them loses the
   * distinction the moment an organization edits an imported template.
   */
  it("carries both version stamps: dashboards.template_id and dashboard_templates.stock_version", () => {
    expect(
      /ALTER TABLE bms\.dashboards[\s\S]{0,200}ADD COLUMN\s+(?:IF NOT EXISTS\s+)?template_id/i.test(
        sql,
      ),
      "bms.dashboards gains no template_id. ADR 0049 decision 2: every dashboard " +
        "instantiated from a template records the template version it came from, and " +
        "without the stamp nobody can tell which plants are running the previous one.",
    ).toBe(true);

    const block = tableBlock(sql, "dashboard_templates");
    expect(
      block.includes("stock_code") && block.includes("stock_version"),
      "bms.dashboard_templates carries no stock stamp. ADR 0049 decision 3: an import " +
        "records which stock version it came from, so 'a plant onboarded later receives " +
        "the stock current at its import' is answerable from the row.",
    ).toBe(true);
  });

  it("journals migration 0056 so drizzle does not silently skip it", () => {
    expect(
      read(JOURNAL_REL).includes("0056_dashboard_templates"),
      "migration 0056 has no journal entry. Drizzle skips an unjournalled .sql file " +
        "without a word, so db:migrate would pass with the schema short two tables — " +
        "exactly how 0018/0021/0022 reached main without creating bms.point_keys.",
    ).toBe(true);
  });
});

/**
 * Cheap belt to the pre-commit hook's braces. A committed migration is frozen
 * even before it merges, so `F3.36` writes `0056` rather than editing `0055`.
 */
describe("F3.36 — the committed migrations stay frozen", () => {
  const FROZEN: ReadonlyArray<readonly [string, string]> = [
    ["0051_asset_role_vocabulary.sql", "-- F3.37 / ADR 0049 decision 5 — the asset role vocabulary."],
    [
      "0052_health_in_range_counters.sql",
      "-- ADR 0050 + Amendment 1 — the in-range counter behind the asset health score (E1.3).",
    ],
    [
      "0053_health_unevaluated_is_zero.sql",
      "-- ADR 0050 + Amendment 1 decision 7 (E1.3) — enforce what 0052's header only claimed.",
    ],
    [
      "0054_dashboard_widget_sources.sql",
      "-- F3.35 Stage C / ADR 0048 decision 4 — the fourth dashboard table.",
    ],
    [
      "0055_dashboard_widget_table_type.sql",
      "-- F3.35 Stage B / ADR 0048 decision 5 — the fifth widget type.",
    ],
  ];

  it.each(FROZEN)("%s is unchanged", (file, firstLine) => {
    const path = join(drizzleDir, file);
    expect(existsSync(path), `${file} is missing — a committed migration was renamed.`).toBe(
      true,
    );
    expect(
      readFileSync(path, "utf8").split("\n")[0],
      `${file} was edited. Migrations are forward-only and a committed one is frozen even ` +
        `before it merges (§4.4, and the pre-commit hook is the real gate). Write the next ` +
        `migration instead, with a DO block for idempotency.`,
    ).toBe(firstLine);
  });
});

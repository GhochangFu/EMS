import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

/**
 * `F3.37` / ADR 0049 decision 5 — the asset role vocabulary.
 *
 * **Assertions inline, no `.spec` sibling.** §4.6 carves out the top-level
 * `tests/` directory for repo-wide invariants. Do not "fix" this into the
 * split; `tests/f3.1a-dashboard-schema.test.ts` and
 * `tests/adr-0034-alarm-skill-vocabulary.test.ts` are the models.
 *
 * **What is NOT tested here, and why: the vocabulary's contents.** They are
 * rows, so a list asserted here would be a copy of migration `0051` — exactly
 * the duplication this design removes (`adr-0034`'s header states the rule).
 * The 26-row count belongs to the §4.6 database check. What remains checkable
 * from the repo is the *shape* nobody should quietly change back.
 */
const MIGRATION_REL = "packages/db/drizzle/0051_asset_role_vocabulary.sql";
const OPERATIONS_REL = "packages/shared/src/contracts/operations.ts";
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

describe("F3.37 asset role vocabulary (ADR 0049 decision 5)", () => {
  const migration = read(MIGRATION_REL);
  const sql = sqlOnly(migration);

  /**
   * **This is the only gate on the ADR-Consequences ambiguity.**
   *
   * ADR 0049's Consequences says of the two migrations it schedules: "Both
   * forward-only and both tenant-scoped in the migration that creates them."
   * That sentence is true of `F3.36`'s `bms.dashboard_templates` and false of
   * this table, and the difference was ruled at the `F3.37` plan gate on
   * 2026-08-30. Nothing else in the repository holds it.
   */
  it("creates bms.asset_roles as a GLOBAL table — no organization_id, no RLS, no policy", () => {
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS bms.asset_roles (");

    const block = tableBlock(sql, "asset_roles");
    expect(
      block.includes("organization_id"),
      "bms.asset_roles gained an organization_id. It is a GLOBAL vocabulary, the fifth " +
        "of the class migration 0047 deliberately left alone (asset_domains, " +
        "rule_categories, alarm_severities, alarm_skills all lack RLS there). ADR 0049 " +
        "decision 3's stock dashboard catalog only works if a role code means the same " +
        "thing in every organization, and a nullable organization_id is the shape that " +
        "decision rejected outright on E7.1c and ADR 0043 Amendment 5.",
    ).toBe(false);

    expect(
      /ENABLE ROW LEVEL SECURITY/i.test(sql),
      "migration 0051 enables row-level security. bms.asset_roles is global — see above.",
    ).toBe(false);
    expect(
      /CREATE POLICY[\s\S]{0,200}asset_roles/i.test(sql),
      "migration 0051 creates a policy naming asset_roles. It is a global vocabulary.",
    ).toBe(false);
  });

  /**
   * The bracket is load-bearing here for a reason that is easy to miss: not
   * `FORCE ROW LEVEL SECURITY` (there is none), but `0041`'s
   * `ALTER DEFAULT PRIVILEGES FOR ROLE bms_owner`, which fires only for
   * objects created by the role it names.
   */
  it("brackets the migration in SET ROLE bms_owner / RESET ROLE", () => {
    expect(
      sql.includes("SET ROLE bms_owner;"),
      "migration 0051 lost its SET ROLE bms_owner. 0041:112-113 grants the pool roles " +
        "through ALTER DEFAULT PRIVILEGES FOR ROLE bms_owner, which applies only to " +
        "objects that role creates. db:migrate connects as bms_app, so without this the " +
        "table is owned by bms_app, the grant never fires, and bms_tenant cannot read " +
        "it — a failure 0039 records as surfacing 'one endpoint at a time', which here " +
        "means inside F3.36, long after this file.",
    ).toBe(true);
    expect(
      sql.includes("RESET ROLE;"),
      "migration 0051 lost its RESET ROLE. 0041's comment records that a leaked SET " +
        "ROLE reaches the drizzle migrator's own journal write and every later " +
        "migration in the same run.",
    ).toBe(true);
  });

  it("adds no organization_id to the asset_group_members junction", () => {
    expect(
      /ALTER TABLE bms\.asset_group_members[\s\S]{0,120}organization_id/i.test(sql),
      "migration 0051 adds organization_id to the junction. 0046's own text names " +
        "junctions as deliberately column-free, tests/adr-0043-tenant-columns.test.ts " +
        "asserts it, and 0047 lines 223-240 already police the table through BOTH " +
        "parents with FORCE.",
    ).toBe(false);
  });

  it("closes the role column with a foreign key, never a CHECK", () => {
    expect(sql).toContain("REFERENCES bms.asset_roles(code)");
    expect(
      /CHECK\s*\(\s*role\s+IN/i.test(sql),
      "migration 0051 closes role with a CHECK. §4.8's test as ADR 0032 rewrote it asks " +
        "whether the behaviour can be carried as data: a role's behaviour is 'match this " +
        "member', which IS the code, so a role declared by an INSERT arrives fully " +
        "functional. Lookup table + foreign key, as ADR 0031/0032 ruled — not ADR 0047 " +
        "decision 2's shape.",
    ).toBe(false);
  });

  /**
   * The reason lives in the failure message on purpose: a future reader
   * finding no unique index will otherwise assume it was an oversight.
   */
  it("puts NO unique index on (asset_group_id, role)", () => {
    const uniqueOnJunction = /CREATE UNIQUE INDEX[\s\S]{0,200}asset_group_members/i;

    expect(
      uniqueOnJunction.test(sql),
      "migration 0051 makes the group/role pair unique. That is not an oversight to " +
        "correct — it is the decision. The client mock's own nodes are plural ('HT " +
        "Panels 2 · all good', 'Chillers 2 of 3', 'Primary Pumps 3 running', one " +
        "Utilities node covering DG/UPS/Solar), and WIDGET_POINT_CARDINALITY already " +
        "ships chart: { min: 1, max: MAX_WIDGET_POINTS }. ADR 0049 decision 4 rejected " +
        "binding an asset TYPE because the WIDGET count would vary; one role still maps " +
        "to one widget however many members match. Migrations are forward-only, so " +
        "adding and dropping this costs two files and an explanation.",
    ).toBe(false);

    // Anti-vacuity: the regex must be capable of matching, or the assertion
    // above would pass on a typo forever (`adr-0034` does the same).
    expect(
      uniqueOnJunction.test(
        "CREATE UNIQUE INDEX foo ON bms.asset_group_members (asset_group_id, role);",
      ),
    ).toBe(true);
  });

  it("declares assetRoleCodeSchema as data, not an enum, in the contracts package", () => {
    const operations = read(OPERATIONS_REL);
    const enumRevert = /\bassetRoleCodeSchema\s*=\s*z\.enum\(/;

    expect(
      enumRevert.test(operations),
      "operations.ts declares assetRoleCodeSchema as a z.enum. The set is closed by " +
        "bms.asset_roles and asset_group_members_role_fkey, not by that file, and " +
        "VocabulariesService.assertAssetRole is the boundary that turns an unknown code " +
        "into a 400. This guards the revert: pasting the 26 seeded codes back in " +
        "because fetching them felt inconvenient.",
    ).toBe(false);

    // Anti-vacuity twin.
    expect(enumRevert.test('export const assetRoleCodeSchema = z.enum(["chiller"]);')).toBe(true);

    // And it must still be *declared*, or the assertion above passes because
    // the symbol was renamed out from under it.
    expect(operations).toContain("assetRoleCodeSchema");
  });

  /**
   * The `F4.43` guard, in its source form.
   *
   * A `<select>` whose value matches no option renders its **first** option, so
   * a hardcoded list falling behind `bms.asset_roles` does not look broken — it
   * looks like a different value. `tests/rule-vocabulary.test.ts` and
   * `tests/adr-0034-alarm-skill-vocabulary.test.ts` guard the same construct
   * for the other vocabularies. The component test asserts the rendered
   * options come from a stub; this asserts the source never grew a literal.
   */
  it("builds the role picker from the vocabulary fetch, not from literal options", () => {
    const page = read("apps/web/src/pages/admin/asset-groups-page.tsx");

    expect(page).toContain("fetchVocabularies");
    expect(page).toContain("vocabulariesQueryKey");

    // The only literal <option> permitted is the empty "no role" one — a role
    // code spelled into the markup is the regression.
    const literalOptions = [...page.matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]);
    expect(
      literalOptions.filter((value) => value !== ""),
      "asset-groups-page.tsx spells a role code into an <option>. The set lives in " +
        "bms.asset_roles and arrives through GET /api/v1/vocabularies; a hardcoded list " +
        "that falls behind renders the FIRST option for an unknown value, which looks " +
        "like a different role rather than like a bug. That is F4.43.",
    ).toEqual([]);
  });

  it("journals migration 0051 so drizzle does not silently skip it", () => {
    expect(
      read(JOURNAL_REL).includes("0051_asset_role_vocabulary"),
      "migration 0051 has no journal entry. Drizzle skips an unjournalled .sql file " +
        "without a word, so db:migrate would pass with the schema short a table — " +
        "exactly how 0018/0021/0022 reached main without creating bms.point_keys.",
    ).toBe(true);
  });
});

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

/**
 * Strip `--` comment lines before a NEGATIVE scan.
 *
 * Written after this test failed on its own subject's documentation: migration `0050`'s header
 * explains *why* it uses no `CREATE INDEX CONCURRENTLY`, and a raw-text scan matched the
 * explanation. A negative assertion that a comment can trip is one that punishes the migration
 * for saying what it does — so it would be silenced by deleting the comment, which is the
 * opposite of what this repository wants. `tests/adr-0030-contract-derivation.test.ts` skips
 * comment lines for the same reason.
 *
 * Positive assertions keep the raw text: a `toContain` cannot be satisfied by a comment that
 * happens to quote the statement, because the statement has to be there too.
 */
const sqlOnly = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

const MIGRATION_REL = "packages/db/drizzle/0050_configurable_dashboard_tables.sql";
const CONTRACT_REL = "packages/shared/src/contracts/dashboard-builder.ts";

/** The three tables migration 0050 creates, all tenant-scoped from birth (ADR 0047 decision 5). */
const TABLES = ["dashboards", "dashboard_widgets", "dashboard_widget_points"] as const;

/**
 * The widget vocabulary, closed by ADR 0047 decision 2. Pinned here as well as in the
 * contract's own spec because the `CHECK` and the `z.enum` are two declarations of one
 * vocabulary and drift between them is exactly the `F4.43` failure — a value the database
 * accepts that the renderer cannot draw.
 */
const WIDGET_TYPES = ["radial_gauge", "tank_level", "value_tile", "chart"] as const;

/**
 * F3.1a — the static half of the schema guarantees.
 *
 * Static rather than behavioural, deliberately, and §4.4's rule is why: "when a guarantee
 * cannot be a behavioural test, write a static one and say which it is". Three of these
 * cannot be observed by any query against a migrated database.
 *
 *  - The `SET ROLE bms_owner` bracket. Its absence is invisible in `\d`: the tables exist and
 *    look correct, they are simply owned by `bms_app`, so `0041`'s `ALTER DEFAULT PRIVILEGES`
 *    never fires and no pool role can reach them. `0039`'s own comment records that this
 *    surfaces "one endpoint at a time" — inside `F3.1b`, long after the migration that caused
 *    it. The live suite asserts the *consequence* (`has_table_privilege`); this asserts the
 *    cause.
 *  - `CREATE INDEX CONCURRENTLY`. It cannot run inside a transaction block and the drizzle
 *    migrator wraps every file, so the failure is a migration that will not apply — which a
 *    test against an already-migrated database never reaches.
 *  - The journal entry. A migration file with no journal row is silently never run.
 *
 * The rest are pinned by *name* rather than only by behaviour so that `\d` and this file
 * describe the same objects, following the `alarm_severities_rank_key` precedent in
 * `packages/db/src/schema/bms-schema.ts:184-186`: an unnamed constraint gets a derived name,
 * and then the schema file and the database describe one object under two names.
 */
describe("F3.1a — configurable dashboard schema (migration 0050)", () => {
  it("registers migration 0050 in the journal", () => {
    expect(existsSync(join(repoRoot, MIGRATION_REL)), `${MIGRATION_REL} must exist`).toBe(true);

    const journal = JSON.parse(read("packages/db/drizzle/meta/_journal.json")) as {
      entries: Array<Record<string, unknown>>;
    };

    expect(
      journal.entries.find((entry) => entry.tag === "0050_configurable_dashboard_tables"),
      "migration 0050 must have a journal entry, or drizzle never runs it",
    ).toEqual({
      idx: 50,
      version: "7",
      when: 1788006783386,
      tag: "0050_configurable_dashboard_tables",
      breakpoints: true,
    });
  });

  it("is not scanning an empty or misnamed file", () => {
    // Every assertion below is `toContain` or `toMatch` over one string. Against an empty
    // string a `.not.toMatch` passes and a typo'd filename would therefore go green on the
    // negative assertions alone. ADR 0025's row records this class: a test that agrees with
    // whatever it finds is not a gate.
    const migration = read(MIGRATION_REL);
    expect(migration.length).toBeGreaterThan(1500);
    for (const table of TABLES) {
      expect(migration, `${table} must be created by this migration`).toContain(
        `CREATE TABLE IF NOT EXISTS bms.${table}`,
      );
    }
  });

  it("brackets the whole migration in SET ROLE bms_owner / RESET ROLE", () => {
    const migration = read(MIGRATION_REL);

    // ADR 0045 decision 6. Load-bearing twice here: FORCE ROW LEVEL SECURITY requires table
    // ownership, and `0041:112-119`'s ALTER DEFAULT PRIVILEGES FOR ROLE bms_owner grants to
    // bms_tenant/bms_fleet only for objects *that role* creates. pnpm db:migrate connects as
    // DATABASE_URL_SUPERUSER (bms_app), so without this the three tables reach no pool role.
    expect(migration).toContain("SET ROLE bms_owner;");

    // Mandatory, not symmetry: `0041`'s comment records that a leaked SET ROLE reaches the
    // drizzle migrator's own journal write and every later migration in the same run.
    expect(migration).toContain("RESET ROLE;");
  });

  it("never uses CREATE INDEX CONCURRENTLY", () => {
    // The rule E7.1i established, re-asserted here because that test is scoped to migration
    // 0049 by filename and so does not bind this file.
    expect(sqlOnly(read(MIGRATION_REL))).not.toMatch(/CREATE INDEX CONCURRENTLY/i);
  });

  it("gives every table a tenant column, RLS, FORCE, and a strict tenant_isolation policy", () => {
    const migration = read(MIGRATION_REL);

    for (const table of TABLES) {
      expect(migration, `${table} needs organization_id NOT NULL (ADR 0047 decision 5)`).toMatch(
        new RegExp(
          `organization_id uuid NOT NULL REFERENCES bms\\.organizations\\(id\\)[\\s\\S]{0,4000}?CREATE TABLE IF NOT EXISTS bms\\.${table}|CREATE TABLE IF NOT EXISTS bms\\.${table}[\\s\\S]{0,4000}?organization_id uuid NOT NULL REFERENCES bms\\.organizations\\(id\\)`,
        ),
      );

      expect(migration).toContain(`ALTER TABLE bms.${table} ENABLE ROW LEVEL SECURITY;`);

      // ENABLE alone exempts the table owner, and bms_owner is the owner — so without FORCE
      // the policy is decorative for the one role that matters. This is the defect ADR 0045
      // was written for: F4.16's FORCE was a no-op while bms_app owned the schema.
      expect(migration).toContain(`ALTER TABLE bms.${table} FORCE ROW LEVEL SECURITY;`);

      expect(migration).toContain(`DROP POLICY IF EXISTS tenant_isolation ON bms.${table};`);
      expect(migration).toContain(`CREATE POLICY tenant_isolation ON bms.${table}`);
    }

    // USING and WITH CHECK must be the identical strict predicate. Read and write have to
    // agree: a read-only predicate leaves the write path open, which is the shape E7.1c found
    // — "the grant was not the hole, the policy disjunct was".
    const predicate =
      "organization_id = nullif(current_setting('app.current_organization', true), '')::uuid";
    expect(
      sqlOnly(migration).split(predicate).length - 1,
      "each of the three policies needs the predicate twice — once USING, once WITH CHECK",
    ).toBe(TABLES.length * 2);
  });

  it("admits no NULL-organization disjunct in any policy", () => {
    // All three tables are organization_id NOT NULL, so unlike bms.users, bms.audit_log and
    // bms.notification_channels there is no legitimate fleet-owned row to admit. `0047`'s §3b
    // idiom and `0048`'s Amendment 5 role-scoped NULL branch both exist for tables that have
    // one; copying either here by habit would open a hole with nothing behind it.
    expect(sqlOnly(read(MIGRATION_REL))).not.toMatch(/organization_id IS NULL/i);
  });

  it("closes the widget vocabulary to exactly the four ADR 0047 types", () => {
    const migration = read(MIGRATION_REL);

    expect(migration).toContain("CONSTRAINT dashboard_widgets_widget_type_check");
    for (const type of WIDGET_TYPES) {
      expect(migration, `${type} must be accepted`).toContain(`'${type}'`);
    }

    // The check names the four and nothing else. A fifth value in the CHECK would be a widget
    // type the database accepts and no component renders — decision 2's whole justification,
    // arriving through the door the constraint exists to hold shut.
    const check = /CONSTRAINT dashboard_widgets_widget_type_check CHECK \(widget_type IN \(([^)]*)\)\)/.exec(
      migration,
    );
    expect(check, "the widget_type CHECK must be an IN list this test can read").not.toBeNull();
    const listed = (check?.[1] ?? "")
      .split(",")
      .map((value) => value.trim().replace(/^'|'$/g, ""))
      .filter(Boolean);
    expect(listed.sort()).toEqual([...WIDGET_TYPES].sort());
  });

  it("names every constraint the schema file and psql must agree on", () => {
    const migration = read(MIGRATION_REL);

    for (const name of [
      // Two scope axes, at most one set. bms.asset_groups.location_id is already NOT NULL, so
      // both set can contradict each other, and a contradiction the database permits is one
      // F3.1b's authorization filter resolves at runtime forever.
      "CONSTRAINT dashboards_scope_check",
      // (organization_id, slug), not a global slug — the `0048` re-keying, applied at birth.
      // A global slug would let the first tenant to create "overview" take it from the rest.
      "CONSTRAINT dashboards_organization_slug_key",
      "CONSTRAINT dashboard_widgets_grid_bounds_check",
      "CONSTRAINT dashboard_widget_points_role_check",
      "CONSTRAINT dashboard_widget_points_widget_point_role_key",
    ]) {
      expect(migration, `${name} must be named, not derived`).toContain(name);
    }

    // The slug key is composite. A bare UNIQUE (slug) is the locations.slug shape, which
    // predates multi-tenancy and is the specific mistake this row must not copy.
    expect(migration).toMatch(
      /CONSTRAINT dashboards_organization_slug_key UNIQUE \(\s*organization_id,\s*slug\s*\)/,
    );
  });

  it("bounds the grid to a 12-column canvas", () => {
    const migration = read(MIGRATION_REL);
    expect(migration).toMatch(/grid_x \+ grid_w <= 12/);
    expect(migration).toMatch(/grid_x >= 0/);
    expect(migration).toMatch(/grid_w >= 1/);
    expect(migration).toMatch(/grid_y >= 0/);
    expect(migration).toMatch(/grid_h >= 1/);
    expect(migration).toMatch(/grid_h <= 24/);
  });

  it("keeps point bindings as foreign keys, not as ids inside JSON", () => {
    const migration = read(MIGRATION_REL);

    // The entire argument of ADR 0047 decision 3. A point id in a jsonb blob is not a foreign
    // key and nothing reports it orphaned; ADR 0019 had to hand-build that check precisely
    // because content is jsonb, and there the cost was a stale template where here it is a
    // broken page in front of an operator.
    expect(migration).toMatch(
      /point_id uuid NOT NULL REFERENCES bms\.asset_points\(id\) ON DELETE CASCADE/,
    );
    expect(migration).toMatch(
      /dashboard_id uuid NOT NULL REFERENCES bms\.dashboards\(id\) ON DELETE CASCADE/,
    );
    expect(migration).toMatch(
      /widget_id uuid NOT NULL REFERENCES bms\.dashboard_widgets\(id\) ON DELETE CASCADE/,
    );
  });

  it("creates the four indexes, each with a read behind it", () => {
    const migration = read(MIGRATION_REL);
    for (const index of [
      "dashboard_widgets_dashboard_idx",
      "dashboard_widget_points_widget_idx",
      // Without this one the ON DELETE CASCADE from bms.asset_points sequential-scans, and
      // "which dashboards use this point" is unanswerable.
      "dashboard_widget_points_point_idx",
    ]) {
      expect(migration).toContain(`CREATE INDEX IF NOT EXISTS ${index}`);
    }

    // No index on bms.dashboards: dashboards_organization_slug_key already leads with
    // organization_id, so the tenant-filtered list read is served by it. Recorded as a
    // decision rather than left as an absence a later reader reads as an oversight.
    expect(migration).not.toMatch(/CREATE INDEX IF NOT EXISTS dashboards_organization_idx/);
  });
});

/**
 * The contract's encoding, scanned locally rather than added to
 * `tests/adr-0030-contract-derivation.test.ts`'s global ban list.
 *
 * Two constraints close both DRY routes for the config union at once, from different
 * directions, and a reader who knows only one will "fix" the repetition and break the other:
 *
 *  1. ADR 0030 Amendment 1 bans the flattening combinators inside `contracts/` — they produce
 *     a type assignable to the intersection that is not it.
 *  2. `z.discriminatedUnion` accepts only `ZodObject` arms, so `z.intersection` — the encoding
 *     §4.8 *prescribes* for `A & B` — cannot build an arm either.
 *
 * The legal answer is a plain object of field schemas spread into each arm. Widening the
 * global scan to cover `.extend(` would be scope creep and could redden existing files;
 * asserting it for this one file is bounded and honest.
 */
describe("F3.1a — the widget contract's encoding", () => {
  it("discriminates on widgetType and flattens nothing", () => {
    expect(existsSync(join(repoRoot, CONTRACT_REL)), `${CONTRACT_REL} must exist`).toBe(true);
    const source = read(CONTRACT_REL);

    expect(source).toContain('z.discriminatedUnion("widgetType"');

    const code = source
      .split("\n")
      .filter((line) => {
        const trimmed = line.trim();
        return !(trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*"));
      })
      .join("\n");

    expect(code, "a flattened schema is assignable to the intersection and is not it").not.toMatch(
      /\.merge\s*\(/,
    );
    expect(code).not.toMatch(/\.omit\s*\([^)]*\)\s*\.extend\s*\(/);
    expect(code).not.toMatch(/\.extend\s*\(/);
  });
});

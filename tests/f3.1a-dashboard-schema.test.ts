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
 * **A positive assertion needs it too, and the first draft of this file got that wrong.** The
 * sentence here used to read "a `toContain` cannot be satisfied by a comment that happens to
 * quote the statement, because the statement has to be there too". That is false, and this
 * item's correctness review measured it: `RESET ROLE;` occurs twice in the raw migration —
 * once as the statement, once inside the header comment explaining why it is mandatory — so
 * deleting the statement left the assertion green. Nothing else covered it, because the
 * integration suite's `pg_get_userbyid(relowner)` proves `SET ROLE` *fired*, never that it was
 * *released*. Both role assertions now read `sqlOnly()`.
 *
 * A positive assertion may keep the raw text only where a comment could not plausibly quote
 * the thing being asserted.
 */
/** The text of one table's `CREATE POLICY tenant_isolation` statement, terminator included. */
const policyBlock = (migration: string, table: string): string => {
  const start = migration.indexOf(`CREATE POLICY tenant_isolation ON bms.${table}\n`);
  if (start < 0) throw new Error(`no tenant_isolation policy for bms.${table}`);
  const end = migration.indexOf(";\n", start);
  if (end < 0) throw new Error(`unterminated tenant_isolation policy for bms.${table}`);
  return migration.slice(start, end + 1);
};

/** One table's `CREATE TABLE …( … );` body, so a per-table assertion cannot be satisfied by a
 * neighbour's column. */
const tableBlock = (migration: string, table: string): string => {
  const start = migration.indexOf(`CREATE TABLE IF NOT EXISTS bms.${table} (`);
  if (start < 0) throw new Error(`no CREATE TABLE for bms.${table}`);
  const end = migration.indexOf("\n);", start);
  if (end < 0) throw new Error(`unterminated CREATE TABLE for bms.${table}`);
  return migration.slice(start, end + 3);
};

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
    // sqlOnly(), not the raw text: the header quotes both statements while explaining why
    // they are mandatory, so a raw scan is satisfied by the prose alone. Measured — deleting
    // `RESET ROLE;` from the file left the raw assertion green.
    expect(sqlOnly(migration)).toContain("SET ROLE bms_owner;");

    // Mandatory, not symmetry: `0041`'s comment records that a leaked SET ROLE reaches the
    // drizzle migrator's own journal write and every later migration in the same run.
    expect(sqlOnly(migration)).toContain("RESET ROLE;");
  });

  it("never uses CREATE INDEX CONCURRENTLY", () => {
    // The rule E7.1i established, re-asserted here because that test is scoped to migration
    // 0049 by filename and so does not bind this file.
    expect(sqlOnly(read(MIGRATION_REL))).not.toMatch(/CREATE INDEX CONCURRENTLY/i);
  });

  it("gives every table a tenant column, RLS, FORCE, and a strict tenant_isolation policy", () => {
    const migration = read(MIGRATION_REL);

    for (const table of TABLES) {
      // Scoped to this table's OWN block. The first draft allowed the declaration to sit
      // within 4000 characters of the CREATE TABLE, and the review measured a 3600-character
      // gap between `bms.dashboards` and the NEXT table's column — so removing the column from
      // one table was satisfied by its neighbour's.
      expect(
        tableBlock(migration, table),
        `${table} needs organization_id NOT NULL (ADR 0047 decision 5)`,
      ).toContain("organization_id uuid NOT NULL REFERENCES bms.organizations(id)");
      expect(migration).toContain(`ALTER TABLE bms.${table} ENABLE ROW LEVEL SECURITY;`);

      // ENABLE alone exempts the table owner, and bms_owner IS the owner — so without FORCE
      // the policy is decorative for the one role that matters. That is the defect ADR 0045
      // exists for: F4.16's FORCE was a no-op while bms_app owned the schema.
      expect(migration).toContain(`ALTER TABLE bms.${table} FORCE ROW LEVEL SECURITY;`);
      expect(migration).toContain(`DROP POLICY IF EXISTS tenant_isolation ON bms.${table};`);

      expect(migration).toContain(`CREATE POLICY tenant_isolation ON bms.${table}`);
    }
  });

  it("checks every org-bearing parent, not only the row's own column", () => {
    // ADDED AFTER THIS ITEM'S SECURITY REVIEW PROVED THE GAP ON THE RUNNING STACK.
    //
    // Postgres runs a referential-integrity check with row security OFF, so a foreign key
    // never consults the parent's policy. A correctly-stamped row can therefore point at
    // another tenant's parent and be accepted: as `bms_tenant` with the ESKOM GUC set, an
    // ESKOM-stamped `dashboard_widget_points` row bound a PHEWB `asset_points` id and the
    // INSERT succeeded.
    //
    // `bms.asset_group_members` in migration 0047 §3c is the structural twin and already
    // carries the answer — check both org-bearing parents with an EXISTS, in USING and in
    // WITH CHECK, calling it "tighter than keying on one and leaving a cross-org pairing
    // visible". These three tables have a denormalised `organization_id` as well, which makes
    // them LOOK like they meet that standard while enforcing strictly less.
    //
    // Asserted per leg rather than by matching the whole policy verbatim: a verbatim match
    // reddens on any reformatting, and this states what must be TRUE rather than how it is
    // typed.
    const migration = read(MIGRATION_REL);
    const ORG = "nullif(current_setting('app.current_organization', true), '')::uuid";

    const parentChecks: Record<string, Array<[string, string, string]>> = {
      dashboards: [
        ["bms.locations l", "l.id = dashboards.location_id", "l.organization_id"],
        ["bms.asset_groups g", "g.id = dashboards.asset_group_id", "g.organization_id"],
      ],
      dashboard_widgets: [
        ["bms.dashboards d", "d.id = dashboard_widgets.dashboard_id", "d.organization_id"],
      ],
      dashboard_widget_points: [
        ["bms.dashboard_widgets w", "w.id = dashboard_widget_points.widget_id", "w.organization_id"],
        ["bms.asset_points p", "p.id = dashboard_widget_points.point_id", "p.organization_id"],
      ],
    };

    for (const [table, legs] of Object.entries(parentChecks)) {
      const policy = policyBlock(migration, table);

      // The own-column check survives ALONGSIDE the parent checks, not instead of them.
      expect(policy, `${table} must still check its own organization_id`).toContain(
        `organization_id = ${ORG}`,
      );

      for (const [from, join, orgCol] of legs) {
        // Twice — once in USING, once in WITH CHECK. A read-only check leaves the write path
        // open, which is the asymmetry E7.1c found: the grant was not the hole, the policy
        // disjunct was.
        expect(
          policy.split(`SELECT 1 FROM ${from}`).length - 1,
          `${table} must check ${from} in USING and in WITH CHECK`,
        ).toBe(2);
        expect(policy).toContain(join);
        // Written explicitly rather than leaning on the parent's own policy to filter the
        // subquery — 0047 §3c's rule, and what makes it correct under `bms_owner`, which is
        // FORCE-bound but filtered differently from `bms_tenant`.
        expect(policy).toContain(`${orgCol} = ${ORG}`);
      }
    }
  });

  it("admits no fail-open disjunct in any policy", () => {
    const sql = sqlOnly(read(MIGRATION_REL));

    // Shape 1 — the 0047/0048 NULL-org branch. All three tables are `organization_id NOT
    // NULL`, so there is no legitimate fleet-owned row and nothing behind such a disjunct.
    expect(sql).not.toMatch(/organization_id IS NULL/i);

    // Shape 2, and the more dangerous one, because it fails OPEN rather than closed: a policy
    // admitting every row when the GUC is unset. Two other guards look like they would catch
    // it and do not — a disjunct ADDS text rather than changing it, so any occurrence count
    // still passes; and the integration suite never reaches it, because `inTx` always sets the
    // GUC and its no-tenant case sets `''`, so `current_setting` returns the empty string and
    // never NULL.
    expect(sql).not.toMatch(/current_setting\([^()]*\)\s*IS NULL/i);

    // The ONLY `OR` these policies may contain is `<nullable scope> IS NULL OR EXISTS (…)`,
    // which cannot fail open: a NULL scope is an organization-wide dashboard, still gated by
    // the own-column check. Anything else is a widening nobody recorded.
    //
    // Line-scoped on purpose: an unbounded `[^;]*` across a 250-line file backtracks for two
    // minutes and kills the worker, which is how this assertion was first written.
    for (const line of sql.split("\n")) {
      const or = /\bOR\b(.*)$/i.exec(line);
      if (or === null) continue;
      expect(line.trim(), `unexpected OR in a policy: ${line.trim()}`).toMatch(
        /IS NULL OR EXISTS \(SELECT 1/,
      );
    }
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

  it("creates the three explicit indexes, each with a read behind it", () => {
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

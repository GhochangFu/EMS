import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

/**
 * Strip `--` comment lines before a scan, positive or negative.
 *
 * `tests/f3.1a-dashboard-schema.test.ts` records why this is needed in BOTH directions and
 * the reasoning carries over unchanged: migration `0050`'s header explains why it uses no
 * `CREATE INDEX CONCURRENTLY`, and a raw scan matched the explanation; and `RESET ROLE;`
 * occurs twice in that file — once as the statement, once inside the comment saying why it is
 * mandatory — so deleting the statement left a `toContain` green. This migration's header is
 * longer than `0050`'s and quotes more of its own SQL, so the hazard is larger here, not
 * smaller.
 */
const sqlOnly = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

/** The text of the `CREATE POLICY tenant_isolation` statement, terminator included. */
const policyBlock = (migration: string, table: string): string => {
  const start = migration.indexOf(`CREATE POLICY tenant_isolation ON bms.${table}\n`);
  if (start < 0) throw new Error(`no tenant_isolation policy for bms.${table}`);
  const end = migration.indexOf(";\n", start);
  if (end < 0) throw new Error(`unterminated tenant_isolation policy for bms.${table}`);
  return migration.slice(start, end + 1);
};

/** The `CREATE TABLE …( … );` body, so a per-table assertion cannot be satisfied elsewhere. */
const tableBlock = (migration: string, table: string): string => {
  const start = migration.indexOf(`CREATE TABLE IF NOT EXISTS bms.${table} (`);
  if (start < 0) throw new Error(`no CREATE TABLE for bms.${table}`);
  const end = migration.indexOf("\n);", start);
  if (end < 0) throw new Error(`unterminated CREATE TABLE for bms.${table}`);
  return migration.slice(start, end + 3);
};

const MIGRATION_REL = "packages/db/drizzle/0054_dashboard_widget_sources.sql";
const CONTRACT_REL = "packages/shared/src/contracts/dashboard-builder.ts";
const SCHEMA_REL = "packages/db/src/schema/dashboard-schema.ts";
const TABLE = "dashboard_widget_sources";

/**
 * The catalog keys as the contract declares them, parsed from source rather than imported.
 *
 * `tests/f3.35-tile-icon-vocabulary.test.ts` and `tests/f3.37-asset-role-vocabulary.test.ts`
 * both read their vocabulary this way and the reason is the same: files in `tests/` run in the
 * root `repo` Vitest project, which is not any package's project, and a source scan states
 * plainly that this is a cross-file drift gate rather than a use of the value.
 *
 * Throwing rather than returning `[]` is load-bearing. An empty list would make the `.sort()`
 * equality below compare `[]` against `[]` the moment the declaration is renamed, and the gate
 * would go green having read nothing — ADR 0025's recorded class of test that agrees with
 * whatever it finds.
 */
const catalogKeys = (): string[] => {
  const block = /export const metricCatalogKeySchema = z\.enum\(\[([\s\S]*?)\]\)/.exec(
    read(CONTRACT_REL),
  );
  if (block === null) {
    throw new Error(
      `could not find metricCatalogKeySchema's z.enum([...]) in ${CONTRACT_REL}. If it was ` +
        "renamed or reshaped, fix this parser — do not delete the assertion, because the " +
        "CHECK in migration 0054 and that enum are two declarations of one vocabulary.",
    );
  }
  const keys = (block[1] ?? "")
    .split(",")
    .map((line) => line.trim().replace(/^"|"$/g, ""))
    .filter((line) => line.length > 0 && !line.startsWith("//"));
  if (keys.length === 0) throw new Error("metricCatalogKeySchema parsed to an empty list");
  return keys;
};

/**
 * `F3.35` Stage C, Unit 2 — migration `0054_dashboard_widget_sources.sql`, ADR 0048 decision 4.
 *
 * The static half. `tests/f3.35-metric-catalog-schema.integration.test.ts` is the behavioural
 * half, and the split is `F3.1a`'s: three of the guarantees below cannot be observed by any
 * query against an already-migrated database.
 *
 *  - The `SET ROLE bms_owner` bracket. Its absence is invisible in `\d` — the table exists and
 *    looks right, it is simply owned by `bms_app`, so `0041`'s `ALTER DEFAULT PRIVILEGES` never
 *    fires and no pool role can reach it. The live suite asserts the consequence; this asserts
 *    the cause.
 *  - `CREATE INDEX CONCURRENTLY`, which cannot run inside a transaction block while the drizzle
 *    migrator wraps every file — a failure a test against a migrated database never reaches.
 *  - The journal entry. A migration file with no journal row is silently never run.
 *
 * And one that is specific to this unit: that `0054` does **not** widen the widget vocabulary.
 * A `CHECK` that was widened and a `CHECK` that was not look identical from any query that only
 * inserts the four types this repository can currently render.
 */
describe("F3.35 Stage C — bms.dashboard_widget_sources (migration 0054)", () => {
  it("registers migration 0054 in the journal", () => {
    expect(existsSync(join(repoRoot, MIGRATION_REL)), `${MIGRATION_REL} must exist`).toBe(true);

    const journal = JSON.parse(read("packages/db/drizzle/meta/_journal.json")) as {
      entries: Array<Record<string, unknown>>;
    };

    // `0054`, not `0051`. ADR 0048 named `0051` and `F3.37` took that number on the day the ADR
    // was accepted; `E1.3` then took `0052` and `0053`. Errata 1 records the collision and the
    // rule it produced — an ADR names a migration's job, never its number.
    expect(
      journal.entries.find((entry) => entry.tag === "0054_dashboard_widget_sources"),
      "migration 0054 must have a journal entry, or drizzle never runs it",
    ).toEqual({
      idx: 54,
      version: "7",
      when: 1788352383386,
      tag: "0054_dashboard_widget_sources",
      breakpoints: true,
    });

    // The index and the filename are two statements of one number, and drizzle trusts the
    // journal. A file called `0054_*` carrying `idx: 53` would run in the wrong order or not
    // at all, and nothing else in this suite would notice.
    const indexes = journal.entries.map((entry) => entry.idx);
    expect(new Set(indexes).size, "journal indexes must be unique").toBe(indexes.length);

    // A NOTE FOR WHOEVER WRITES `0055`, because the trap is silent from that side.
    //
    // `when: 1788352383386` is 2026-09-02T12:33Z — AHEAD of the wall clock on the day this
    // landed. It continues a synthetic +1 day step from `0053`, and the journal has been
    // drifting forward for several migrations (`0053` was already ~43 h ahead). Only `0054`
    // is this row's to answer for, and correcting it alone would put it BELOW `0053` and
    // break the increasing invariant, so it stands.
    //
    // The consequence: drizzle-kit stamps `when: +new Date()`, and the migrator runs a file
    // only when `folderMillis` exceeds the last applied `created_at`. A `0055` stamped from
    // the real clock before 2026-09-02T12:33Z is OLDER than this entry and would never run on
    // any database that already has `0054` — the dev box and the PHE pilot included. Hand-
    // stamp a `when` above this one. `scripts/checks/drizzle-journal.mjs` fails a
    // non-increasing `when` in the pre-commit hook, so the mistake is loud rather than silent,
    // but it is easier to avoid than to diagnose.
    const previous = journal.entries.find((entry) => entry.idx === 53);
    expect(
      Number(previous?.when),
      "0054 must stamp later than 0053, or drizzle skips it",
    ).toBeLessThan(1788352383386);
  });

  it("is not scanning an empty or misnamed file", () => {
    // Most assertions below are `toContain`, `toMatch` or `.not.toMatch` over one string, and
    // against an empty string every negative one passes. A typo'd filename would therefore go
    // green on the negative assertions alone — ADR 0025's recorded class.
    const migration = read(MIGRATION_REL);
    expect(migration.length).toBeGreaterThan(1500);
    expect(migration).toContain(`CREATE TABLE IF NOT EXISTS bms.${TABLE}`);
  });

  it("brackets the whole migration in SET ROLE bms_owner / RESET ROLE", () => {
    const sql = sqlOnly(read(MIGRATION_REL));

    // ADR 0045 decision 6, load-bearing twice: FORCE ROW LEVEL SECURITY requires table
    // ownership, and `0041:112-119`'s ALTER DEFAULT PRIVILEGES FOR ROLE bms_owner grants to
    // bms_tenant/bms_fleet only for objects *that role* creates. pnpm db:migrate connects as
    // DATABASE_URL_SUPERUSER (bms_app), so without this the table reaches no pool role.
    expect(sql).toContain("SET ROLE bms_owner;");

    // Mandatory, not symmetry: a leaked SET ROLE reaches the drizzle migrator's own journal
    // write and every later migration in the same run (`0041`'s comment).
    expect(sql).toContain("RESET ROLE;");

    // No hand-written GRANT. The default privileges do it, and a redundant GRANT here would
    // hide a future breakage of the bracket — `0050`'s header states this as a rule and this
    // is what holds it for `0054`.
    expect(sql, "the default privileges grant this table; an explicit GRANT would mask a " +
      "broken SET ROLE bracket").not.toMatch(/^\s*GRANT\b/im);
  });

  it("never uses CREATE INDEX CONCURRENTLY", () => {
    // It cannot run inside a transaction block and the drizzle migrator wraps every file, so
    // the failure is a migration that will not apply. Re-asserted per file because every other
    // instance of this rule is scoped to its own migration by filename.
    expect(sqlOnly(read(MIGRATION_REL))).not.toMatch(/CREATE INDEX CONCURRENTLY/i);
  });

  it("creates the table tenant-scoped from birth, with ENABLE, FORCE and a policy", () => {
    const migration = read(MIGRATION_REL);

    // ADR 0043/0045, and ADR 0048 decision 4 says it in as many words: tenant-scoped from its
    // creating migration. `E7.1b`'s `0046`/`0047` are the recorded cost of the other order.
    expect(
      tableBlock(migration, TABLE),
      `${TABLE} needs organization_id NOT NULL`,
    ).toContain("organization_id uuid NOT NULL REFERENCES bms.organizations(id)");

    expect(migration).toContain(`ALTER TABLE bms.${TABLE} ENABLE ROW LEVEL SECURITY;`);

    // ENABLE alone exempts the table owner, and bms_owner IS the owner — so without FORCE the
    // policy is decorative for the one role that matters. That is the defect ADR 0045 exists
    // for: F4.16's FORCE was a no-op while bms_app owned the schema.
    expect(migration).toContain(`ALTER TABLE bms.${TABLE} FORCE ROW LEVEL SECURITY;`);

    expect(migration).toContain(`DROP POLICY IF EXISTS tenant_isolation ON bms.${TABLE};`);
    expect(migration).toContain(`CREATE POLICY tenant_isolation ON bms.${TABLE}`);
  });

  it("checks its org-bearing parent, not only the row's own column", () => {
    // Postgres runs a referential-integrity check with row security OFF, so a foreign key never
    // consults the parent's policy. `F3.1a`'s security review proved this live on the sibling
    // table: an ESKOM-stamped `dashboard_widget_points` row bound a PHEWB `asset_points` id and
    // the INSERT succeeded. A denormalised `organization_id` makes a table LOOK like it meets
    // the standard while enforcing strictly less, so the own column and the parent are both
    // checked.
    //
    // ONE parent, not two, and that is decision 4's point rather than an omission: a catalog
    // key is a foreign key to nothing, because the catalog is code (decision 1). There is no
    // second org-bearing parent to check.
    const policy = policyBlock(read(MIGRATION_REL), TABLE);
    const ORG = "nullif(current_setting('app.current_organization', true), '')::uuid";

    // ANCHORED TO THE START OF A LINE, AND THE OBVIOUS SPELLING IS VACUOUS.
    //
    // `expect(policy).toContain(`organization_id = ${ORG}`)` is what this assertion said
    // first, and this item's migration review mutation-proved that it gates nothing: the
    // PARENT leg reads `AND w.organization_id = nullif(...)::uuid`, which CONTAINS that
    // needle as a substring. Deleting both own-column predicates left `toContain` true, the
    // parent-EXISTS count at 2, and every other assertion in this block green — a policy
    // keyed on the parent alone passed the test that exists to refuse it.
    //
    // Counting anchored lines instead states the real requirement: the own column is checked
    // once in USING and once in WITH CHECK, and neither occurrence can be supplied by a
    // qualified column. `tests/f3.1a-dashboard-schema.test.ts:213-215` still carries the
    // unanchored form for migration `0050`'s three tables — same hole, different row's file.
    const ownColumnChecks = policy
      .split("\n")
      .filter((line) => line.trim().startsWith(`organization_id = ${ORG}`));
    expect(
      ownColumnChecks.length,
      "the own-column check must survive ALONGSIDE the parent check, in USING and in WITH CHECK",
    ).toBe(2);

    // Twice — once in USING, once in WITH CHECK. A read-only check leaves the write path open,
    // which is the asymmetry `E7.1c` found: the grant was not the hole, the policy disjunct was.
    expect(
      policy.split("SELECT 1 FROM bms.dashboard_widgets w").length - 1,
      "the widget parent must be checked in USING and in WITH CHECK",
    ).toBe(2);
    expect(policy).toContain(`w.id = ${TABLE}.widget_id`);

    // Written explicitly rather than leaning on the parent's own policy to filter the subquery
    // — `0047` §3c's rule, and what makes it correct under `bms_owner`, which is FORCE-bound
    // but filtered differently from `bms_tenant`.
    expect(policy).toContain(`w.organization_id = ${ORG}`);
  });

  it("admits no disjunct at all in its policy", () => {
    const sql = sqlOnly(read(MIGRATION_REL));

    // Shape 1 — the `0047`/`0048` NULL-org branch. `organization_id` is NOT NULL here, so there
    // is no legitimate fleet-owned row and nothing behind such a disjunct.
    expect(sql).not.toMatch(/organization_id IS NULL/i);

    // Shape 2, the more dangerous one because it fails OPEN: a policy admitting every row when
    // the GUC is unset. The integration suite never reaches it — `inTx` always sets the GUC and
    // its no-tenant case sets `''`, so `current_setting` returns the empty string, never NULL.
    expect(sql).not.toMatch(/current_setting\([^()]*\)\s*IS NULL/i);

    // STRICTER THAN `0050`'s EQUIVALENT, DELIBERATELY. That migration permits exactly one OR
    // shape, `<nullable scope> IS NULL OR EXISTS (…)`, because `bms.dashboards` has two
    // nullable scope legs. This table has none: every column the policy reads is NOT NULL. So
    // the count of permitted ORs is zero, and stating it as zero is a stronger gate than
    // re-using the neighbour's allowance out of habit.
    for (const line of sql.split("\n")) {
      expect(line, `no policy on bms.${TABLE} may contain an OR: ${line.trim()}`).not.toMatch(
        /\bOR\b/i,
      );
    }
  });

  it("closes catalog_key to exactly the keys the shared enum declares", () => {
    const migration = read(MIGRATION_REL);
    const keys = catalogKeys();

    expect(migration).toContain("CONSTRAINT dashboard_widget_sources_catalog_key_check");

    // THE GATE IS THE SORTED EQUALITY, not the loop below it, and the reason is a prefix.
    // `alarms.active` is a prefix of `alarms.active.count`, so a `toContain` on the bare key
    // passes for a CHECK that lists only the longer one. Both quote delimiters are inside the
    // needle for that reason, and the equality is what actually holds the set.
    const check =
      /CONSTRAINT dashboard_widget_sources_catalog_key_check CHECK \(catalog_key IN \(([^)]*)\)\)/.exec(
        migration,
      );
    expect(check, "the catalog_key CHECK must be an IN list this test can read").not.toBeNull();
    const listed = (check?.[1] ?? "")
      .split(",")
      .map((value) => value.trim().replace(/^'|'$/g, ""))
      .filter(Boolean);

    // Drift in either direction is real and the failures differ. A key in the CHECK with no
    // enum member is a binding no API can write and no picker can offer — dead rows the
    // database accepts. A key in the enum with no CHECK entry is worse: it passes the picker,
    // the contract and the service, then fails at the INSERT with a constraint name in front of
    // an administrator who chose a value the product offered them.
    expect(listed.sort()).toEqual([...keys].sort());

    // Readability layer, after the gate rather than instead of it.
    for (const key of keys) {
      expect(migration, `${key} must be accepted`).toContain(`'${key}'`);
    }
  });

  it("does not widen the widget vocabulary — `table` belongs to Stage B", () => {
    // ADR 0048 decision 5 and its Consequences describe ONE migration that "widens a CHECK and
    // creates a table". The owner chose C before B on 2026-08-31, which unbundles them: the
    // fifth `widgetType` ships with the component that renders it, in Stage B's own migration.
    //
    // Widening it here would put a `widget_type` in the database with no component behind it —
    // decision 2's entire justification arriving through the door the constraint exists to hold
    // shut, and the F4.43 failure with a green console.
    const sql = sqlOnly(read(MIGRATION_REL));
    expect(sql, "the fifth widget type ships with its renderer, not here").not.toMatch(
      /dashboard_widgets_widget_type_check/,
    );
    expect(sql).not.toMatch(/'table'/);
  });

  it("names every constraint the schema file and psql must agree on", () => {
    const migration = read(MIGRATION_REL);

    for (const name of [
      "CONSTRAINT dashboard_widget_sources_catalog_key_check",
      // At most one binding of a given key per widget. NOT `UNIQUE (widget_id)`, which would
      // freeze a per-widget cardinality that `WIDGET_SOURCE_CARDINALITY` already owns and can
      // change without a migration — the same division `dashboard_widget_points` records.
      "CONSTRAINT dashboard_widget_sources_widget_key_key",
      "CONSTRAINT dashboard_widget_sources_params_object_check",
    ]) {
      // Following the `alarm_severities_rank_key` precedent: an unnamed constraint gets a
      // derived name, and then the schema file and the database describe one object under two.
      expect(migration, `${name} must be named, not derived`).toContain(name);
    }

    expect(migration).toMatch(
      /CONSTRAINT dashboard_widget_sources_widget_key_key UNIQUE \(\s*widget_id,\s*catalog_key\s*\)/,
    );
  });

  it("binds the widget by foreign key and cascades", () => {
    const migration = read(MIGRATION_REL);

    // The same argument as ADR 0047 decision 3, one table over: a binding is a row with a real
    // foreign key, never an id inside jsonb. CASCADE rather than RESTRICT because deleting a
    // widget must not be blocked by its own bindings.
    expect(migration).toMatch(
      /widget_id uuid NOT NULL REFERENCES bms\.dashboard_widgets\(id\) ON DELETE CASCADE/,
    );

    // `catalog_key` REFERENCES NOTHING, and that is decision 4 rather than an oversight — the
    // catalog is code. Asserted so that a later reader does not add a lookup table by symmetry
    // with `bms.asset_roles`, which is the opposite case (a role's behaviour is data; a catalog
    // entry's behaviour is a SQL query).
    expect(migration).not.toMatch(/catalog_key varchar\(\d+\) NOT NULL REFERENCES/);
  });

  it("adds no index, because the unique key already leads with widget_id", () => {
    const migration = read(MIGRATION_REL);

    // Recorded as a decision rather than left as an absence a reader takes for an oversight.
    // `dashboard_widget_sources_widget_key_key` leads with `widget_id`, so it serves both the
    // per-widget ordered read and the ON DELETE CASCADE from `bms.dashboard_widgets`. That is
    // exactly why `dashboard_widget_points` needed a SEPARATE `point_idx` and this table needs
    // no second index: that table's cascade arrives through its *other* foreign key.
    //
    // ANY index, not one name. Asserting only that `dashboard_widget_sources_widget_idx` is
    // absent lets every other name through, so the stated decision — "no explicit index" —
    // would be held by nothing. This item's migration review flagged the named form as
    // near-vacuous.
    expect(sqlOnly(migration), "this table's reads are served by its unique key").not.toMatch(
      /CREATE INDEX/i,
    );

    // AND THE READ THIS DOES NOT SERVE, recorded because the migration header gets it wrong
    // and a committed migration cannot be corrected. The header calls the unique key enough
    // for "both reads this table has". There are three. `catalog_key` is the TRAILING column
    // of `(widget_id, catalog_key)`, so `WHERE catalog_key = 'x'` — the retirement query the
    // header's own opening paragraph gives as the reason this table exists at all — gets no
    // usable prefix and full-scans. Harmless at these row counts and not worth a `0055`; if
    // it ever stops being harmless, the fix is a forward migration adding
    // `(catalog_key)`, not a rewrite of this decision.
  });

  it("leaves dashboard_widget_points untouched", () => {
    // ADR 0048 decision 4 states it: the alternative that widened the existing table was
    // weighed and rejected, because a NULL `point_id` would then mean either "a catalog
    // binding" or "a bug", with a CHECK the only thing telling them apart.
    const sql = sqlOnly(read(MIGRATION_REL));
    expect(sql).not.toMatch(/ALTER TABLE bms\.dashboard_widget_points/);
    expect(sql).not.toMatch(/DROP POLICY IF EXISTS tenant_isolation ON bms\.dashboard_widget_points/);
  });

  it("mirrors the table in the drizzle schema, with the CHECK left to the migration", () => {
    const schema = read(SCHEMA_REL);

    // Without this the table exists in Postgres and not in the query builder, and `F3.1b`'s
    // service reaches for it as raw SQL — which is how a tenant column stops being typed.
    expect(schema).toContain("export const dashboardWidgetSources = bmsSchema.table(");
    expect(schema).toContain('"dashboard_widget_sources"');

    // `CHECK` constraints are deliberately not mirrored (the `automationRules.code` convention
    // this file's own docblock records) — the migration owns them and this suite pins them by
    // name. UNIQUE constraints ARE mirrored and ARE named, or drizzle derives a name and then
    // `\d` and the schema file describe one object under two.
    expect(schema).toContain('unique("dashboard_widget_sources_widget_key_key")');

    // Re-exported, or nothing outside `packages/db` can import it.
    expect(read("packages/db/src/schema/index.ts")).toContain('export * from "./dashboard-schema"');
  });
});

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

/**
 * `F2.10` / ADR 0098 decision 1 and Drafter choice 3, with Amendment 1 rulings
 * A1 and A2 — the text of migration `0103`: `bms.locations.parent_id`, the
 * unique `(id, organization_id)`, the same-organization composite foreign key,
 * the not-self CHECK, the `(organization_id, parent_id)` index, the
 * `SECURITY INVOKER` tree-guard trigger and four `location_types` rows.
 * `tests/f2.10-location-tree-schema.integration.test.ts` asserts what Postgres
 * enforces; this asserts the file, including the ORDER of the trigger body,
 * which no single database case can see whole.
 *
 * **Assertions inline, no `.spec` sibling** — the top-level `tests/` carve-out
 * (§4.6). Every regex used as a gate has a positive control beside it, so a
 * regex that matches nothing cannot hold a `not.toMatch` green.
 */
const STEM = "0103_location_tree";
const PREVIOUS_STEM = "0102_asset_source_data_key_vars";
const MIGRATION_REL = `packages/db/drizzle/${STEM}.sql`;
const JOURNAL_REL = "packages/db/drizzle/meta/_journal.json";

/** Comments stripped before every assertion — a header quoting DDL must not hold a `toContain` green. */
const sqlOnly = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .replace(/\s+/g, " ");

const migration = (): string => sqlOnly(read(MIGRATION_REL));

const FUNCTION_START = "CREATE OR REPLACE FUNCTION bms.locations_tree_guard()";
const TRIGGER_DROP = "DROP TRIGGER IF EXISTS locations_tree_guard ON bms.locations;";

/** The function, from its CREATE to the DROP TRIGGER that follows it. */
const functionText = (sql: string): string => {
  const start = sql.indexOf(FUNCTION_START);
  const end = sql.indexOf(TRIGGER_DROP);
  expect(start, `"${FUNCTION_START}" not found`).toBeGreaterThanOrEqual(0);
  expect(end, `"${TRIGGER_DROP}" must follow the function`).toBeGreaterThan(start);
  return sql.slice(start, end);
};

/**
 * The `DO` guard that wraps an `ADD CONSTRAINT`, so a second run is a no-op.
 * Returns the index of the `ADD CONSTRAINT`, -1 when it is not inside its guard.
 */
const guardedAddIndex = (sql: string, name: string, addClause: string): number => {
  const guard =
    "IF NOT EXISTS ( SELECT 1 FROM pg_constraint " +
    `WHERE conname = '${name}' ` +
    "AND conrelid = 'bms.locations'::regclass ) THEN";
  const guardAt = sql.indexOf(guard);
  if (guardAt === -1) return -1;
  const addAt = sql.indexOf(addClause, guardAt);
  const endIfAt = sql.indexOf("END IF;", guardAt);
  return addAt !== -1 && addAt < endIfAt ? addAt : -1;
};

type RecursiveStatement = {
  statement: string;
  unionCount: number;
  unionAll: boolean;
  recursiveTerm: string;
  depthBound: number | null;
};

/**
 * Every `WITH RECURSIVE` statement, from the keyword to the next `;`, split at
 * `UNION`. Everything after the one `UNION` is the recursive term (it also
 * carries the statement's outer SELECT, which names neither predicate).
 */
const recursiveStatements = (sql: string): RecursiveStatement[] =>
  [...sql.matchAll(/WITH RECURSIVE/g)].map((match) => {
    const start = match.index ?? 0;
    const end = sql.indexOf(";", start);
    const statement = sql.slice(start, end === -1 ? undefined : end);
    const parts = statement.split(/\bUNION\b/);
    const recursiveTerm = parts.length === 2 ? (parts[1] ?? "") : "";
    const bound = /<\s*(\d+)\b/.exec(recursiveTerm);
    return {
      statement,
      unionCount: parts.length - 1,
      unionAll: /\bUNION\s+ALL\b/.test(statement),
      recursiveTerm,
      depthBound: bound ? Number(bound[1]) : null,
    };
  });

/** Every way a recursive statement breaks the ADR 0098 Security 2 rule; empty when it holds. */
const recursiveFindings = (sql: string): string[] =>
  recursiveStatements(sql).flatMap((s, i) => {
    const out: string[] = [];
    if (s.unionAll) out.push(`#${i}: UNION ALL — a cycle would not terminate on de-duplication`);
    if (s.unionCount !== 1) out.push(`#${i}: ${s.unionCount} UNION keywords, expected exactly one`);
    if (s.unionCount === 1 && !/organization_id =/.test(s.recursiveTerm)) {
      out.push(`#${i}: the recursive term has no organization_id predicate`);
    }
    if (s.unionCount === 1 && s.depthBound !== 8) {
      out.push(`#${i}: the recursive term has no "< 8" depth bound`);
    }
    return out;
  });

/** The four reason codes the trigger raises (the frozen enum minus the service-only `location_inactive`). */
const TRIGGER_REASONS = [
  "location_has_active_children",
  "location_parent_cycle",
  "location_depth_exceeded",
  "location_parent_inactive",
];

describe("F2.10 — migration 0103 adds bms.locations.parent_id and its constraints", () => {
  it("1 adds parent_id as a nullable uuid", () => {
    expect(migration()).toContain("ALTER TABLE bms.locations ADD COLUMN IF NOT EXISTS parent_id uuid;");
  });

  it("1 gives parent_id no NOT NULL and no DEFAULT — every existing row stays a root", () => {
    const pattern = /parent_id uuid (NOT NULL|DEFAULT)/i;
    expect("ADD COLUMN parent_id uuid NOT NULL", "positive control").toMatch(pattern);
    expect(migration()).not.toMatch(pattern);
  });

  it("2 adds the unique (id, organization_id) inside its pg_constraint guard", () => {
    expect(
      guardedAddIndex(
        migration(),
        "locations_id_organization_key",
        "ADD CONSTRAINT locations_id_organization_key UNIQUE (id, organization_id)",
      ),
    ).toBeGreaterThan(-1);
  });

  it("3 adds the same-organization composite FK, NO ACTION both ways, inside its guard", () => {
    expect(
      guardedAddIndex(
        migration(),
        "locations_parent_id_organization_id_fkey",
        "ADD CONSTRAINT locations_parent_id_organization_id_fkey " +
          "FOREIGN KEY (parent_id, organization_id) REFERENCES bms.locations (id, organization_id) " +
          "ON DELETE NO ACTION ON UPDATE NO ACTION",
      ),
    ).toBeGreaterThan(-1);
  });

  it("3 says CASCADE and SET NULL nowhere — a parent delete never rewrites a child", () => {
    const cascade = /\bCASCADE\b/i;
    const setNull = /\bSET NULL\b/i;
    expect("ON DELETE CASCADE", "positive control").toMatch(cascade);
    expect("ON DELETE SET NULL", "positive control").toMatch(setNull);
    expect(read(MIGRATION_REL)).not.toMatch(cascade);
    expect(read(MIGRATION_REL)).not.toMatch(setNull);
  });

  it("3 adds the FK after the last RESET ROLE, as 0085 placed locations_type_fk", () => {
    const sql = migration();
    const lastReset = sql.lastIndexOf("RESET ROLE;");
    const fkAt = sql.indexOf("ADD CONSTRAINT locations_parent_id_organization_id_fkey");
    expect(lastReset, "RESET ROLE; not found").toBeGreaterThan(-1);
    expect(fkAt).toBeGreaterThan(lastReset);
  });

  it("4 adds the not-self CHECK inside its guard", () => {
    expect(
      guardedAddIndex(
        migration(),
        "locations_parent_not_self_check",
        "ADD CONSTRAINT locations_parent_not_self_check CHECK (parent_id IS DISTINCT FROM id)",
      ),
    ).toBeGreaterThan(-1);
  });

  it("5 adds the (organization_id, parent_id) index", () => {
    expect(migration()).toContain(
      "CREATE INDEX IF NOT EXISTS locations_organization_id_parent_id_idx ON bms.locations (organization_id, parent_id)",
    );
  });

  it("runs the owner-side DDL as bms_owner and resets the role", () => {
    const sql = migration();
    expect(sql.indexOf("SET ROLE bms_owner;")).toBeGreaterThan(-1);
    expect(sql.indexOf("SET ROLE bms_owner;")).toBeLessThan(sql.indexOf("ALTER TABLE bms.locations ADD COLUMN"));
    expect(sql).toContain("RESET ROLE;");
  });

  it("changes no policy and no privilege", () => {
    const policy = /\bPOLICY\b/i;
    const grant = /\b(GRANT|REVOKE)\b/i;
    expect("CREATE POLICY p", "positive control").toMatch(policy);
    expect("GRANT SELECT", "positive control").toMatch(grant);
    expect(migration()).not.toMatch(policy);
    expect(migration()).not.toMatch(grant);
  });
});

describe("F2.10 — migration 0103 declares the tree-guard trigger", () => {
  it("6 the function is SECURITY INVOKER, VOLATILE, with a pinned search_path", () => {
    const fn = functionText(migration());
    const header = fn.slice(0, fn.indexOf("AS $"));
    expect(header).toContain("SECURITY INVOKER");
    expect(header).toContain("VOLATILE");
    expect(header).toContain("SET search_path = pg_catalog, pg_temp");
  });

  it("6 the file says SECURITY DEFINER nowhere", () => {
    const definer = /SECURITY DEFINER/i;
    expect("LANGUAGE plpgsql SECURITY DEFINER", "positive control").toMatch(definer);
    expect(read(MIGRATION_REL)).not.toMatch(definer);
  });

  it("6 every FROM and JOIN in the function names bms.locations or one of its own CTEs", () => {
    const fn = functionText(migration());
    const ctes = new Set([...fn.matchAll(/WITH RECURSIVE (\w+)/g)].map((m) => m[1]));
    const targets = (text: string): string[] =>
      [...text.matchAll(/(?<!DISTINCT )\b(FROM|JOIN) ([\w.]+)/g)].map((m) => m[2] ?? "");
    const stray = (text: string): string[] =>
      targets(text).filter((t) => t !== "bms.locations" && !ctes.has(t));
    expect(stray("SELECT 1 FROM locations l JOIN up ON true"), "positive control").toEqual(["locations"]);
    expect(targets(fn)).toContain("bms.locations");
    expect(stray(fn)).toEqual([]);
  });

  it("7 drops then creates the trigger on parent_id, active and organization_id", () => {
    const sql = migration();
    const create =
      "CREATE TRIGGER locations_tree_guard BEFORE INSERT OR UPDATE OF parent_id, active, organization_id " +
      "ON bms.locations FOR EACH ROW EXECUTE FUNCTION bms.locations_tree_guard()";
    expect(sql.indexOf(TRIGGER_DROP)).toBeGreaterThan(-1);
    expect(sql.indexOf(create)).toBeGreaterThan(sql.indexOf(TRIGGER_DROP));
  });

  it("8 orders the body: root exit, isolation, lock, active children, parent lookup, cycle, depth, inactive parent", () => {
    const fn = functionText(migration());
    const needles = [
      "TG_OP = 'INSERT' AND NEW.parent_id IS NULL",
      "transaction_isolation",
      "pg_advisory_xact_lock(pg_catalog.hashtextextended('locations_tree:' || NEW.organization_id::text, 0))",
      "location_has_active_children",
      "WHERE id = NEW.parent_id AND organization_id = NEW.organization_id",
      "location_parent_cycle",
      "location_depth_exceeded",
      "location_parent_inactive",
    ];
    const positions = needles.map((needle) => {
      const at = fn.indexOf(needle);
      expect(at, `"${needle}" not found in the function`).toBeGreaterThan(-1);
      return at;
    });
    const sorted = [...positions].sort((a, b) => a - b);
    expect(positions, `body order: ${needles.join(" < ")}`).toEqual(sorted);
  });

  it("8 the isolation test compares to 'read committed'", () => {
    expect(functionText(migration())).toContain("current_setting('transaction_isolation') <> 'read committed'");
  });

  it("8 returns NEW on at least four paths (unchanged, root insert, root, invisible parent)", () => {
    const count = functionText(migration()).split("RETURN NEW").length - 1;
    expect(count).toBeGreaterThanOrEqual(4);
  });

  it("9 every WITH RECURSIVE has one UNION, and its recursive term carries organization_id = and < 8", () => {
    const sql = migration();
    expect(recursiveStatements(sql).length, "the trigger walks up and down: two statements").toBe(2);
    expect(recursiveFindings(sql)).toEqual([]);
  });

  it("9 positive control: a predicate on the anchor alone is reported", () => {
    const fixture =
      "WITH RECURSIVE up AS ( SELECT id FROM bms.locations WHERE organization_id = $1 " +
      "UNION SELECT l.id FROM bms.locations l JOIN up ON l.id = up.parent_id WHERE up.depth < 8 ) SELECT 1;";
    expect(recursiveFindings(fixture)).toEqual(["#0: the recursive term has no organization_id predicate"]);
  });

  it("9 positive control: UNION ALL and a missing depth bound are reported", () => {
    const fixture =
      "WITH RECURSIVE up AS ( SELECT id FROM bms.locations " +
      "UNION ALL SELECT l.id FROM bms.locations l JOIN up ON l.organization_id = up.organization_id ) SELECT 1;";
    const findings = recursiveFindings(fixture);
    expect(findings).toContain("#0: UNION ALL — a cycle would not terminate on de-duplication");
    expect(findings).toContain("#0: the recursive term has no \"< 8\" depth bound");
  });

  it("10 every reason-code RAISE uses SQLSTATE 23514 and CONSTRAINT locations_tree_guard", () => {
    const fn = functionText(migration());
    const raises = [...fn.matchAll(/RAISE EXCEPTION '(location_[a-z_]+)'([^;]*);/g)];
    expect(new Set(raises.map((m) => m[1]))).toEqual(new Set(TRIGGER_REASONS));
    for (const [, reason, options] of raises) {
      expect(options, reason).toContain("ERRCODE = '23514'");
      expect(options, reason).toContain("CONSTRAINT = 'locations_tree_guard'");
    }
  });

  it("10 location_parent_cross_org appears nowhere (ADR 0098 Amendment 1, A3)", () => {
    expect(read(MIGRATION_REL)).not.toContain("location_parent_cross_org");
  });

  it("10 location_inactive is service-only — the trigger never raises it", () => {
    expect(functionText(migration())).not.toContain("'location_inactive'");
  });
});

describe("F2.10 — migration 0103 seeds four location types and proves itself", () => {
  it("11 inserts campus, township, building and plant at 50/60/70/80 with a bare ON CONFLICT DO NOTHING", () => {
    const sql = migration();
    for (const row of [
      "('campus', 'Campus', 50)",
      "('township', 'Township', 60)",
      "('building', 'Building', 70)",
      "('plant', 'Plant', 80)",
    ]) {
      expect(sql).toContain(row);
    }
    const typesAt = sql.indexOf("INSERT INTO bms.location_types (code, label, sort_order) VALUES");
    expect(typesAt).toBeGreaterThan(-1);
    expect(sql.indexOf("ON CONFLICT DO NOTHING;", typesAt)).toBeGreaterThan(typesAt);
    const target = /ON CONFLICT \(/;
    expect("ON CONFLICT (code) DO NOTHING", "positive control").toMatch(target);
    expect(sql).not.toMatch(target);
  });

  it("12 the proof DO block after the last RESET ROLE checks tgenabled, prosecdef and proconfig", () => {
    const sql = migration();
    const tail = sql.slice(sql.lastIndexOf("RESET ROLE;"));
    expect(tail).toContain("tgenabled = 'O'");
    expect(tail).toMatch(/IF [^;]*prosecdef[^;]* THEN RAISE EXCEPTION/);
    expect(tail).toContain("search_path=pg_catalog, pg_temp");
  });
});

describe("F2.10 — migration 0103 is journalled", () => {
  type JournalEntry = { idx: number; when: number; tag: string };
  const entries = (): ReadonlyArray<JournalEntry> =>
    (JSON.parse(read(JOURNAL_REL)) as { entries: ReadonlyArray<JournalEntry> }).entries;

  it("13 the SQL file exists", () => {
    expect(existsSync(join(repoRoot, MIGRATION_REL))).toBe(true);
  });

  it("13 has a journal entry whose tag equals the filename stem", () => {
    expect(entries().find((e) => e.tag === STEM), `no journal entry "${STEM}"`).toBeDefined();
  });

  it("13 stamps a when strictly greater than 0102's", () => {
    const previous = entries().find((e) => e.tag === PREVIOUS_STEM);
    const entry = entries().find((e) => e.tag === STEM);
    expect(previous, `journal entry ${PREVIOUS_STEM} not found`).toBeDefined();
    expect(entry?.when).toBeGreaterThan(previous!.when);
  });

  it("13 stamps a when that is not ahead of the clock (AGENTS.md §4.4)", () => {
    const entry = entries().find((e) => e.tag === STEM);
    expect(entry, `no journal entry "${STEM}"`).toBeDefined();
    expect(entry!.when).toBeLessThanOrEqual(Date.now());
  });
});

const FOREIGN_KEY_CALL = /foreignKey\(\{([\s\S]*?)\}\)/;

describe("F2.10 — the Drizzle schema and the shared constant agree with migration 0103", () => {
  const locationsLiteral = (): string => {
    const source = read("packages/db/src/schema/bms-schema.ts");
    const start = source.indexOf('export const locations = bmsSchema.table("locations", {');
    expect(start, "the locations table literal").toBeGreaterThan(-1);
    const end = source.indexOf("\n});", start);
    return source.slice(start, end === -1 ? undefined : end + 4);
  };

  it("14 bms-schema.ts declares parent_id, the unique pair and the composite foreign key", () => {
    const literal = locationsLiteral();
    expect(literal).toContain('parentId: uuid("parent_id")');
    expect(literal).toContain('unique("locations_id_organization_key").on(t.id, t.organizationId)');
    const fk = FOREIGN_KEY_CALL.exec(literal);
    expect(fk, "foreignKey({ ... }) inside the locations literal").not.toBeNull();
    expect(fk![1]).toContain('name: "locations_parent_id_organization_id_fkey"');
    expect(fk![1]).toContain("columns: [t.parentId, t.organizationId]");
    expect(fk![1]).toContain("foreignColumns: [t.id, t.organizationId]");
  });

  it("14 positive control: the slice would not find a foreignKey in a table without one", () => {
    expect(FOREIGN_KEY_CALL.exec("pgTable('x', {})")).toBeNull();
    expect(FOREIGN_KEY_CALL.exec("foreignKey({ name: 'n' })")).not.toBeNull();
  });

  it("15 LOCATION_TREE_MAX_DEPTH equals the < N literal the SQL scan found", () => {
    const bounds = recursiveStatements(migration()).map((s) => s.depthBound);
    expect(bounds.length).toBeGreaterThan(0);
    expect(new Set(bounds).size, "one literal across the statements").toBe(1);
    const ts = read("packages/shared/src/location-tree.ts");
    const declared = /export const LOCATION_TREE_MAX_DEPTH = (\d+);/.exec(ts);
    expect(declared, "export const LOCATION_TREE_MAX_DEPTH = N;").not.toBeNull();
    expect(Number(declared![1])).toBe(bounds[0]);
  });
});

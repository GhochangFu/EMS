import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(isAbsolute(rel) ? rel : join(repoRoot, rel), "utf8");

/**
 * The migration under test. `F332F_0093_PATH` points the scan at a hand-mutated copy, so a
 * mutation run never edits the committed (frozen) file; unset, it reads the real one.
 */
const MIGRATION_REL = process.env.F332F_0093_PATH ?? "packages/db/drizzle/0093_mimic_org_symbol_libraries.sql";
const JOURNAL_REL = "packages/db/drizzle/meta/_journal.json";
/** The key grammars, read from the contract SOURCE (never `@bms/shared`, which resolves to `dist`). */
const KEYS_CONTRACT_REL = "packages/shared/src/contracts/mimic-symbol-libraries.ts";
const LAYOUTS_CONTRACT_REL = "packages/shared/src/contracts/mimic-layouts.ts";
const TAG = "0093_mimic_org_symbol_libraries";
const TABLES = ["mimic_org_symbol_libraries", "mimic_org_symbols", "mimic_library_settings"] as const;

/** Strip `--` comment lines before a scan — 0093's header names most of its statements (the
 * `f3.1a` lesson: a raw scan is satisfied by a comment quoting the statement it explains). */
const sqlOnly = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

const migration = (): string => sqlOnly(read(MIGRATION_REL));
/** Whitespace collapsed to one space, for statements that span lines. */
const flat = (text: string): string => text.replace(/\s+/g, " ");

const countOf = (text: string, needle: string): number => text.split(needle).length - 1;

/** The slice from `head` to the first `end` after it (inclusive); throws if either is missing. */
const sliceBetween = (text: string, head: string, end: string, what: string): string => {
  const start = text.indexOf(head);
  if (start < 0) throw new Error(`${what}: no ${JSON.stringify(head)}`);
  const stop = text.indexOf(end, start + head.length);
  if (stop < 0) throw new Error(`${what}: no ${JSON.stringify(end)} after the head`);
  return text.slice(start, stop + end.length);
};

/** The pattern of one `export const NAME = /…/;` literal in a source file; throws if absent. */
const regexSourceOf = (source: string, name: string): string => {
  const m = new RegExp(`^export const ${name} = /(.+)/;$`, "m").exec(source);
  if (!m) throw new Error(`no regex literal export ${name}`);
  return m[1] as string;
};

/** The pattern inside one named `CHECK (<column> ~ '<pattern>')`; throws if absent. */
const checkPatternOf = (sql: string, constraint: string, column: string): string => {
  const m = new RegExp(`CONSTRAINT ${constraint} CHECK \\(${column} ~ '([^']+)'\\)`).exec(sql);
  if (!m) throw new Error(`no ${constraint} regex CHECK on ${column}`);
  return m[1] as string;
};

/** Each `CREATE POLICY` statement, from its head to the next `;`. */
const policies = (sql: string): string[] =>
  [...sql.matchAll(/CREATE POLICY[^;]*;/g)].map((m) => m[0]);

/** The policy statement on one table; throws if there is not exactly one. */
const policyOn = (sql: string, table: string): string => {
  const found = policies(sql).filter((p) => p.startsWith(`CREATE POLICY tenant_isolation ON bms.${table}\n`));
  if (found.length !== 1) throw new Error(`${found.length} tenant_isolation policies on bms.${table}`);
  return found[0] as string;
};

/** The replaced `mimic_layout_nodes_kind_fields_check` ADD, to its closing `;`. */
const KIND_ADD = "ADD CONSTRAINT mimic_layout_nodes_kind_fields_check CHECK (";
const kindCheck = (sql: string): string => sliceBetween(sql, KIND_ADD, ";", "kind_fields ADD");

/** The three arms of the kind CHECK, split on each `(kind = '<kind>'` head (the unit arm holds an
 * inner `OR`, so splitting on `OR` would cut it in two). Fails closed on a missing head. */
const kindArms = (check: string): Record<"unit" | "panel" | "label", string> => {
  const heads = (["unit", "panel", "label"] as const).map((kind) => {
    const at = check.indexOf(`(kind = '${kind}'`);
    if (at < 0) throw new Error(`kind_fields: no ${kind} arm`);
    return [kind, at] as const;
  });
  const [unit, panel, label] = heads;
  return {
    unit: check.slice(unit[1], panel[1]),
    panel: check.slice(panel[1], label[1]),
    label: check.slice(label[1]),
  };
};

const DO_HEAD = "DO $$";
const doBlock = (sql: string): string => sql.slice(sql.indexOf(DO_HEAD));

const FK_DROP = "ALTER TABLE bms.mimic_layout_nodes DROP CONSTRAINT IF EXISTS mimic_layout_nodes_org_symbol_fkey;";
const FK_ADD =
  "ADD CONSTRAINT mimic_layout_nodes_org_symbol_fkey FOREIGN KEY (organization_id, org_symbol_key) REFERENCES bms.mimic_org_symbols (organization_id, key);";
const KIND_DROP =
  "ALTER TABLE bms.mimic_layout_nodes DROP CONSTRAINT IF EXISTS mimic_layout_nodes_kind_fields_check;";

/**
 * `F3.32f` slice 3 — the static half of migration `0093` (ADR 0086 decisions 1, 3 and 4, plan
 * D4, unit U1). The live half is `tests/f3.32f-org-symbol-libraries.integration.test.ts`.
 * Assertions inline, no `.spec` sibling (§4.6); one claim per `it()`.
 */
describe("F3.32f — migration 0093: organization symbol libraries", () => {
  it("is not scanning an empty or misnamed file", () => {
    expect(existsSync(isAbsolute(MIGRATION_REL) ? MIGRATION_REL : join(repoRoot, MIGRATION_REL))).toBe(true);
    const sql = migration();
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS bms.mimic_org_symbols (");
    expect(sql).toContain("ALTER TABLE bms.mimic_layout_nodes");
  });

  describe("the journal", () => {
    type Entry = { idx: number; tag: string; when: number; version: string; breakpoints: boolean };
    const entries = (): Entry[] => (JSON.parse(read(JOURNAL_REL)) as { entries: Entry[] }).entries;
    const entry = (): Entry | undefined => entries().find((e) => e.tag === TAG);

    it("registers 0093 at idx 93, version 7, with breakpoints", () => {
      expect(entry(), "migration 0093 must have a journal entry, or drizzle never runs it").toBeDefined();
      expect(entry()?.idx).toBe(93);
      expect(entry()?.version).toBe("7");
      expect(entry()?.breakpoints).toBe(true);
    });

    // The F4.94 class: a stamp not above the last applied one is skipped. Compared with the
    // largest `when` below idx 93 rather than a named idx 92, which this base does not hold.
    it("stamps a when strictly above every earlier entry's", () => {
      const earlier = entries().filter((e) => e.idx < 93);
      expect(earlier.length).toBeGreaterThan(90);
      expect(entry()?.when as number).toBeGreaterThan(Math.max(...earlier.map((e) => e.when)));
    });

    it("stamps a when not ahead of the clock", () => {
      expect(entry()?.when as number).toBeLessThanOrEqual(Date.now());
    });
  });

  describe("the role bracket", () => {
    it("has exactly one SET ROLE bms_owner;", () => {
      expect(countOf(migration(), "SET ROLE bms_owner;")).toBe(1);
    });

    it("has exactly one RESET ROLE;", () => {
      expect(countOf(migration(), "RESET ROLE;")).toBe(1);
    });

    for (const table of TABLES) {
      it(`creates bms.${table} once, inside the bracket`, () => {
        const sql = migration();
        const needle = `CREATE TABLE IF NOT EXISTS bms.${table} (`;
        expect(countOf(sql, needle)).toBe(1);
        expect(sql.indexOf(needle)).toBeGreaterThan(sql.indexOf("SET ROLE bms_owner;"));
        expect(sql.indexOf(needle)).toBeLessThan(sql.indexOf("RESET ROLE;"));
      });

      it(`enables and forces row level security on bms.${table} inside the bracket`, () => {
        const sql = migration();
        const reset = sql.indexOf("RESET ROLE;");
        for (const verb of ["ENABLE", "FORCE"] as const) {
          const needle = `ALTER TABLE bms.${table} ${verb} ROW LEVEL SECURITY;`;
          expect(countOf(sql, needle), needle).toBe(1);
          expect(sql.indexOf(needle), needle).toBeLessThan(reset);
        }
      });

      it(`creates the tenant_isolation policy on bms.${table} inside the bracket, after a DROP IF EXISTS`, () => {
        const sql = migration();
        const drop = `DROP POLICY IF EXISTS tenant_isolation ON bms.${table};`;
        const create = `CREATE POLICY tenant_isolation ON bms.${table}\n`;
        expect(countOf(sql, create)).toBe(1);
        expect(sql.indexOf(drop)).toBeGreaterThan(sql.indexOf("SET ROLE bms_owner;"));
        expect(sql.indexOf(drop)).toBeLessThan(sql.indexOf(create));
        expect(sql.indexOf(create)).toBeLessThan(sql.indexOf("RESET ROLE;"));
      });
    }

    it("counts three FORCE ROW LEVEL SECURITY and three CREATE POLICY in the file", () => {
      const sql = migration();
      expect(countOf(sql, "FORCE ROW LEVEL SECURITY;")).toBe(3);
      expect(policies(sql)).toHaveLength(3);
    });

    it("finds the ALTERs on mimic_layout_nodes (positive control: at least five)", () => {
      expect([...migration().matchAll(/ALTER TABLE bms\.mimic_layout_nodes\b/g)].length).toBeGreaterThanOrEqual(5);
    });

    it("runs every ALTER TABLE bms.mimic_layout_nodes after RESET ROLE", () => {
      const sql = migration();
      const reset = sql.indexOf("RESET ROLE;");
      for (const m of sql.matchAll(/ALTER TABLE bms\.mimic_layout_nodes\b/g)) {
        expect(m.index, `${m[0]} at ${m.index} must follow RESET ROLE at ${reset}`).toBeGreaterThan(reset);
      }
    });

    it("creates mimic_layout_nodes_org_symbol_idx after RESET ROLE", () => {
      const sql = migration();
      const at = sql.indexOf("CREATE INDEX IF NOT EXISTS mimic_layout_nodes_org_symbol_idx");
      expect(at).toBeGreaterThan(sql.indexOf("RESET ROLE;"));
    });
  });

  it("issues no GRANT statement", () => {
    const sql = migration();
    // Positive control: the scan reads statements at all.
    expect(sql).toMatch(/\bCREATE POLICY\b/);
    expect(sql).not.toMatch(/\bGRANT\b/i);
  });

  it("issues no REVOKE statement", () => {
    expect(migration()).not.toMatch(/\bREVOKE\b/i);
  });

  describe("the policies", () => {
    for (const table of TABLES) {
      it(`bms.${table}'s policy has both USING ( and WITH CHECK (`, () => {
        const policy = policyOn(migration(), table);
        expect(policy).toContain("USING (");
        expect(policy).toContain("WITH CHECK (");
      });

      it(`bms.${table}'s policy has no IS NULL disjunct`, () => {
        expect(policyOn(migration(), table)).not.toMatch(/IS NULL/i);
      });
    }

    it("positive control — a planted organization_id IS NULL disjunct is caught", () => {
      const sql = migration();
      const planted = sql.replace(
        "WITH CHECK (\n    organization_id = ",
        "WITH CHECK (\n    organization_id IS NULL OR organization_id = ",
      );
      expect(planted).not.toBe(sql);
      expect(policies(planted).some((p) => /IS NULL/i.test(p))).toBe(true);
    });

    it("the mimic_org_symbols policy names bms.mimic_org_symbol_libraries in USING and WITH CHECK", () => {
      const policy = policyOn(migration(), "mimic_org_symbols");
      const [using, check] = policy.split("WITH CHECK (");
      expect(using).toContain("bms.mimic_org_symbol_libraries");
      expect(check).toContain("bms.mimic_org_symbol_libraries");
    });
  });

  describe("the constraints restate the shared contract", () => {
    it("mimic_org_symbol_libraries_code_check's pattern equals MIMIC_ORG_LIBRARY_CODE's source", () => {
      expect(checkPatternOf(migration(), "mimic_org_symbol_libraries_code_check", "code")).toBe(
        regexSourceOf(read(KEYS_CONTRACT_REL), "MIMIC_ORG_LIBRARY_CODE"),
      );
    });

    it("mimic_org_symbols_key_check's pattern equals MIMIC_ORG_SYMBOL_KEY's source", () => {
      expect(checkPatternOf(migration(), "mimic_org_symbols_key_check", "key")).toBe(
        regexSourceOf(read(KEYS_CONTRACT_REL), "MIMIC_ORG_SYMBOL_KEY"),
      );
    });

    it("mimic_org_symbols_group_code_check lists MIMIC_SYMBOL_GROUP_CODES, in order", () => {
      const block = sliceBetween(read(LAYOUTS_CONTRACT_REL), "export const MIMIC_SYMBOL_GROUP_CODES = [", "]", "group codes");
      const codes = [...block.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
      expect(codes).toHaveLength(8);
      const check = sliceBetween(migration(), "CONSTRAINT mimic_org_symbols_group_code_check CHECK (", ")", "group check");
      expect([...check.matchAll(/'([a-z_]+)'/g)].map((m) => m[1])).toEqual(codes);
    });

    it("mimic_library_settings_core_check refuses a disabled core", () => {
      expect(migration()).toContain("CONSTRAINT mimic_library_settings_core_check CHECK (library_code <> 'core' OR enabled)");
    });
  });

  describe("the kind CHECK", () => {
    it("drops mimic_layout_nodes_kind_fields_check IF EXISTS once, before its ADD", () => {
      const sql = migration();
      expect(countOf(sql, KIND_DROP)).toBe(1);
      expect(countOf(sql, KIND_ADD)).toBe(1);
      expect(sql.indexOf(KIND_DROP)).toBeLessThan(sql.indexOf(KIND_ADD));
    });

    for (const kind of ["unit", "panel", "label"] as const) {
      it(`the ${kind} arm mentions org_symbol_key`, () => {
        expect(kindArms(kindCheck(migration()))[kind]).toContain("org_symbol_key");
      });
    }

    it("the unit arm allows symbol or org_symbol_key, never both and never neither", () => {
      expect(flat(kindArms(kindCheck(migration())).unit)).toContain(
        "((symbol IS NOT NULL AND org_symbol_key IS NULL) OR (symbol IS NULL AND org_symbol_key IS NOT NULL))",
      );
    });
  });

  describe("the composite foreign key", () => {
    it("adds mimic_layout_nodes_org_symbol_fkey once, as (organization_id, org_symbol_key) -> (organization_id, key)", () => {
      expect(countOf(flat(migration()), FK_ADD)).toBe(1);
    });

    it("drops mimic_layout_nodes_org_symbol_fkey IF EXISTS before it adds it", () => {
      const sql = flat(migration());
      expect(countOf(sql, FK_DROP)).toBe(1);
      expect(sql.indexOf(FK_DROP)).toBeLessThan(sql.indexOf(FK_ADD));
    });

    it("carries no ON DELETE anywhere in the file", () => {
      expect(migration()).toContain("FOREIGN KEY");
      expect(migration()).not.toMatch(/ON DELETE/i);
    });

    it("mimic_org_symbols_library_fkey is the two-column key to its library", () => {
      expect(flat(migration())).toContain(
        "CONSTRAINT mimic_org_symbols_library_fkey FOREIGN KEY (organization_id, library_id) REFERENCES bms.mimic_org_symbol_libraries (organization_id, id)",
      );
    });
  });

  describe("the DO $$ self-check", () => {
    it("is the last statement, after the last ALTER and CREATE INDEX, and ends the file", () => {
      const sql = migration();
      expect(countOf(sql, DO_HEAD)).toBe(1);
      expect(sql.indexOf(DO_HEAD)).toBeGreaterThan(sql.lastIndexOf("ALTER TABLE"));
      expect(sql.indexOf(DO_HEAD)).toBeGreaterThan(sql.lastIndexOf("CREATE INDEX"));
      expect(sql.trimEnd().endsWith("END $$;")).toBe(true);
    });

    for (const name of [
      "relforcerowsecurity",
      "has_table_privilege",
      "mimic_layout_nodes_org_symbol_fkey",
      "org_symbol_key",
      "mimic_library_settings_core_check",
    ] as const) {
      it(`names ${name}`, () => {
        expect(doBlock(migration())).toContain(name);
      });
    }
  });
});

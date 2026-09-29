import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

const MIGRATION_REL = "packages/db/drizzle/0089_mimic_domain_symbols_and_roles.sql";
const MIGRATION_0088 = "packages/db/drizzle/0088_mimic_layouts.sql";
const MIGRATION_0051 = "packages/db/drizzle/0051_asset_role_vocabulary.sql";
const MIGRATION_0060 = "packages/db/drizzle/0060_asset_role_estate_shapes.sql";
const MIGRATION_0087 = "packages/db/drizzle/0087_asset_roles_water_train.sql";
const CONTRACT_REL = "packages/shared/src/contracts/mimic-layouts.ts";
const PRESETS_REL = "packages/shared/src/mimic-presets.ts";
const JOURNAL_REL = "packages/db/drizzle/meta/_journal.json";
const TAG = "0089_mimic_domain_symbols_and_roles";
/** 0088's `when` — the F4.94 class: a stamp not above the last applied one is skipped. */
const WHEN_0088 = 1790613428878;

/**
 * ADR 0082 decision 4 — the eighteen role codes and the sort band each belongs
 * to, as the ADR states them. Literal, so the migration cannot drift from the
 * ADR by editing both sides.
 */
const ADR_CODES: ReadonlyArray<readonly [code: string, min: number, max: number]> = [
  ["dg-set", 190, 190],
  ["secondary-pump", 560, 560],
  ["ups", 610, 650],
  ["battery", 610, 650],
  ["pdu", 610, 650],
  ["it-rack", 610, 650],
  ["crac", 610, 650],
  ["air-compressor", 710, 740],
  ["air-dryer", 710, 740],
  ["air-receiver", 710, 740],
  ["air-header", 710, 740],
  ["ambient-station", 810, 840],
  ["indoor-air", 810, 840],
  ["stack-monitor", 810, 840],
  ["effluent-monitor", 810, 840],
  ["lighting", 910, 930],
  ["lifts", 910, 930],
  ["fire-pump", 910, 930],
];

/**
 * The role codes the six new presets name (plan §3). Literal, because the preset
 * file is another unit's: this makes "every preset code is inserted somewhere"
 * true at this commit, not only once the presets land.
 */
const PLAN_PRESET_CODES = [
  "incoming-supply", "ht-panel", "transformer", "lt-panel", "mcc", "dg-set", "ups",
  "cooling-tower", "chiller", "primary-pump", "secondary-pump", "ahu-fcu",
  "battery", "pdu", "it-rack", "crac",
  "air-compressor", "air-dryer", "air-receiver", "air-header",
  "ambient-station", "indoor-air", "stack-monitor", "effluent-monitor",
  "meter", "lighting", "lifts", "fire-pump", "utilities",
] as const;

/** Strip `--` comment lines before a scan — a raw scan is satisfied by a
 * comment quoting the statement it explains (the `f3.1a` lesson). */
const sqlOnly = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

/** The string members of one `z.enum([...])` export, read from the source text
 * (never `@bms/shared`, which resolves to `dist`: a source edit would not reach it). */
const enumMembersFromSource = (source: string, exportName: string): string[] => {
  const start = source.indexOf(`export const ${exportName} = z.enum([`);
  if (start < 0) throw new Error(`no z.enum export ${exportName}`);
  const end = source.indexOf("]);", start);
  return [...source.slice(start, end).matchAll(/"([a-z_]+)"/g)].map((m) => m[1] as string);
};

/** 0089's `ADD CONSTRAINT mimic_layout_nodes_symbol_check CHECK (...)` statement, to its `;`. */
const addedSymbolCheck = (sql: string): string => {
  const head = "ADD CONSTRAINT mimic_layout_nodes_symbol_check CHECK (";
  const start = sql.indexOf(head);
  if (start < 0) throw new Error("0089 adds no mimic_layout_nodes_symbol_check");
  return sql.slice(start, sql.indexOf(";", start));
};

/** 0088's inline `CONSTRAINT mimic_layout_nodes_symbol_check CHECK (...)`, to the end of its line. */
const frozenSymbolCheck = (sql: string): string => {
  const start = sql.indexOf("CONSTRAINT mimic_layout_nodes_symbol_check CHECK (");
  if (start < 0) throw new Error("0088 has no mimic_layout_nodes_symbol_check");
  return sql.slice(start, sql.indexOf("\n", start));
};

const quoted = (text: string): string[] => [...text.matchAll(/'([a-z_]+)'/g)].map((m) => m[1] as string);

/** The `(code, label, sort_order)` rows of one migration's `INSERT INTO bms.asset_roles`,
 * read only between the INSERT and its `ON CONFLICT` — never from a CHECK list. */
const insertedRoles = (rel: string): Array<{ code: string; label: string; sort: number }> => {
  const sql = sqlOnly(read(rel));
  const start = sql.indexOf("INSERT INTO bms.asset_roles");
  if (start < 0) throw new Error(`${rel} has no INSERT INTO bms.asset_roles`);
  const end = sql.indexOf("ON CONFLICT", start);
  if (end < 0) throw new Error(`${rel}'s asset_roles INSERT has no ON CONFLICT`);
  return [...sql.slice(start, end).matchAll(/\(\s*'([a-z0-9_-]+)'\s*,\s*'([^']*)'\s*,\s*(\d+)\s*\)/g)].map(
    (m) => ({ code: m[1] as string, label: m[2] as string, sort: Number(m[3]) }),
  );
};

/**
 * `F3.32d` — the static half of migration `0089` (ADR 0082 decisions 1 and 4,
 * plan D6/D7, U1). The live half is
 * `tests/f3.32d-mimic-domain-symbols-and-roles.integration.test.ts`. Assertions
 * inline, no `.spec` sibling (§4.6).
 */
describe("F3.32d — migration 0089: the symbol CHECK restated and eighteen role codes", () => {
  it("is not scanning an empty or misnamed file", () => {
    expect(existsSync(join(repoRoot, MIGRATION_REL)), `${MIGRATION_REL} must exist`).toBe(true);
    const sql = sqlOnly(read(MIGRATION_REL));
    expect(sql).toContain("ALTER TABLE bms.mimic_layout_nodes");
    expect(sql).toContain("INSERT INTO bms.asset_roles");
  });

  it("registers migration 0089 in the journal at idx 89, after 0088 and not ahead of the clock", () => {
    const journal = JSON.parse(read(JOURNAL_REL)) as { entries: Array<Record<string, unknown>> };
    const entry = journal.entries.find((e) => e.tag === TAG);
    expect(entry, "migration 0089 must have a journal entry, or drizzle never runs it").toBeDefined();
    expect(entry?.idx).toBe(89);
    expect(entry?.version).toBe("7");
    expect(entry?.breakpoints).toBe(true);
    expect(entry?.when as number).toBeGreaterThan(WHEN_0088);
    expect(entry?.when as number).toBeLessThanOrEqual(Date.now());
  });

  it("keeps the journal's idx and when strictly increasing", () => {
    const journal = JSON.parse(read(JOURNAL_REL)) as { entries: Array<{ idx: number; when: number }> };
    for (let i = 1; i < journal.entries.length; i += 1) {
      const prev = journal.entries[i - 1]!;
      const cur = journal.entries[i]!;
      // Increasing, not contiguous: the committed journal has no idx 20.
      expect(cur.idx, `entry ${i} idx`).toBeGreaterThan(prev.idx);
      expect(cur.when, `entry ${i} (idx ${cur.idx}) when`).toBeGreaterThan(prev.when);
    }
  });

  it("brackets the migration in exactly one SET ROLE bms_owner / RESET ROLE, around the ALTER and the self-check", () => {
    const sql = sqlOnly(read(MIGRATION_REL));
    expect(sql.match(/SET ROLE bms_owner;/g)).toHaveLength(1);
    expect(sql.match(/RESET ROLE;/g)).toHaveLength(1);
    expect(sql.indexOf("SET ROLE bms_owner;")).toBeLessThan(sql.indexOf("ALTER TABLE bms.mimic_layout_nodes"));
    expect(sql.lastIndexOf("RESET ROLE;")).toBeGreaterThan(sql.lastIndexOf("END $$;"));
    expect(sql.indexOf("DO $$")).toBeGreaterThan(sql.indexOf("ON CONFLICT DO NOTHING;"));
  });

  it("issues no GRANT statement", () => {
    expect(sqlOnly(read(MIGRATION_REL))).not.toMatch(/\bGRANT\b/i);
  });

  it("drops the old CHECK with IF EXISTS before it adds the new one, and the ADD has no IF NOT EXISTS", () => {
    const sql = sqlOnly(read(MIGRATION_REL));
    const drop = "DROP CONSTRAINT IF EXISTS mimic_layout_nodes_symbol_check;";
    const add = "ADD CONSTRAINT mimic_layout_nodes_symbol_check CHECK (";
    expect(sql.match(new RegExp(drop.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))).toHaveLength(1);
    expect(sql.indexOf(drop)).toBeGreaterThan(-1);
    expect(sql.indexOf(drop)).toBeLessThan(sql.indexOf(add));
    expect(sql).not.toMatch(/ADD\s+CONSTRAINT\s+IF\s+NOT\s+EXISTS/i);
  });

  it("_symbol_check lists every mimicSymbolSchema member, in order, from the shared source", () => {
    const symbols = enumMembersFromSource(read(CONTRACT_REL), "mimicSymbolSchema");
    // Positive control: the source parse found the twenty-nine symbols of ADR 0082 decision 1.
    expect(symbols).toHaveLength(29);
    const check = addedSymbolCheck(sqlOnly(read(MIGRATION_REL)));
    expect(check).toContain("symbol IS NULL OR symbol IN (");
    expect(quoted(check)).toEqual(symbols);
  });

  it("0088's frozen CHECK is the first twelve of 0089's list", () => {
    const frozen = quoted(frozenSymbolCheck(sqlOnly(read(MIGRATION_0088))));
    expect(frozen).toHaveLength(12);
    expect(quoted(addedSymbolCheck(sqlOnly(read(MIGRATION_REL)))).slice(0, 12)).toEqual(frozen);
  });

  it("inserts exactly the eighteen ADR 0082 role codes, with a bare ON CONFLICT DO NOTHING", () => {
    const rows = insertedRoles(MIGRATION_REL);
    expect(rows.map((r) => r.code).sort()).toEqual(ADR_CODES.map(([code]) => code).sort());
    expect(rows).toHaveLength(18);
    const sql = sqlOnly(read(MIGRATION_REL));
    expect(sql).toContain("ON CONFLICT DO NOTHING;");
    expect(sql).not.toMatch(/ON CONFLICT\s*\(/);
  });

  for (const [code, min, max] of ADR_CODES) {
    it(`'${code}' has a label and a sort_order in its ADR band ${min}–${max}`, () => {
      const row = insertedRoles(MIGRATION_REL).find((r) => r.code === code);
      expect(row, `'${code}' must be inserted`).toBeDefined();
      expect(row?.label.trim().length).toBeGreaterThan(0);
      expect(row?.sort).toBeGreaterThanOrEqual(min);
      expect(row?.sort).toBeLessThanOrEqual(max);
    });

    it(`the DO $$ block self-checks '${code}' is present and active`, () => {
      const sql = sqlOnly(read(MIGRATION_REL));
      const block = sql.slice(sql.indexOf("DO $$"), sql.lastIndexOf("END $$;"));
      expect(block).toContain(`code = '${code}' AND active = true`);
    });
  }

  it("no two inserted codes share a sort_order, and none collides with 0051, 0060 or 0087", () => {
    const earlier = [MIGRATION_0051, MIGRATION_0060, MIGRATION_0087].flatMap((rel) => insertedRoles(rel));
    const mine = insertedRoles(MIGRATION_REL);
    // Positive control: the earlier parse found rows.
    expect(earlier.length).toBeGreaterThan(20);
    const sorts = [...earlier, ...mine].map((r) => r.sort);
    expect(new Set(sorts).size).toBe(sorts.length);
    const earlierCodes = new Set(earlier.map((r) => r.code));
    for (const r of mine) expect(earlierCodes.has(r.code), `'${r.code}' already exists`).toBe(false);
  });

  it("the DO $$ block also raises if the new symbol CHECK is missing", () => {
    const sql = sqlOnly(read(MIGRATION_REL));
    const block = sql.slice(sql.indexOf("DO $$"), sql.lastIndexOf("END $$;"));
    expect(block).toContain("conname = 'mimic_layout_nodes_symbol_check'");
    expect(block).toMatch(/RAISE EXCEPTION/);
  });

  it("every role code the plan's presets name is inserted by 0051, 0060, 0087 or 0089", () => {
    const known = new Set(
      [MIGRATION_0051, MIGRATION_0060, MIGRATION_0087, MIGRATION_REL].flatMap((rel) =>
        insertedRoles(rel).map((r) => r.code),
      ),
    );
    for (const code of PLAN_PRESET_CODES) {
      expect(known.has(code), `plan §3 role code '${code}' must be inserted somewhere`).toBe(true);
    }
  });

  it("every roleCode in mimic-presets.ts is inserted by 0051, 0060, 0087 or 0089", () => {
    const codes = [...read(PRESETS_REL).matchAll(/roleCode:\s*"([a-z0-9_-]+)"/g)].map((m) => m[1] as string);
    // Positive control: the preset source parse found water_train's codes at least.
    expect(codes.length).toBeGreaterThan(0);
    const known = new Set(
      [MIGRATION_0051, MIGRATION_0060, MIGRATION_0087, MIGRATION_REL].flatMap((rel) =>
        insertedRoles(rel).map((r) => r.code),
      ),
    );
    for (const code of codes) {
      expect(known.has(code), `preset roleCode '${code}' must be inserted somewhere`).toBe(true);
    }
  });
});

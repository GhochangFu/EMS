import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

const MIGRATION_REL = "packages/db/drizzle/0090_mimic_symbol_libraries.sql";
const JOURNAL_REL = "packages/db/drizzle/meta/_journal.json";
const CONTRACT_REL = "packages/shared/src/contracts/mimic-layouts.ts";
const SHARED_REGISTRY_REL = "packages/shared/src/mimic-symbol-libraries/index.ts";
const SHARED_DIR = "packages/shared/src/mimic-symbol-libraries";
const WEB_DIR = "apps/web/src/components/widgets/mimic-symbol-libraries";
const WEB_SHAPES_REL = `${WEB_DIR}/shapes.ts`;
const WEB_LABELS_REL = "apps/web/src/lib/mimic-symbols.ts";
const TAG = "0090_mimic_symbol_libraries";
/** 0089's `when` — the F4.94 class: a stamp not above the last applied one is skipped. */
const WHEN_0089 = 1790651638794;

/**
 * The three preloaded libraries, the generated modules' export prefix and the curated count
 * (plan §3). Literal, so a curation change that forgets a module cannot pass by moving every
 * parsed side together.
 */
const LIBRARIES = [
  { code: "tabler", prefix: "TABLER", count: 123 },
  { code: "lucide", prefix: "LUCIDE", count: 126 },
  { code: "mdi", prefix: "MDI", count: 160 },
] as const;

/** Strip `--` comment lines before a scan — a raw scan is satisfied by a comment quoting the
 * statement it explains (the `f3.1a` lesson). 0090's header names most of its statements. */
const sqlOnly = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

const migration = (): string => sqlOnly(read(MIGRATION_REL));

const escapeRe = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const countOf = (text: string, needle: string): number => text.split(needle).length - 1;

/** The slice from `head` to the first `end` after it (inclusive); throws if either is missing. */
const sliceBetween = (text: string, head: string, end: string, what: string): string => {
  const start = text.indexOf(head);
  if (start < 0) throw new Error(`${what}: no ${JSON.stringify(head)}`);
  const stop = text.indexOf(end, start + head.length);
  if (stop < 0) throw new Error(`${what}: no ${JSON.stringify(end)} after the head`);
  return text.slice(start, stop + end.length);
};

/** The string members of one `z.enum([...])` export or `[...] as const` export, from source text
 * (never `@bms/shared`, which resolves to `dist`: a source edit would not reach it). */
const listMembersFromSource = (source: string, head: string): string[] => {
  const block = sliceBetween(source, head, "]", head);
  return [...block.matchAll(/"([a-z0-9_:-]+)"/g)].map((m) => m[1] as string);
};

type SymbolRow = { key: string; library: string; label: string; group: string; sort: number };

/** The `INSERT INTO bms.mimic_symbols` rows, between the INSERT and its `ON CONFLICT`. Fails
 * closed: every `(` row line must parse, so a row the regex misses cannot pass as absent. */
const symbolRows = (sql: string): SymbolRow[] => {
  const block = sliceBetween(sql, "INSERT INTO bms.mimic_symbols (", "ON CONFLICT", "symbol INSERT");
  const lines = block.split("\n").filter((line) => line.trim().startsWith("("));
  return lines.map((line) => {
    const m = /^\s*\('([^']+)', '([a-z0-9]+)', '((?:[^']|'')*)', '([a-z_]+)', (\d+)\),?$/.exec(line);
    if (!m) throw new Error(`0090: unparsed mimic_symbols row: ${line}`);
    return {
      key: m[1] as string,
      library: m[2] as string,
      label: (m[3] as string).replace(/''/g, "'"),
      group: m[4] as string,
      sort: Number(m[5]),
    };
  });
};

type LibraryRow = {
  code: string;
  label: string;
  source: string;
  version: string;
  licence: string;
  attributionUrl: string;
  style: string;
  sortOrder: number;
};

/** The `INSERT INTO bms.mimic_symbol_libraries` rows; fails closed like `symbolRows`. */
const libraryRows = (sql: string): LibraryRow[] => {
  const block = sliceBetween(sql, "INSERT INTO bms.mimic_symbol_libraries (", "ON CONFLICT", "library INSERT");
  const lines = block.split("\n").filter((line) => line.trim().startsWith("("));
  return lines.map((line) => {
    const m = /^\s*\('([^']*)', '([^']*)', '([^']*)', '([^']*)', '([^']*)', '([^']*)', '([^']*)', (\d+)\),?$/.exec(line);
    if (!m) throw new Error(`0090: unparsed mimic_symbol_libraries row: ${line}`);
    return {
      code: m[1] as string,
      label: m[2] as string,
      source: m[3] as string,
      version: m[4] as string,
      licence: m[5] as string,
      attributionUrl: m[6] as string,
      style: m[7] as string,
      sortOrder: Number(m[8]),
    };
  });
};

/** A shared module's `<PREFIX>_SYMBOL_KEYS = [` block, one key per line; fails closed. */
const sharedKeys = (source: string, prefix: string): string[] => {
  const block = sliceBetween(source, `export const ${prefix}_SYMBOL_KEYS = [`, "] as const;", `${prefix} keys`);
  const lines = block.split("\n").slice(1, -1);
  return lines.map((line) => {
    const m = /^\s*"([^"]+)",$/.exec(line);
    if (!m) throw new Error(`${prefix}_SYMBOL_KEYS: unparsed line: ${line}`);
    return m[1] as string;
  });
};

/** A shared module's `<PREFIX>_SYMBOL_META` entries, read after its `> = {`; fails closed. */
const sharedMeta = (source: string, prefix: string): Array<{ key: string; label: string; group: string }> => {
  const decl = source.indexOf(`export const ${prefix}_SYMBOL_META`);
  if (decl < 0) throw new Error(`no ${prefix}_SYMBOL_META`);
  const block = sliceBetween(source.slice(decl), "> = {", "\n};", `${prefix} meta`);
  const lines = block.split("\n").slice(1, -1);
  return lines.map((line) => {
    const m = /^\s*("[^"]+"): \{ label: ("(?:[^"\\]|\\.)*"), group: "([a-z_]+)" \},$/.exec(line);
    if (!m) throw new Error(`${prefix}_SYMBOL_META: unparsed line: ${line}`);
    return { key: JSON.parse(m[1] as string) as string, label: JSON.parse(m[2] as string) as string, group: m[3] as string };
  });
};

/** A web module's `<PREFIX>_SHAPES` record body, after its `> = {` (the type annotation carries a
 * `<` the colour scan must not see) up to its closing `};`. */
const webShapesBlock = (source: string, prefix: string): string => {
  const decl = source.indexOf(`export const ${prefix}_SHAPES`);
  if (decl < 0) throw new Error(`no ${prefix}_SHAPES`);
  const block = sliceBetween(source.slice(decl), "> = {", "\n};", `${prefix} shapes`);
  return block.slice("> = {".length, -"\n};".length);
};

/** One `"key": [shapes],` line per record entry; fails closed. */
const webShapeEntries = (block: string, prefix: string): Array<{ key: string; body: string }> =>
  block
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const m = /^\s*"([^"]+)": (\[.*\]),$/.exec(line);
      if (!m) throw new Error(`${prefix}_SHAPES: unparsed line: ${line.slice(0, 120)}`);
      return { key: m[1] as string, body: m[2] as string };
    });

/** Every `["tag", { … }]` in a shapes body, with its attribute text. */
const shapesOf = (body: string): Array<{ tag: string; attrs: string }> =>
  [...body.matchAll(/\["([^"]*)",\s*\{([^}]*)\}\]/g)].map((m) => ({ tag: m[1] as string, attrs: m[2] as string }));

/** What is left of an attribute list once every `attr: "value"` pair with a whitelisted name is
 * removed — only separators, if every attribute is allowed (a quoted `"stroke-width"` stays). */
const leftoverAttrs = (attrs: string, allowed: readonly string[]): string =>
  attrs.replace(/(?:^|,)\s*([A-Za-z_$][\w$]*)\s*:\s*"[^"]*"/g, (whole, name: string) =>
    allowed.includes(name) ? "" : whole,
  );

const COLOUR_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ["fill", /fill/i],
  ["stroke", /stroke/i],
  ["style", /style/i],
  ["class", /class/i],
  ["#hex", /#[0-9a-f]{3}/i],
  ["url(", /url\(/i],
  ["<", /</],
  ["javascript", /javascript/i],
];
const colourHits = (text: string): string[] => COLOUR_PATTERNS.filter(([, re]) => re.test(text)).map(([n]) => n);

/** The DO block's `library_code = '<code>' AND active) <> N` literals. */
const doBlock = (sql: string): string => sql.slice(sql.indexOf("DO $$"), sql.lastIndexOf("END $$;"));
const doLibraryCounts = (sql: string): Map<string, number> =>
  new Map(
    [...doBlock(sql).matchAll(/library_code = '([a-z0-9]+)' AND active\) <> (\d+)/g)].map(
      (m) => [m[1] as string, Number(m[2])] as const,
    ),
  );

const shared = (prefix: string): string => read(`${SHARED_DIR}/${prefix.toLowerCase()}.generated.ts`);
const web = (prefix: string): string => read(`${WEB_DIR}/${prefix.toLowerCase()}.generated.ts`);
const coreKeys = (): string[] => listMembersFromSource(read(CONTRACT_REL), "export const mimicCoreSymbolSchema = z.enum([");

const setDiff = (a: readonly string[], b: readonly string[]): string[] => {
  const other = new Set(b);
  return a.filter((x) => !other.has(x));
};

/**
 * `F3.32e` — the static half of migration `0090` (ADR 0084 decisions 1–4 and 8, plan D5, U1),
 * and the three-way gate between its rows, the shared generated modules and the web generated
 * modules. The live half is `tests/f3.32e-mimic-symbol-libraries.integration.test.ts`.
 * Assertions inline, no `.spec` sibling (§4.6).
 */
describe("F3.32e — migration 0090: the symbol libraries", () => {
  it("is not scanning an empty or misnamed file", () => {
    expect(existsSync(join(repoRoot, MIGRATION_REL)), `${MIGRATION_REL} must exist`).toBe(true);
    const sql = migration();
    expect(sql).toContain("INSERT INTO bms.mimic_symbols (");
    expect(sql).toContain("ALTER TABLE bms.mimic_layout_nodes");
  });

  it("registers migration 0090 in the journal at idx 90, after 0089 and not ahead of the clock", () => {
    const journal = JSON.parse(read(JOURNAL_REL)) as { entries: Array<Record<string, unknown>> };
    const entry = journal.entries.find((e) => e.tag === TAG);
    expect(entry, "migration 0090 must have a journal entry, or drizzle never runs it").toBeDefined();
    expect(entry?.idx).toBe(90);
    expect(entry?.version).toBe("7");
    expect(entry?.breakpoints).toBe(true);
    expect(entry?.when as number).toBeGreaterThan(WHEN_0089);
    expect(entry?.when as number).toBeLessThanOrEqual(Date.now());
  });

  describe("the role bracket", () => {
    it("has exactly one SET ROLE bms_owner; and one RESET ROLE;", () => {
      const sql = migration();
      expect(countOf(sql, "SET ROLE bms_owner;")).toBe(1);
      expect(countOf(sql, "RESET ROLE;")).toBe(1);
    });

    it("runs the CREATEs, the INSERTs and the REVOKE inside the bracket, in that order", () => {
      const sql = migration();
      const order = [
        "SET ROLE bms_owner;",
        "CREATE TABLE IF NOT EXISTS bms.mimic_symbol_libraries (",
        "CREATE TABLE IF NOT EXISTS bms.mimic_symbols (",
        "INSERT INTO bms.mimic_symbol_libraries (",
        "INSERT INTO bms.mimic_symbols (",
        "REVOKE INSERT, UPDATE, DELETE ON bms.mimic_symbol_libraries, bms.mimic_symbols FROM bms_tenant;",
        "RESET ROLE;",
      ].map((needle) => [needle, sql.indexOf(needle)] as const);
      for (const [needle, at] of order) expect(at, `${needle} must be present`).toBeGreaterThan(-1);
      for (let i = 1; i < order.length; i += 1) {
        expect(order[i]![1], `${order[i]![0]} must follow ${order[i - 1]![0]}`).toBeGreaterThan(order[i - 1]![1]);
      }
    });

    it("finds the seven ALTERs on mimic_layout_nodes and mimic_layouts (positive control)", () => {
      const alters = [...migration().matchAll(/ALTER TABLE bms\.mimic_layout(?:s|_nodes)\b/g)];
      expect(alters).toHaveLength(7);
    });

    it("runs every ALTER on mimic_layout_nodes and mimic_layouts after RESET ROLE", () => {
      const sql = migration();
      const reset = sql.indexOf("RESET ROLE;");
      for (const m of sql.matchAll(/ALTER TABLE bms\.mimic_layout(?:s|_nodes)\b/g)) {
        expect(m.index, `${m[0]} at ${m.index} must follow RESET ROLE at ${reset}`).toBeGreaterThan(reset);
      }
    });

    it("puts the DO $$ block after the last ALTER, and ends the file with END $$;", () => {
      const sql = migration();
      expect(sql.indexOf("DO $$")).toBeGreaterThan(sql.lastIndexOf("ALTER TABLE"));
      expect(sql.trimEnd().endsWith("END $$;")).toBe(true);
    });
  });

  it("revokes INSERT, UPDATE and DELETE on both tables from bms_tenant", () => {
    const needle = "REVOKE INSERT, UPDATE, DELETE ON bms.mimic_symbol_libraries, bms.mimic_symbols FROM bms_tenant;";
    expect(countOf(migration(), needle)).toBe(1);
  });

  it("issues no GRANT statement", () => {
    const sql = migration();
    // Positive control: the privilege scan reads the REVOKE, so it reads statements at all.
    expect(sql).toMatch(/\bREVOKE\b/);
    expect(sql).not.toMatch(/\bGRANT\b/i);
  });

  it("enables no row-level security and creates no policy", () => {
    const sql = migration();
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS bms.mimic_symbols (");
    expect(sql).not.toMatch(/ROW LEVEL SECURITY/i);
    expect(sql).not.toMatch(/CREATE POLICY/i);
  });

  describe("the constraints", () => {
    it("mimic_symbol_libraries_code_check keeps a code to a lower-case letter then letters and digits", () => {
      expect(migration()).toContain(
        "CONSTRAINT mimic_symbol_libraries_code_check CHECK (code ~ '^[a-z][a-z0-9]*$')",
      );
    });

    it("mimic_symbol_libraries_style_check allows stroke and fill only", () => {
      expect(migration()).toContain("CONSTRAINT mimic_symbol_libraries_style_check CHECK (style IN ('stroke', 'fill'))");
    });

    it("mimic_symbols_group_code_check lists MIMIC_SYMBOL_GROUP_CODES, in order, from the shared source", () => {
      const codes = listMembersFromSource(read(CONTRACT_REL), "export const MIMIC_SYMBOL_GROUP_CODES = [");
      expect(codes).toHaveLength(8);
      const check = sliceBetween(migration(), "CONSTRAINT mimic_symbols_group_code_check CHECK (", "))", "group check");
      expect([...check.matchAll(/'([a-z_]+)'/g)].map((m) => m[1])).toEqual(codes);
    });

    it("mimic_symbols_key_names_library_check is a CASE of regular expressions, not a LIKE", () => {
      const check = sliceBetween(
        migration(),
        "CONSTRAINT mimic_symbols_key_names_library_check CHECK (",
        "END\n  )",
        "key names check",
      );
      expect(check).toContain("CASE WHEN library_code = 'core' THEN key ~ '^[a-z][a-z0-9-]*$'");
      expect(check).toContain("starts_with(key, library_code || ':') AND key ~ '^[a-z][a-z0-9]*:[a-z0-9][a-z0-9-]*$'");
      expect(check).not.toMatch(/\bLIKE\b/i);
    });

    it("every inserted key satisfies the key-names CHECK's own expressions", () => {
      const rows = symbolRows(migration());
      expect(rows.length).toBeGreaterThan(400);
      for (const r of rows) {
        const ok =
          r.library === "core"
            ? /^[a-z][a-z0-9-]*$/.test(r.key)
            : r.key.startsWith(`${r.library}:`) && /^[a-z][a-z0-9]*:[a-z0-9][a-z0-9-]*$/.test(r.key);
        expect(ok, `'${r.key}' in library '${r.library}'`).toBe(true);
      }
    });

    it("mimic_layouts_symbol_libraries_check demands at least one library", () => {
      expect(migration()).toContain(
        "ADD CONSTRAINT mimic_layouts_symbol_libraries_check CHECK (cardinality(symbol_libraries) >= 1);",
      );
    });

    it("adds symbol_libraries as a NOT NULL varchar(32)[] defaulting to {core}", () => {
      expect(migration()).toContain(
        "ALTER TABLE bms.mimic_layouts ADD COLUMN IF NOT EXISTS symbol_libraries varchar(32)[] NOT NULL DEFAULT '{core}';",
      );
    });
  });

  describe("the symbol foreign key", () => {
    const DROP_CHECK = "ALTER TABLE bms.mimic_layout_nodes DROP CONSTRAINT IF EXISTS mimic_layout_nodes_symbol_check;";
    const WIDEN = "ALTER TABLE bms.mimic_layout_nodes ALTER COLUMN symbol TYPE varchar(64);";
    const DROP_FK = "ALTER TABLE bms.mimic_layout_nodes DROP CONSTRAINT IF EXISTS mimic_layout_nodes_symbol_fkey;";
    const ADD_FK =
      "ADD CONSTRAINT mimic_layout_nodes_symbol_fkey FOREIGN KEY (symbol) REFERENCES bms.mimic_symbols(key)";

    it("drops mimic_layout_nodes_symbol_check with IF EXISTS", () => {
      expect(countOf(migration(), DROP_CHECK)).toBe(1);
    });

    it("widens symbol to varchar(64) before the foreign key ADD", () => {
      const sql = migration();
      expect(sql.indexOf(WIDEN)).toBeGreaterThan(-1);
      expect(sql.indexOf(WIDEN)).toBeLessThan(sql.indexOf(ADD_FK));
    });

    it("drops mimic_layout_nodes_symbol_fkey IF EXISTS before it adds it, so a replay re-adds it", () => {
      const sql = migration();
      expect(countOf(sql, DROP_FK)).toBe(1);
      expect(sql.indexOf(DROP_FK)).toBeLessThan(sql.indexOf(ADD_FK));
    });

    it("adds the foreign key once, with no ON DELETE and no IF NOT EXISTS", () => {
      const sql = migration();
      expect(countOf(sql, ADD_FK)).toBe(1);
      const statement = sliceBetween(sql, ADD_FK, ";", "fk ADD");
      expect(statement).toBe(`${ADD_FK};`);
      expect(sql).not.toMatch(/ON DELETE/i);
      expect(sql).not.toMatch(/ADD\s+CONSTRAINT\s+IF\s+NOT\s+EXISTS/i);
    });

    it("inserts the symbol rows after both CREATEs and before the foreign key ADD", () => {
      const sql = migration();
      const insert = sql.indexOf("INSERT INTO bms.mimic_symbols (");
      expect(insert).toBeGreaterThan(sql.indexOf("CREATE TABLE IF NOT EXISTS bms.mimic_symbols ("));
      expect(insert).toBeLessThan(sql.indexOf(ADD_FK));
    });
  });

  describe("the rows", () => {
    it("inserts the four library codes of mimicSymbolLibraryCodeSchema, in order", () => {
      const codes = listMembersFromSource(read(CONTRACT_REL), "export const mimicSymbolLibraryCodeSchema = z.enum([");
      expect(codes).toEqual(["core", "tabler", "lucide", "mdi"]);
      expect(libraryRows(migration()).map((r) => r.code)).toEqual(codes);
    });

    it("the library rows equal the shared MIMIC_SYMBOL_LIBRARIES registry", () => {
      const source = read(SHARED_REGISTRY_REL);
      const block = sliceBetween(source, "export const MIMIC_SYMBOL_LIBRARIES", "\n];", "registry");
      const registry = [
        ...block.matchAll(
          /code: "([^"]*)",\s*label: "([^"]*)",\s*source: "([^"]*)",\s*version: "([^"]*)",\s*licence: "([^"]*)",\s*attributionUrl: "([^"]*)",\s*style: "([^"]*)",\s*sortOrder: (\d+),/g,
        ),
      ].map((m) => ({
        code: m[1],
        label: m[2],
        source: m[3],
        version: m[4],
        licence: m[5],
        attributionUrl: m[6],
        style: m[7],
        sortOrder: Number(m[8]),
      }));
      expect(registry).toHaveLength(4);
      expect(libraryRows(migration())).toEqual(registry);
    });

    it("parses every mimic_symbols row: 29 core plus the three curated counts", () => {
      const rows = symbolRows(migration());
      expect(rows).toHaveLength(29 + LIBRARIES.reduce((n, l) => n + l.count, 0));
    });

    it("the 'core' rows are the 29 mimicCoreSymbolSchema members, in order", () => {
      const keys = coreKeys();
      expect(keys).toHaveLength(29);
      expect(symbolRows(migration()).filter((r) => r.library === "core").map((r) => r.key)).toEqual(keys);
    });

    it("the 'core' rows' labels equal MIMIC_CORE_SYMBOL_LABELS", () => {
      const block = sliceBetween(read(WEB_LABELS_REL), "export const MIMIC_CORE_SYMBOL_LABELS", "\n};", "labels");
      const labels = new Map(
        [...block.matchAll(/^\s*([a-z0-9]+): "([^"]*)",$/gm)].map((m) => [m[1] as string, m[2] as string] as const),
      );
      expect(labels.size).toBe(29);
      const core = symbolRows(migration()).filter((r) => r.library === "core");
      expect(core.map((r) => [r.key, r.label])).toEqual(core.map((r) => [r.key, labels.get(r.key)]));
    });

    it("every row's sort_order is ten times its position within its library", () => {
      const rows = symbolRows(migration());
      const seen = new Map<string, number>();
      for (const r of rows) {
        const position = (seen.get(r.library) ?? 0) + 1;
        seen.set(r.library, position);
        expect(r.sort, `'${r.key}' sort_order`).toBe(position * 10);
      }
      expect(seen.size).toBe(4);
    });

    it("no key is over 64 characters, and no key repeats", () => {
      const keys = symbolRows(migration()).map((r) => r.key);
      expect(keys.length).toBeGreaterThan(400);
      expect(keys.filter((k) => k.length > 64)).toEqual([]);
      expect(new Set(keys).size).toBe(keys.length);
    });

    it("inserts both tables with a bare ON CONFLICT DO NOTHING", () => {
      const sql = migration();
      expect(countOf(sql, "ON CONFLICT DO NOTHING;")).toBe(2);
      expect(sql).not.toMatch(/ON CONFLICT\s*\(/);
    });
  });

  describe("the DO $$ self-check", () => {
    it("names exactly the three curated libraries plus core in its per-library counts", () => {
      expect([...doLibraryCounts(migration()).keys()].sort()).toEqual(["core", "lucide", "mdi", "tabler"]);
    });

    it("each per-library count literal equals the parsed row count", () => {
      const rows = symbolRows(migration());
      for (const [code, n] of doLibraryCounts(migration())) {
        expect(n, `DO $$ count for '${code}'`).toBe(rows.filter((r) => r.library === code).length);
      }
    });

    it("the active-library count literal equals the parsed library rows", () => {
      const m = /FROM bms\.mimic_symbol_libraries WHERE active\) <> (\d+)/.exec(doBlock(migration()));
      expect(m, "the DO $$ block must count active libraries").not.toBeNull();
      expect(Number(m?.[1])).toBe(libraryRows(migration()).length);
    });
  });

  describe.each(LIBRARIES)("the three-way gate — $code", ({ code, prefix, count }) => {
    const migrationKeys = (): string[] => symbolRows(migration()).filter((r) => r.library === code).map((r) => r.key);
    const webKeys = (): string[] => webShapeEntries(webShapesBlock(web(prefix), prefix), prefix).map((e) => e.key);

    it(`parses ${count} keys on every side (positive control, at least 100)`, () => {
      expect(count).toBeGreaterThanOrEqual(100);
      expect(migrationKeys()).toHaveLength(count);
      expect(sharedKeys(shared(prefix), prefix)).toHaveLength(count);
      expect(webKeys()).toHaveLength(count);
    });

    it("every 0090 key is a shared key", () => {
      expect(setDiff(migrationKeys(), sharedKeys(shared(prefix), prefix))).toEqual([]);
    });

    it("every shared key is a 0090 key", () => {
      expect(setDiff(sharedKeys(shared(prefix), prefix), migrationKeys())).toEqual([]);
    });

    it("every shared key is a web shape key", () => {
      expect(setDiff(sharedKeys(shared(prefix), prefix), webKeys())).toEqual([]);
    });

    it("every web shape key is a shared key", () => {
      expect(setDiff(webKeys(), sharedKeys(shared(prefix), prefix))).toEqual([]);
    });

    it("0090 lists the keys in the shared curation order", () => {
      expect(migrationKeys()).toEqual(sharedKeys(shared(prefix), prefix));
    });

    it("the INSERT's labels and groups equal the shared META entries", () => {
      const meta = sharedMeta(shared(prefix), prefix);
      expect(meta).toHaveLength(count);
      const rows = symbolRows(migration()).filter((r) => r.library === code);
      expect(rows.map((r) => [r.key, r.label, r.group])).toEqual(meta.map((m) => [m.key, m.label, m.group]));
    });
  });

  describe("the web shapes whitelist", () => {
    const shapeTags = (): string[] =>
      listMembersFromSource(read(WEB_SHAPES_REL), "export const MIMIC_SHAPE_TAGS = [");
    const shapeAttrs = (): string[] =>
      listMembersFromSource(read(WEB_SHAPES_REL), "export const MIMIC_SHAPE_ATTRS = [");
    const allShapes = (): Array<{ key: string; tag: string; attrs: string }> =>
      LIBRARIES.flatMap(({ prefix }) =>
        webShapeEntries(webShapesBlock(web(prefix), prefix), prefix).flatMap((e) =>
          shapesOf(e.body).map((s) => ({ key: e.key, ...s })),
        ),
      );

    it("parses the tag and attribute lists, and at least 300 shapes (positive control)", () => {
      expect(shapeTags()).toContain("path");
      expect(shapeAttrs()).toContain("d");
      expect(allShapes().length).toBeGreaterThanOrEqual(300);
    });

    it("every key has at least one shape, and every shape of an entry is parsed", () => {
      for (const { prefix } of LIBRARIES) {
        for (const e of webShapeEntries(webShapesBlock(web(prefix), prefix), prefix)) {
          const shapes = shapesOf(e.body);
          expect(shapes.length, `'${e.key}' shapes`).toBeGreaterThan(0);
          // Fails closed: the entry body is exactly its parsed shapes, comma-separated.
          const rebuilt = `[${[...e.body.matchAll(/\["[^"]*",\s*\{[^}]*\}\]/g)].map((m) => m[0]).join(", ")}]`;
          expect(e.body, `'${e.key}' has text outside its shapes`).toBe(rebuilt);
        }
      }
    });

    it("every shape's tag is in MIMIC_SHAPE_TAGS", () => {
      const tags = shapeTags();
      expect(allShapes().filter((s) => !tags.includes(s.tag)).map((s) => `${s.key}: ${s.tag}`)).toEqual([]);
    });

    it("every shape's attribute is in MIMIC_SHAPE_ATTRS", () => {
      const attrs = shapeAttrs();
      const bad = allShapes()
        .map((s) => ({ key: s.key, left: leftoverAttrs(s.attrs, attrs).replace(/[\s,]/g, "") }))
        .filter((s) => s.left !== "");
      expect(bad.map((s) => `${s.key}: ${s.left}`)).toEqual([]);
    });

    it("the colour scan finds each forbidden pattern in a planted string (positive control)", () => {
      expect(colourHits(`fill stroke style class #abc url( < javascript`)).toEqual(
        COLOUR_PATTERNS.map(([name]) => name),
      );
    });

    for (const { prefix } of LIBRARIES) {
      it(`${prefix}_SHAPES carries no colour, class, style, reference or markup`, () => {
        const block = webShapesBlock(web(prefix), prefix);
        expect(block).toContain('d: "');
        expect(colourHits(block)).toEqual([]);
      });
    }
  });
});

/**
 * The generator is outside every `tsc` project and nothing imports it, so a syntax error in it
 * would stay green until the next regeneration (code review M1). `node --check` parses it.
 * The MDI notice carries the Apache 2.0 text the release names only by URL (security review M1).
 */
describe("F3.32e — the generator and the licence notices", () => {
  it("scripts/mimic-symbols/generate.mjs parses", () => {
    const result = spawnSync(process.execPath, ["--check", join(repoRoot, "scripts/mimic-symbols/generate.mjs")], {
      encoding: "utf8",
    });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });

  it("the MDI notice ships the Apache 2.0 licence text and a conversion line", () => {
    const module = read(`${WEB_DIR}/mdi.generated.ts`);
    expect(module).toContain("TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION");
    expect(module).toContain("Pictogrammers Free License");
    expect(module).toContain("Converted by scripts/mimic-symbols/generate.mjs");
  });
});

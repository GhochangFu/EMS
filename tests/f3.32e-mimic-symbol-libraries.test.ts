import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// The shared source, never `@bms/shared` (which resolves to `dist`): a source edit reaches it.
import { MIMIC_TRANSFORM_RE } from "../packages/shared/src/contracts/mimic-shapes";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

const MIGRATION_REL = "packages/db/drizzle/0090_mimic_symbol_libraries.sql";
/** F3.32f / ADR 0086 decision 10: 0090 is frozen, so 0091 corrects the Lucide licence label. */
const MIGRATION_0091_REL = "packages/db/drizzle/0091_mimic_lucide_licence.sql";
const JOURNAL_REL = "packages/db/drizzle/meta/_journal.json";
const CONTRACT_REL = "packages/shared/src/contracts/mimic-layouts.ts";
const SHARED_REGISTRY_REL = "packages/shared/src/mimic-symbol-libraries/index.ts";
const SHARED_DIR = "packages/shared/src/mimic-symbol-libraries";
const WEB_DIR = "apps/web/src/components/widgets/mimic-symbol-libraries";
/** F3.32f / ADR 0086 decision 9: the tag and attribute lists moved to the shared shape grammar. */
const WEB_SHAPES_REL = "packages/shared/src/contracts/mimic-shapes.ts";
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

/** F3.32f slice 2 / ADR 0086 decision 9: the three third-party libraries migration 0092 inserts.
 * Declared here, not in the 0092 block, because the whitelist loops below read it at collection
 * time. Literal counts, for the same reason as `LIBRARIES`. */
const LIBRARIES_0092 = [
  { code: "qet", prefix: "QET", count: 137 },
  { code: "wmpid", prefix: "WMPID", count: 157 },
  { code: "drawio", prefix: "DRAWIO", count: 131 },
] as const;

/** Every library with a generated web shapes module: 0090's three and 0092's three. */
const SHAPE_LIBRARIES = [...LIBRARIES, ...LIBRARIES_0092] as const;

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

/** The `UPDATE bms.mimic_symbol_libraries SET licence = '<x>' WHERE code = '<code>';` lines of a
 * later migration. Fails closed: it throws when it parses none, and when a code is not a 0090
 * library row, so an overlay that matches nothing cannot pass as "no change". */
const licenceUpdates = (sql: string): Array<{ code: string; licence: string }> => {
  const known = new Set(libraryRows(migration()).map((r) => r.code));
  const updates = [
    ...sql.matchAll(/^\s*UPDATE bms\.mimic_symbol_libraries SET licence = '([^']*)' WHERE code = '([^']*)';\s*$/gm),
  ].map((m) => ({ code: m[2] as string, licence: m[1] as string }));
  if (updates.length === 0) throw new Error("0091: no licence UPDATE parsed");
  for (const u of updates) {
    if (!known.has(u.code)) throw new Error(`0091: '${u.code}' is not a 0090 library row`);
  }
  return updates;
};

/** 0090's library rows with 0091's licence UPDATEs applied — what a migrated database holds. */
const effectiveLibraryRows = (): LibraryRow[] => {
  const updates = licenceUpdates(sqlOnly(read(MIGRATION_0091_REL)));
  return libraryRows(migration()).map((row) =>
    updates.reduce<LibraryRow>((r, u) => (u.code === r.code ? { ...r, licence: u.licence } : r), row),
  );
};

/** The shared registry's entries, parsed from source (0090's rows are entries 1–4, 0092's 5–7). */
const registryEntries = (): LibraryRow[] => {
  const block = sliceBetween(read(SHARED_REGISTRY_REL), "export const MIMIC_SYMBOL_LIBRARIES", "\n];", "registry");
  return [
    ...block.matchAll(
      /code: "([^"]*)",\s*label: "([^"]*)",\s*source: "([^"]*)",\s*version: "([^"]*)",\s*licence: "([^"]*)",\s*attributionUrl: "([^"]*)",\s*style: "([^"]*)",\s*sortOrder: (\d+),/g,
    ),
  ].map(([, code, label, source, version, licence, attributionUrl, style, sortOrder]) => ({
    ...{ code: code!, label: label!, source: source!, version: version!, licence: licence! },
    ...{ attributionUrl: attributionUrl!, style: style!, sortOrder: Number(sortOrder) },
  }));
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
 * It reads 0090 and 0091: 0090 is frozen, so the registry claim compares 0090's library rows
 * with 0091's licence UPDATEs applied (F3.32f / ADR 0086 decision 10); 0091 itself is gated by
 * `tests/f3.32f-carried-fixes.test.ts`.
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
    // F3.32f / ADR 0086 decision 9: the contract names seven codes; 0090 holds the first four and
    // migration 0092 the other three.
    it("inserts the first four library codes of mimicSymbolLibraryCodeSchema, in order", () => {
      const codes = listMembersFromSource(read(CONTRACT_REL), "export const mimicSymbolLibraryCodeSchema = z.enum([");
      expect(codes).toEqual(["core", "tabler", "lucide", "mdi", "qet", "wmpid", "drawio"]);
      expect(libraryRows(migration()).map((r) => r.code)).toEqual(codes.slice(0, 4));
    });

    it("the library rows, with 0091's licence UPDATEs applied, equal the registry's first four entries", () => {
      const registry = registryEntries();
      // Seven parsed entries, so an entry whose fields the expression misses is loud, not skipped.
      expect(registry).toHaveLength(7);
      expect(effectiveLibraryRows()).toEqual(registry.slice(0, 4));
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
      SHAPE_LIBRARIES.flatMap(({ prefix }) =>
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
      for (const { prefix } of SHAPE_LIBRARIES) {
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

    for (const { prefix } of SHAPE_LIBRARIES) {
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

  // F3.32f / ADR 0086 decision 9: the generator is split into lib/ and sources/ modules, plus the
  // fetch and curate scripts; none is in a tsc project. Mutation: add a syntax error to
  // lib/geometry.mjs, and this claim reddens.
  it("every .mjs under scripts/mimic-symbols parses (at least seven files)", () => {
    const dir = join(repoRoot, "scripts/mimic-symbols");
    const files = readdirSync(dir, { recursive: true, encoding: "utf8" })
      .filter((rel) => rel.endsWith(".mjs"))
      .map((rel) => join(dir, rel));
    expect(files.length).toBeGreaterThanOrEqual(7);
    const failed = files
      .map((file) => ({ file, result: spawnSync(process.execPath, ["--check", file], { encoding: "utf8" }) }))
      .filter(({ result }) => result.status !== 0 || result.stderr !== "")
      .map(({ file, result }) => `${file}: ${result.stderr}`);
    expect(failed).toEqual([]);
  });

  it("the MDI notice ships the Apache 2.0 licence text and a conversion line", () => {
    const module = read(`${WEB_DIR}/mdi.generated.ts`);
    expect(module).toContain("TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION");
    expect(module).toContain("Pictogrammers Free License");
    expect(module).toContain("Converted by scripts/mimic-symbols/generate.mjs");
  });
});

const MIGRATION_0092_REL = "packages/db/drizzle/0092_mimic_third_party_symbol_libraries.sql";
const TAG_0092 = "0092_mimic_third_party_symbol_libraries";
const QET_PIN = "3b12bc579b99932e3fe307ea1e44b8c1c6d1d5c9";
const DRAWIO_PIN = "48b181339578e11da7052ebf5b1fba8499418b77";

const migration0092 = (): string => sqlOnly(read(MIGRATION_0092_REL));

type Credit = { key: string; author: string; source: string; licence: string; licenceUrl: string; pin: string; adaptation: string };

/** A web credits module's `<PREFIX>_SYMBOL_CREDITS` entries, read after its `> = {`; fails closed:
 * every line up to the closing `};` must parse, so an entry the regex misses cannot pass as absent. */
const creditEntries = (prefix: string): Credit[] => {
  const source = read(`${WEB_DIR}/${prefix.toLowerCase()}.credits.generated.ts`);
  const decl = source.indexOf(`export const ${prefix}_SYMBOL_CREDITS`);
  if (decl < 0) throw new Error(`no ${prefix}_SYMBOL_CREDITS`);
  const block = sliceBetween(source.slice(decl), "> = {", "\n};", `${prefix} credits`);
  const str = '"((?:[^"\\\\]|\\\\.)*)"';
  const re = new RegExp(
    `^\\s*("[^"]+"): \\{ author: ${str}, source: ${str}, licence: ${str}, licenceUrl: ${str}, pin: ${str}, adaptation: ${str} \\},$`,
  );
  return block
    .split("\n")
    .slice(1, -1)
    .map((line) => {
      const m = re.exec(line);
      if (!m) throw new Error(`${prefix}_SYMBOL_CREDITS: unparsed line: ${line.slice(0, 160)}`);
      const [, key, author, source, licence, licenceUrl, pin, adaptation] = m as unknown as string[];
      return { key: JSON.parse(key!) as string, author: author!, source: source!, licence: licence!, licenceUrl: licenceUrl!, pin: pin!, adaptation: adaptation! };
    });
};

/** Every `transform: "…"` value in a web shapes block. */
const transformValues = (prefix: string): string[] =>
  [...webShapesBlock(web(prefix), prefix).matchAll(/\btransform: "([^"]*)"/g)].map((m) => m[1] as string);

/**
 * `F3.32f` slice 2 / ADR 0086 decision 9 — the static half of migration `0092`: the rows of the
 * three third-party libraries, the three-way gate between them and the shared and web generated
 * modules, the per-file credits, the transform grammar and the two CC BY notices. The live half is
 * the 0092 block of `tests/f3.32e-mimic-symbol-libraries.integration.test.ts`.
 * Assertions inline, no `.spec` sibling (§4.6).
 *
 * Mutations run and recorded: delete one middle wmpid row from 0092 → seven claims redden, among
 * them "parses 157 keys on every side", "every shared key is a 0092 key", the curation order, the
 * sort_order and "each per-library count literal equals the parsed row count"; change the qet
 * DO $$ literal 137 → 136 → only "each per-library count literal equals the parsed row count".
 */
describe("F3.32f slice 2 — migration 0092: the third-party libraries", () => {
  it("is not scanning an empty or misnamed file", () => {
    expect(existsSync(join(repoRoot, MIGRATION_0092_REL)), `${MIGRATION_0092_REL} must exist`).toBe(true);
    expect(migration0092()).toContain("INSERT INTO bms.mimic_symbols (");
  });

  describe("the journal entry", () => {
    type Entry = { idx: number; version: string; when: number; tag: string; breakpoints: boolean };
    const entries = (): Entry[] => (JSON.parse(read(JOURNAL_REL)) as { entries: Entry[] }).entries;
    const at = (): number => entries().findIndex((e) => e.tag === TAG_0092);

    it("registers 0092 at idx 92, version 7, breakpoints true", () => {
      const entry = entries()[at()];
      expect(entry, "migration 0092 must have a journal entry, or drizzle never runs it").toBeDefined();
      expect(entry?.idx).toBe(92);
      expect(entry?.version).toBe("7");
      expect(entry?.breakpoints).toBe(true);
    });

    // The F4.94 class: a stamp not above the last applied one is skipped. The previous entry is
    // read from the journal, so a renumbering (plan R13) needs no literal here.
    it("stamps when strictly after the previous journal entry", () => {
      const i = at();
      expect(i).toBeGreaterThan(0);
      expect(entries()[i]!.when).toBeGreaterThan(entries()[i - 1]!.when);
    });

    it("stamps when not ahead of the clock", () => {
      expect(entries()[at()]?.when as number).toBeLessThanOrEqual(Date.now());
    });
  });

  describe("the role bracket", () => {
    it("has exactly one SET ROLE bms_owner; and one RESET ROLE;", () => {
      const sql = migration0092();
      expect(countOf(sql, "SET ROLE bms_owner;")).toBe(1);
      expect(countOf(sql, "RESET ROLE;")).toBe(1);
    });

    it("runs both INSERTs inside the bracket, then the DO $$ block", () => {
      const sql = migration0092();
      const order = [
        "SET ROLE bms_owner;",
        "INSERT INTO bms.mimic_symbol_libraries (",
        "INSERT INTO bms.mimic_symbols (",
        "RESET ROLE;",
        "DO $$",
      ].map((needle) => [needle, sql.indexOf(needle)] as const);
      for (const [needle, i] of order) expect(i, `${needle} must be present`).toBeGreaterThan(-1);
      for (let i = 1; i < order.length; i += 1) {
        expect(order[i]![1], `${order[i]![0]} must follow ${order[i - 1]![0]}`).toBeGreaterThan(order[i - 1]![1]);
      }
    });

    it("ends the file with END $$;", () => {
      expect(migration0092().trimEnd().endsWith("END $$;")).toBe(true);
    });
  });

  it("the statement scan reads statements (positive control: it finds INSERT)", () => {
    expect(migration0092()).toMatch(/\bINSERT\b/);
  });

  for (const [name, re] of [
    ["CREATE", /\bCREATE\b/i],
    ["ALTER", /\bALTER\b/i],
    ["GRANT", /\bGRANT\b/i],
    ["REVOKE", /\bREVOKE\b/i],
    ["POLICY", /POLICY/i],
    ["ROW LEVEL SECURITY", /ROW LEVEL SECURITY/i],
  ] as const) {
    it(`issues no ${name}`, () => {
      expect(migration0092()).not.toMatch(re);
    });
  }

  it("inserts both tables with a bare ON CONFLICT DO NOTHING", () => {
    const sql = migration0092();
    expect(countOf(sql, "ON CONFLICT DO NOTHING;")).toBe(2);
    expect(sql).not.toMatch(/ON CONFLICT\s*\(/);
  });

  describe("the library rows", () => {
    it("are qet, wmpid and drawio, in that order", () => {
      expect(libraryRows(migration0092()).map((r) => r.code)).toEqual(["qet", "wmpid", "drawio"]);
    });

    it("have sort_order 50, 60 and 70", () => {
      expect(libraryRows(migration0092()).map((r) => r.sortOrder)).toEqual([50, 60, 70]);
    });

    it("draw with the stroke style", () => {
      expect(libraryRows(migration0092()).map((r) => r.style)).toEqual(["stroke", "stroke", "stroke"]);
    });

    it("equal the registry's entries 5 to 7", () => {
      const registry = registryEntries();
      // Seven parsed entries, so an entry whose fields the expression misses is loud, not skipped.
      expect(registry).toHaveLength(7);
      expect(libraryRows(migration0092())).toEqual(registry.slice(4, 7));
    });
  });

  describe("the symbol rows", () => {
    it("parses every row: the three curated counts (positive control)", () => {
      expect(symbolRows(migration0092())).toHaveLength(LIBRARIES_0092.reduce((n, l) => n + l.count, 0));
    });

    it("every row's library is one of the three", () => {
      const codes = new Set<string>(LIBRARIES_0092.map((l) => l.code));
      expect(symbolRows(migration0092()).filter((r) => !codes.has(r.library)).map((r) => r.key)).toEqual([]);
    });

    it("every key satisfies 0090's key-names CHECK expressions for its library", () => {
      const bad = symbolRows(migration0092()).filter(
        (r) => !(r.key.startsWith(`${r.library}:`) && /^[a-z][a-z0-9]*:[a-z0-9][a-z0-9-]*$/.test(r.key)),
      );
      expect(bad.map((r) => `${r.library}: ${r.key}`)).toEqual([]);
    });

    it("every row's sort_order is ten times its position within its library", () => {
      const seen = new Map<string, number>();
      const bad: string[] = [];
      for (const r of symbolRows(migration0092())) {
        const position = (seen.get(r.library) ?? 0) + 1;
        seen.set(r.library, position);
        if (r.sort !== position * 10) bad.push(`${r.key}: ${r.sort} at position ${position}`);
      }
      expect(seen.size).toBe(3);
      expect(bad).toEqual([]);
    });

    it("no label is over 64 characters", () => {
      expect(symbolRows(migration0092()).filter((r) => r.label.length > 64).map((r) => r.key)).toEqual([]);
    });

    it("no key is over 64 characters", () => {
      expect(symbolRows(migration0092()).filter((r) => r.key.length > 64).map((r) => r.key)).toEqual([]);
    });

    it("no key repeats within 0092", () => {
      const keys = symbolRows(migration0092()).map((r) => r.key);
      expect(new Set(keys).size).toBe(keys.length);
    });

    it("no key repeats a 0090 key", () => {
      const earlier = new Set(symbolRows(migration()).map((r) => r.key));
      expect(earlier.size).toBeGreaterThan(400);
      expect(symbolRows(migration0092()).filter((r) => earlier.has(r.key)).map((r) => r.key)).toEqual([]);
    });

    it("0091 inserts no symbol row, so there is no 0091 key to repeat", () => {
      const sql = sqlOnly(read(MIGRATION_0091_REL));
      expect(sql).toContain("UPDATE bms.mimic_symbol_libraries");
      expect(sql).not.toContain("INSERT INTO bms.mimic_symbols");
    });
  });

  describe("the DO $$ self-check", () => {
    it("the active-library count literal is 7", () => {
      const m = /FROM bms\.mimic_symbol_libraries WHERE active\) <> (\d+)/.exec(doBlock(migration0092()));
      expect(m, "the DO $$ block must count active libraries").not.toBeNull();
      expect(Number(m?.[1])).toBe(7);
    });

    it("names exactly qet, wmpid and drawio in its per-library counts", () => {
      expect([...doLibraryCounts(migration0092()).keys()].sort()).toEqual(["drawio", "qet", "wmpid"]);
    });

    it("each per-library count literal equals the parsed row count", () => {
      const rows = symbolRows(migration0092());
      const counts = Object.fromEntries(doLibraryCounts(migration0092()));
      const parsed = Object.fromEntries(
        LIBRARIES_0092.map(({ code }) => [code, rows.filter((r) => r.library === code).length]),
      );
      expect(counts).toEqual(parsed);
    });

    it("asserts bms_tenant holds no INSERT and does hold SELECT on bms.mimic_symbols", () => {
      const block = doBlock(migration0092());
      expect(block).toContain("IF has_table_privilege('bms_tenant', 'bms.mimic_symbols', 'INSERT') THEN");
      expect(block).toContain("IF NOT has_table_privilege('bms_tenant', 'bms.mimic_symbols', 'SELECT') THEN");
    });
  });

  describe.each(LIBRARIES_0092)("the three-way gate — $code", ({ code, prefix, count }) => {
    const migrationKeys = (): string[] =>
      symbolRows(migration0092())
        .filter((r) => r.library === code)
        .map((r) => r.key);
    const webKeys = (): string[] => webShapeEntries(webShapesBlock(web(prefix), prefix), prefix).map((e) => e.key);

    it(`parses ${count} keys on every side (positive control, at least 100)`, () => {
      expect(count).toBeGreaterThanOrEqual(100);
      expect(migrationKeys()).toHaveLength(count);
      expect(sharedKeys(shared(prefix), prefix)).toHaveLength(count);
      expect(webKeys()).toHaveLength(count);
    });

    it("every 0092 key is a shared key", () => {
      expect(setDiff(migrationKeys(), sharedKeys(shared(prefix), prefix))).toEqual([]);
    });

    it("every shared key is a 0092 key", () => {
      expect(setDiff(sharedKeys(shared(prefix), prefix), migrationKeys())).toEqual([]);
    });

    it("every shared key is a web shape key", () => {
      expect(setDiff(sharedKeys(shared(prefix), prefix), webKeys())).toEqual([]);
    });

    it("every web shape key is a shared key", () => {
      expect(setDiff(webKeys(), sharedKeys(shared(prefix), prefix))).toEqual([]);
    });

    it("0092 lists the keys in the shared curation order", () => {
      expect(migrationKeys()).toEqual(sharedKeys(shared(prefix), prefix));
    });

    it("the INSERT's labels and groups equal the shared META entries", () => {
      const meta = sharedMeta(shared(prefix), prefix);
      expect(meta).toHaveLength(count);
      const rows = symbolRows(migration0092()).filter((r) => r.library === code);
      expect(rows.map((r) => [r.key, r.label, r.group])).toEqual(meta.map((m) => [m.key, m.label, m.group]));
    });

    it("every credit key is a shared key", () => {
      expect(creditEntries(prefix).length).toBe(count);
      expect(setDiff(creditEntries(prefix).map((c) => c.key), sharedKeys(shared(prefix), prefix))).toEqual([]);
    });

    it("every shared key has a credit", () => {
      expect(setDiff(sharedKeys(shared(prefix), prefix), creditEntries(prefix).map((c) => c.key))).toEqual([]);
    });

    it("every credit has a known author, a source, licence and pin, and an adaptation note", () => {
      const bad = creditEntries(prefix)
        .filter((c) => [c.author, c.source, c.licence, c.pin, c.adaptation].some((v) => v.trim() === "") || /^unknown$/i.test(c.author))
        .map((c) => c.key);
      expect(bad).toEqual([]);
    });

    it("every transform value matches MIMIC_TRANSFORM_RE", () => {
      expect(transformValues(prefix).filter((t) => !MIMIC_TRANSFORM_RE.test(t))).toEqual([]);
    });
  });

  describe("the credit pins", () => {
    it("every wmpid pin is a sha1 and an ISO timestamp", () => {
      const credits = creditEntries("WMPID");
      expect(credits.length).toBeGreaterThanOrEqual(100);
      const bad = credits.filter((c) => !/^[0-9a-f]{40}@\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(c.pin));
      expect(bad.map((c) => `${c.key}: ${c.pin}`)).toEqual([]);
    });

    for (const [prefix, pin] of [["QET", QET_PIN], ["DRAWIO", DRAWIO_PIN]] as const) {
      it(`every ${prefix} pin is the ADR's pinned commit ${pin}`, () => {
        const credits = creditEntries(prefix);
        expect(credits.length).toBeGreaterThanOrEqual(100);
        expect(credits.filter((c) => c.pin !== pin).map((c) => `${c.key}: ${c.pin}`)).toEqual([]);
      });
    }
  });

  describe("the transform grammar", () => {
    it("finds transform values in wmpid.generated.ts (positive control for the per-library claims)", () => {
      const values = transformValues("WMPID");
      expect(values.length, `wmpid transform count ${values.length}`).toBeGreaterThan(0);
    });

    it("MIMIC_TRANSFORM_RE refuses a planted bad value and accepts a planted good one", () => {
      expect(MIMIC_TRANSFORM_RE.test("matrix(0,0.5,-0.5,0,12,-1.7)")).toBe(true);
      expect(MIMIC_TRANSFORM_RE.test("url(javascript:alert(1))")).toBe(false);
    });
  });

  describe("the CC BY notices", () => {
    it("the drawio notice carries the README's CC BY 4.0 grant", () => {
      expect(read(`${WEB_DIR}/drawio.generated.ts`)).toContain("licensed under the CC BY 4.0");
    });

    it("the drawio notice carries the pinned commit", () => {
      expect(read(`${WEB_DIR}/drawio.generated.ts`)).toContain(DRAWIO_PIN);
    });

    it("the qet notice links the CC BY 3.0 licence", () => {
      expect(read(`${WEB_DIR}/qet.generated.ts`)).toContain("creativecommons.org/licenses/by/3.0");
    });

    it("the qet notice carries ELEMENTS.LICENSE's first paragraph", () => {
      expect(read(`${WEB_DIR}/qet.generated.ts`)).toContain(
        "The elements collection provided along with QElectroTech is provided as is and",
      );
    });
  });
});

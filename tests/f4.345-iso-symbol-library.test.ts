import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

const DRIZZLE = "packages/db/drizzle";
const JOURNAL_REL = `${DRIZZLE}/meta/_journal.json`;
const CONTRACT_REL = "packages/shared/src/contracts/mimic-layouts.ts";
const SHARED_REGISTRY_REL = "packages/shared/src/mimic-symbol-libraries/index.ts";
const SHARED_REL = "packages/shared/src/mimic-symbol-libraries/iso.generated.ts";
const WEB_DIR = "apps/web/src/components/widgets/mimic-symbol-libraries";
const WEB_REL = `${WEB_DIR}/iso.generated.ts`;
const LEVEL_REL = `${WEB_DIR}/iso.level-boxes.generated.ts`;
const CURATION_REL = "scripts/mimic-symbols/curation/iso.json";
const TAG_RE = /^\d{4}_mimic_iso_symbol_library$/;
const COUNT = 50;
/** The upload grammar's path-data alphabet and cap (`lib/grammar.mjs`, `contracts/mimic-shapes.ts`). */
const PATH_DATA_RE = /^[MmZzLlHhVvCcSsQqTtAa0-9 ,.eE+\-]+$/;
const PATH_DATA_MAX = 8192;

type Entry = { idx: number; version: string; when: number; tag: string; breakpoints: boolean };
const entries = (): Entry[] => (JSON.parse(read(JOURNAL_REL)) as { entries: Entry[] }).entries;
/** The journal position of the iso migration, read by tag, so the number is never hard-coded. */
const at = (): number => entries().findIndex((e) => TAG_RE.test(e.tag));
const migrationRel = (): string => {
  const entry = entries()[at()];
  if (!entry) throw new Error("no *_mimic_iso_symbol_library journal entry");
  return `${DRIZZLE}/${entry.tag}.sql`;
};

/** Strip `--` comment lines, so a header quoting a statement cannot satisfy a scan of it. */
const sqlOnly = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
const migration = (): string => sqlOnly(read(migrationRel()));
const countOf = (text: string, needle: string): number => text.split(needle).length - 1;

const sliceBetween = (text: string, head: string, end: string, what: string): string => {
  const start = text.indexOf(head);
  if (start < 0) throw new Error(`${what}: no ${JSON.stringify(head)}`);
  const stop = text.indexOf(end, start + head.length);
  if (stop < 0) throw new Error(`${what}: no ${JSON.stringify(end)} after the head`);
  return text.slice(start, stop + end.length);
};

type SymbolRow = { key: string; library: string; label: string; group: string; sort: number };
/** The `bms.mimic_symbols` rows; fails closed — every `(` line must parse. */
const symbolRows = (sql: string): SymbolRow[] =>
  sliceBetween(sql, "INSERT INTO bms.mimic_symbols (", "ON CONFLICT", "symbol INSERT")
    .split("\n")
    .filter((line) => line.trim().startsWith("("))
    .map((line) => {
      const m = /^\s*\('([^']+)', '([a-z0-9]+)', '((?:[^']|'')*)', '([a-z_]+)', (\d+)\),?$/.exec(line);
      if (!m) throw new Error(`unparsed mimic_symbols row: ${line}`);
      return { key: m[1]!, library: m[2]!, label: m[3]!.replace(/''/g, "'"), group: m[4]!, sort: Number(m[5]) };
    });

type LibraryRow = { code: string; label: string; source: string; version: string; licence: string; attributionUrl: string; style: string; sortOrder: number };
const LIBRARY_RE = /^\s*\('([^']*)', '([^']*)', '([^']*)', '([^']*)', '([^']*)', '([^']*)', '([^']*)', (\d+)\),?$/;
const toLibraryRow = (m: RegExpExecArray | RegExpMatchArray): LibraryRow => ({
  ...{ code: m[1]!, label: m[2]!, source: m[3]!, version: m[4]!, licence: m[5]! },
  ...{ attributionUrl: m[6]!, style: m[7]!, sortOrder: Number(m[8]) },
});
const libraryRows = (sql: string): LibraryRow[] =>
  sliceBetween(sql, "INSERT INTO bms.mimic_symbol_libraries (", "ON CONFLICT", "library INSERT")
    .split("\n")
    .filter((line) => line.trim().startsWith("("))
    .map((line) => {
      const m = LIBRARY_RE.exec(line);
      if (!m) throw new Error(`unparsed mimic_symbol_libraries row: ${line}`);
      return toLibraryRow(m);
    });

/** The shared registry's entries, parsed from source (never `@bms/shared`, which is `dist`). */
const registryEntries = (): LibraryRow[] => {
  const block = sliceBetween(read(SHARED_REGISTRY_REL), "export const MIMIC_SYMBOL_LIBRARIES", "\n];", "registry");
  return [
    ...block.matchAll(
      /code: "([^"]*)",\s*label: "([^"]*)",\s*source: "([^"]*)",\s*version: "([^"]*)",\s*licence: "([^"]*)",\s*attributionUrl: "([^"]*)",\s*style: "([^"]*)",\s*sortOrder: (\d+),/g,
    ),
  ].map(toLibraryRow);
};

const enumMembers = (source: string, head: string): string[] =>
  [...sliceBetween(source, head, "]", head).matchAll(/"([a-z0-9_:-]+)"/g)].map((m) => m[1]!);

const sharedKeys = (): string[] =>
  sliceBetween(read(SHARED_REL), "export const ISO_SYMBOL_KEYS = [", "] as const;", "ISO keys")
    .split("\n")
    .slice(1, -1)
    .map((line) => {
      const m = /^\s*"([^"]+)",$/.exec(line);
      if (!m) throw new Error(`ISO_SYMBOL_KEYS: unparsed line: ${line}`);
      return m[1]!;
    });

const sharedMeta = (): Array<[string, string, string]> => {
  const source = read(SHARED_REL);
  return sliceBetween(source.slice(source.indexOf("export const ISO_SYMBOL_META")), "> = {", "\n};", "ISO meta")
    .split("\n")
    .slice(1, -1)
    .map((line) => {
      const m = /^\s*("[^"]+"): \{ label: ("(?:[^"\\]|\\.)*"), group: "([a-z_]+)" \},$/.exec(line);
      if (!m) throw new Error(`ISO_SYMBOL_META: unparsed line: ${line}`);
      return [JSON.parse(m[1]!) as string, JSON.parse(m[2]!) as string, m[3]!];
    });
};

/** The web module's `ISO_SHAPES` lines as key → shapes body; fails closed. */
const webShapes = (): Array<{ key: string; body: string }> => {
  const source = read(WEB_REL);
  const block = sliceBetween(source.slice(source.indexOf("export const ISO_SHAPES")), "> = {", "\n};", "ISO shapes");
  return block
    .slice("> = {".length, -"\n};".length)
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const m = /^\s*"([^"]+)": (\[.*\]),$/.exec(line);
      if (!m) throw new Error(`ISO_SHAPES: unparsed line: ${line.slice(0, 120)}`);
      return { key: m[1]!, body: m[2]! };
    });
};

const doBlock = (sql: string): string => sql.slice(sql.indexOf("DO $$"), sql.lastIndexOf("END $$;"));
const coreKeys = (): string[] => enumMembers(read(CONTRACT_REL), "export const mimicCoreSymbolSchema = z.enum([");

/**
 * `F4.345` / ADR 0121 decisions 1, 3 and 4 (plan T2.1) — the built-in `iso` library: its migration
 * (found by tag, the `0092` pattern: two INSERTs in the `bms_owner` bracket, bare
 * ON CONFLICT DO NOTHING, a `DO $$` effect check), the registry's eighth entry, and the three-way
 * gate between the migration rows, the shared keys and the web shapes, plus the web's shape
 * grammar, the tank's level box and the notice. The live half is the iso block of
 * `tests/f3.32e-mimic-symbol-libraries.integration.test.ts`. Assertions inline, no `.spec` (§4.6).
 *
 * Mutations that redden: delete one iso row from the migration → "50 rows", the three-way gate
 * and the DO literal claim; change the registry's iso licence → "equals the registry's 8th entry";
 * add `transform` to a web shape → "path data only".
 */
describe("F4.345 — the built-in iso symbol library", () => {
  describe("the journal entry", () => {
    it("registers exactly one *_mimic_iso_symbol_library migration, version 7, breakpoints true", () => {
      expect(entries().filter((e) => TAG_RE.test(e.tag))).toHaveLength(1);
      const entry = entries()[at()]!;
      expect(entry.version).toBe("7");
      expect(entry.breakpoints).toBe(true);
      expect(existsSync(join(repoRoot, migrationRel())), `${migrationRel()} must exist`).toBe(true);
    });

    it("follows the previous entry: idx + 1, when strictly later and not ahead of the clock", () => {
      const i = at();
      expect(i).toBeGreaterThan(0);
      const [previous, entry] = [entries()[i - 1]!, entries()[i]!];
      expect(entry.idx).toBe(previous.idx + 1);
      expect(entry.when).toBeGreaterThan(previous.when);
      expect(entry.when).toBeLessThanOrEqual(Date.now());
      expect(entry.tag.slice(0, 4)).toBe(String(Number(previous.tag.slice(0, 4)) + 1).padStart(4, "0"));
    });

    it("is the only .sql file with its number", () => {
      const number = entries()[at()]!.tag.slice(0, 5);
      expect(readdirSync(join(repoRoot, DRIZZLE)).filter((f) => f.startsWith(number) && f.endsWith(".sql"))).toHaveLength(1);
    });
  });

  describe("the role bracket", () => {
    it("has one SET ROLE bms_owner; and one RESET ROLE;, INSERTs inside, then DO $$, ending END $$;", () => {
      const sql = migration();
      expect(countOf(sql, "SET ROLE bms_owner;")).toBe(1);
      expect(countOf(sql, "RESET ROLE;")).toBe(1);
      const order = [
        "SET ROLE bms_owner;",
        "INSERT INTO bms.mimic_symbol_libraries (",
        "INSERT INTO bms.mimic_symbols (",
        "RESET ROLE;",
        "DO $$",
      ].map((needle) => sql.indexOf(needle));
      for (const i of order) expect(i).toBeGreaterThan(-1);
      for (let i = 1; i < order.length; i += 1) expect(order[i]!).toBeGreaterThan(order[i - 1]!);
      expect(sql.trimEnd().endsWith("END $$;")).toBe(true);
    });

    it("issues no CREATE, ALTER, GRANT, REVOKE, POLICY or ROW LEVEL SECURITY (positive control: INSERT)", () => {
      const sql = migration();
      expect(sql).toMatch(/\bINSERT\b/);
      for (const re of [/\bCREATE\b/i, /\bALTER\b/i, /\bGRANT\b/i, /\bREVOKE\b/i, /POLICY/i, /ROW LEVEL SECURITY/i]) {
        expect(sql).not.toMatch(re);
      }
    });

    it("inserts both tables with a bare ON CONFLICT DO NOTHING", () => {
      const sql = migration();
      expect(countOf(sql, "ON CONFLICT DO NOTHING;")).toBe(2);
      expect(sql).not.toMatch(/ON CONFLICT\s*\(/);
    });
  });

  describe("the library row", () => {
    it("is exactly one row and equals the registry's 8th entry (iso, Isometric, 1, fill, 80)", () => {
      const registry = registryEntries();
      expect(registry).toHaveLength(8);
      const rows = libraryRows(migration());
      expect(rows).toEqual([registry[7]]);
      expect(rows[0]).toEqual({
        code: "iso",
        label: "Isometric",
        source: "Own work: scripts/mimic-symbols/sources/iso",
        version: "1",
        licence: "Own work; anatomy kit MIT",
        attributionUrl: "https://github.com/wheresryan22/anatomy",
        style: "fill",
        sortOrder: 80,
      });
    });

    it("iso is appended to mimicSymbolLibraryCodeSchema, the registry order unchanged", () => {
      const codes = enumMembers(read(CONTRACT_REL), "export const mimicSymbolLibraryCodeSchema = z.enum([");
      expect(codes).toEqual(["core", "tabler", "lucide", "mdi", "qet", "wmpid", "drawio", "iso"]);
      expect(registryEntries().map((r) => r.code)).toEqual(codes);
    });
  });

  describe("the symbol rows", () => {
    it(`are ${COUNT}, all iso, keys iso:<name> of at most 64, unique, sort_order 10 × position`, () => {
      const rows = symbolRows(migration());
      expect(rows).toHaveLength(COUNT);
      expect(rows.filter((r) => r.library !== "iso").map((r) => r.key)).toEqual([]);
      expect(rows.filter((r) => !/^iso:[a-z0-9][a-z0-9-]*$/.test(r.key) || r.key.length > 64).map((r) => r.key)).toEqual([]);
      expect(new Set(rows.map((r) => r.key)).size).toBe(COUNT);
      expect(rows.filter((r, i) => r.sort !== (i + 1) * 10).map((r) => r.key)).toEqual([]);
      expect(rows.filter((r) => r.label.length > 64 || r.label.trim() === "").map((r) => r.key)).toEqual([]);
    });

    it("hold an isometric twin of each of the 29 core symbols (decision 1)", () => {
      const keys = new Set(symbolRows(migration()).map((r) => r.key));
      const core = coreKeys();
      expect(core).toHaveLength(29);
      expect(core.filter((k) => !keys.has(`iso:${k}`))).toEqual([]);
    });
  });

  describe("the DO $$ self-check", () => {
    it("counts 8 active libraries and exactly the iso symbols, at the parsed row count", () => {
      const block = doBlock(migration());
      const libraries = /FROM bms\.mimic_symbol_libraries WHERE active\) <> (\d+)/.exec(block);
      expect(Number(libraries?.[1])).toBe(8);
      const counts = [...block.matchAll(/library_code = '([a-z0-9]+)' AND active\) <> (\d+)/g)].map((m) => [m[1], Number(m[2])]);
      expect(counts).toEqual([["iso", symbolRows(migration()).length]]);
    });

    it("asserts bms_tenant holds no INSERT and does hold SELECT on bms.mimic_symbols", () => {
      const block = doBlock(migration());
      expect(block).toContain("IF has_table_privilege('bms_tenant', 'bms.mimic_symbols', 'INSERT') THEN");
      expect(block).toContain("IF NOT has_table_privilege('bms_tenant', 'bms.mimic_symbols', 'SELECT') THEN");
    });
  });

  describe("the three-way gate", () => {
    it("migration keys == shared ISO_SYMBOL_KEYS == web ISO_SHAPES keys, in order", () => {
      const migrationKeys = symbolRows(migration()).map((r) => r.key);
      expect(migrationKeys).toHaveLength(COUNT);
      expect(sharedKeys()).toEqual(migrationKeys);
      expect(webShapes().map((s) => s.key)).toEqual(migrationKeys);
    });

    it("the rows' key, label and group equal ISO_SYMBOL_META, and the curation names the same glyphs", () => {
      const rows = symbolRows(migration());
      expect(rows.map((r) => [r.key, r.label, r.group])).toEqual(sharedMeta());
      const curation = JSON.parse(read(CURATION_REL)) as Record<string, Array<{ name: string; label: string }>>;
      const named = Object.values(curation).flat();
      expect(named.map((e) => `iso:${e.name}`)).toEqual(rows.map((r) => r.key));
      expect(named.map((e) => e.label)).toEqual(rows.map((r) => r.label));
    });
  });

  describe("the web shapes", () => {
    it("every shape is [\"path\", { d }] with path data only, d within the grammar, at most 200 per key", () => {
      const bad: string[] = [];
      let paths = 0;
      for (const { key, body } of webShapes()) {
        const shapes = JSON.parse(body.replace(/\{ d: /g, '{ "d": ')) as Array<[string, Record<string, string>]>;
        if (shapes.length === 0 || shapes.length > 200) bad.push(`${key}: ${shapes.length} shapes`);
        for (const [tag, attrs] of shapes) {
          paths += 1;
          if (tag !== "path" || Object.keys(attrs).join() !== "d") bad.push(`${key}: ${tag} ${Object.keys(attrs).join()}`);
          else if (attrs.d!.length > PATH_DATA_MAX || !PATH_DATA_RE.test(attrs.d!)) bad.push(`${key}: d out of grammar`);
        }
      }
      // Positive control: the parse reached every shape of the build (540).
      expect(paths).toBeGreaterThanOrEqual(COUNT);
      expect(bad).toEqual([]);
    });

    it("the tank's level box is the one key, five finite numbers inside the 24-unit box", () => {
      const source = read(LEVEL_REL);
      const rows = [...source.matchAll(/^\s*"([^"]+)": \{ cx: ([\d.-]+), rx: ([\d.-]+), ry: ([\d.-]+), top: ([\d.-]+), bottom: ([\d.-]+) \},$/gm)];
      expect(rows.map((m) => m[1])).toEqual(["iso:tank"]);
      const [cx, rx, ry, top, bottom] = rows[0]!.slice(2).map(Number) as [number, number, number, number, number];
      for (const n of [cx, rx, ry, top, bottom]) expect(Number.isFinite(n)).toBe(true);
      expect(top).toBeGreaterThanOrEqual(0);
      expect(top).toBeLessThan(bottom);
      expect(bottom).toBeLessThanOrEqual(24);
      expect(rx).toBeGreaterThan(0);
      expect(ry).toBeGreaterThan(0);
      expect(cx - rx).toBeGreaterThanOrEqual(0);
      expect(cx + rx).toBeLessThanOrEqual(24);
    });

    it("the notice carries the MIT licence and the kit's credit, and names no product", () => {
      const notice = sliceBetween(read(WEB_REL), "export const ISO_LICENCE_NOTICE = `", "`;", "ISO notice");
      for (const text of ["MIT License", "Ryan", "anatomy"]) expect(notice).toContain(text);
      expect(notice).not.toMatch(/trinetra/i);
      expect(notice).not.toMatch(/ionsite/i);
      expect(read(SHARED_REL)).toMatch(/^\/\/ GENERATED by scripts\/mimic-symbols\/generate\.mjs/);
    });
  });
});

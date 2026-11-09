import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import { GROUPS, MAX_LABEL, NAME } from "../scripts/mimic-symbols/lib/grammar.mjs";
import { LIBRARY } from "../scripts/mimic-symbols/sources/iso.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

const VENDOR = "scripts/mimic-symbols/vendor/anatomy-kit";
const GLYPHS = "scripts/mimic-symbols/sources/iso/glyphs";
const CURATION = "scripts/mimic-symbols/curation/iso.json";
const BUILD = "scripts/mimic-symbols/sources/iso/build.mjs";
const GENERATOR = "scripts/mimic-symbols/generate.mjs";

const sha256 = (rel: string): string => createHash("sha256").update(readFileSync(join(repoRoot, rel))).digest("hex");

/** `SOURCE.md`'s `- \`<file>\` <64 hex>` lines, as file → hash. */
function sourceHashes(): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of read(`${VENDOR}/SOURCE.md`).matchAll(/`([\w.-]+\.mjs)`\s+([0-9a-f]{64})\b/g)) out.set(m[1], m[2]);
  return out;
}

/** The 29 names of `mimicCoreSymbolSchema`, read from the contract source. */
function coreSymbols(): string[] {
  const source = read("packages/shared/src/contracts/mimic-layouts.ts");
  const body = /export const mimicCoreSymbolSchema = z\.enum\(\[([\s\S]*?)\]\)/.exec(source)?.[1];
  if (!body) throw new Error("mimicCoreSymbolSchema not found");
  return [...body.matchAll(/"([a-z0-9-]+)"/g)].map((m) => m[1]);
}

type CurationEntry = { name: string; label: string };
const curation = (): Record<string, CurationEntry[]> => JSON.parse(read(CURATION));

/** Every file under `rel`, repo-relative, skipping dependency and build output folders. */
function filesUnder(rel: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name === "dist" || name === ".turbo" || name === "coverage") continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(?:[cm]?[jt]sx?)$/.test(name)) out.push(relative(repoRoot, full));
    }
  };
  walk(join(repoRoot, rel));
  return out;
}

/**
 * `F4.345` / ADR 0121 decision 2 (plan T1.4) — the isometric glyph kit in the repository: the
 * vendored anatomy-kit files are the ones `SOURCE.md` names, unchanged, under their MIT licence;
 * the glyph modules and the curation name the same 50 glyphs, the 29 core symbols among them;
 * nothing the product ships imports the kit; and the `iso` source converts the build output into
 * the 24-unit box every other library uses. Assertions inline, no `.spec` sibling (§4.6).
 *
 * Mutations that redden: drop `item.label` from `generate.mjs` `build()` → claim 6; edit one byte
 * of `lathe.mjs` → claim 1; skip the kit-hash comparison in `sources/iso.mjs` `load` → claim 5.
 */
describe("F4.345 isometric glyph sources", () => {
  it("1. the vendored kit is the four files, MIT, and each .mjs hashes to SOURCE.md's value", () => {
    expect(readdirSync(join(repoRoot, VENDOR)).sort()).toEqual(["LICENSE", "SOURCE.md", "iso-kit.mjs", "lathe.mjs"]);
    const licence = read(`${VENDOR}/LICENSE`);
    expect(licence.startsWith("MIT License")).toBe(true);
    expect(licence).toContain("Copyright (c) 2026 Ryan");
    const hashes = sourceHashes();
    // Positive control: the regex finds exactly the two listed files.
    expect([...hashes.keys()].sort()).toEqual(["iso-kit.mjs", "lathe.mjs"]);
    for (const [file, hash] of hashes) expect(sha256(`${VENDOR}/${file}`), file).toBe(hash);
  });

  it("2. the glyph modules and the curation name the same 50 glyphs, the 29 core symbols among them", async () => {
    const modules = readdirSync(join(repoRoot, GLYPHS))
      .filter((f) => f.endsWith(".mjs"))
      .map((f) => f.replace(/\.mjs$/, ""))
      .sort();
    const names = Object.values(curation()).flat().map((e) => e.name);
    expect(modules).toHaveLength(50);
    expect([...names].sort()).toEqual(modules);
    const core = coreSymbols();
    expect(core).toHaveLength(29);
    for (const name of core) expect(names, name).toContain(name);
    for (const name of names) expect(NAME.test(name), name).toBe(true);
    for (const name of modules) {
      const glyph = await import(pathToFileURL(join(repoRoot, GLYPHS, `${name}.mjs`)).href);
      expect(typeof glyph.name, name).toBe("string");
      expect(Array.isArray(glyph.extent), name).toBe(true);
      expect(typeof glyph.parts, name).toBe("function");
    }
    const tank = await import(pathToFileURL(join(repoRoot, GLYPHS, "tank.mjs")).href);
    expect(Number.isFinite(tank.level.r) && tank.level.r > 0).toBe(true);
    expect(tank.level.z1).toBeGreaterThan(tank.level.z0);
  });

  it("3. every curation entry has a label of at most 64 characters, unique, in a known group", () => {
    const labels: string[] = [];
    for (const [group, list] of Object.entries(curation())) {
      expect(GROUPS, group).toContain(group);
      for (const entry of list) {
        expect(typeof entry.label, entry.name).toBe("string");
        expect(entry.label.length, entry.name).toBeLessThanOrEqual(MAX_LABEL);
        labels.push(entry.label);
      }
    }
    expect(labels).toHaveLength(50);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("4. nothing under apps/ or packages/ imports the kit; the build reads the vendored copy only", () => {
    const importsKit = (text: string) => /from\s+["'][^"']*vendor\/anatomy-kit|import\([^)]*anatomy-kit/.test(text);
    const shipped = [...filesUnder("apps"), ...filesUnder("packages")].filter((f) => importsKit(read(f)));
    expect(shipped).toEqual([]);
    const build = read(BUILD);
    // Positive control: the scan sees the build's own import of the kit.
    expect(/vendor["'],\s*["']anatomy-kit|vendor\/anatomy-kit/.test(build)).toBe(true);
    expect(build).not.toContain("ANATOMY_KIT");
    expect(build).not.toContain("homedir(");
  });

  describe("5. the iso source's conversion", () => {
    const dirs: string[] = [];
    afterAll(() => {
      for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    });
    const kit = Object.fromEntries(sourceHashes());
    /** A build output folder: `<root>/manifest.json` and `<root>/fill/x.svg`; returns the fill dir. */
    const output = (manifest: Record<string, unknown>, svg: string): string => {
      const root = mkdtempSync(join(tmpdir(), "f4345-iso-"));
      dirs.push(root);
      mkdirSync(join(root, "fill"));
      writeFileSync(join(root, "manifest.json"), JSON.stringify({ version: "1", line: 40, kit, glyphs: ["x"], levelBoxes: {}, ...manifest }));
      writeFileSync(join(root, "fill", "x.svg"), svg);
      return join(root, "fill");
    };
    const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-4 -1 46 46"><path d="M-4 -1L42 -1L42 45Z"/></svg>';

    it("maps the view box onto 0..24 and keeps path data only", () => {
      expect(LIBRARY.load(output({}, SVG)).shapes({ name: "x" })).toEqual([["path", { d: "M0 0L24 0L24 24Z" }]]);
    });

    it("refuses a colour attribute, a non-path child, another version, a changed kit hash and another line width", () => {
      const load = (manifest: Record<string, unknown>, svg = SVG) => () => LIBRARY.load(output(manifest, svg)).shapes({ name: "x" });
      expect(load({}, SVG.replace("<path ", '<path fill="#000" '))).toThrow(/fill/);
      expect(load({}, SVG.replace("</svg>", '<rect x="0" y="0" width="1" height="1"/></svg>'))).toThrow(/rect/);
      expect(load({ version: "2" })).toThrow(/pin/);
      const changed = { ...kit, "lathe.mjs": kit["lathe.mjs"].replace(/^./, (c: string) => (c === "a" ? "b" : "a")) };
      expect(load({ kit: changed })).toThrow(/SOURCE\.md/);
      expect(load({ line: 16 })).toThrow(/line/);
      // Positive twin: the unchanged manifest passes.
      expect(load({})).not.toThrow();
    });

    it("maps a level box through the glyph's own 24-unit matrix", () => {
      const dir = output({ levelBoxes: { x: { cx: 19, rx: 23, ry: 11.5, top: 22, bottom: 45 } } }, SVG);
      const modules = LIBRARY.load(dir).extraModules({ entries: [{ key: "iso:x" }] });
      expect(modules).toHaveLength(1);
      expect(modules[0].path).toBe("apps/web/src/components/widgets/mimic-symbol-libraries/iso.level-boxes.generated.ts");
      expect(modules[0].text).toContain('"iso:x": { cx: 12, rx: 12, ry: 6, top: 12, bottom: 24 },');
    });
  });

  it("6. the generator takes --iso, ends LIBRARIES with ISO and reads a curation label", () => {
    const generator = read(GENERATOR);
    expect(generator).toContain("--iso");
    expect(/const LIBRARIES = \[[\s\S]*?\n {2}ISO,\n\];/.test(generator)).toBe(true);
    expect(generator).toContain("item.label");
    expect(generator).toContain("extraModules");
    expect(existsSync(join(repoRoot, "scripts/mimic-symbols/sources/iso.mjs"))).toBe(true);
  });
});

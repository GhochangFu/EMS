/**
 * `F4.345` / ADR 0121 decisions 1, 2 and 6 — the built-in isometric library (`iso`), own work
 * drawn with the vendored anatomy kit (`../vendor/anatomy-kit`, MIT). `sources/iso/build.mjs`
 * writes `sources/iso/out/fill/<name>.svg` and `sources/iso/out/manifest.json`;
 * `generate.mjs --iso <that fill dir>` reads them.
 *
 * Curation (`curation/iso.json`): `{ "<group>": [{ "name": "<glyph id>", "label": "<label>" }] }`;
 * the generator takes the `label` as written (plan R1).
 *
 * The interface:
 * - `LIBRARY.load(dir)` → `{ version, licence, conversion, shapes(entry), extraModules(lib) }`:
 *   `version` is the manifest's, which the generator compares with `LIBRARY.pinned`; the manifest
 *   is refused when its line width is not 1/40 or a kit hash differs from `SOURCE.md`'s;
 *   `licence` is the vendored kit's `LICENSE` verbatim; `conversion` the own-work line;
 *   `shapes(entry)` reads `<dir>/<name>.svg` — a `viewBox` and `<path d>` children only — and
 *   returns its paths fitted to the 24-unit box every library uses; `extraModules(lib)` returns
 *   the web's level-box module (the tank's live fill, decision 6), each box mapped through its
 *   glyph's own 24-unit matrix.
 * - No `credit()`: the glyphs are own work, so there is no per-file credits module.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { apply, bakePath, format, normaliseTo24 } from "../lib/geometry.mjs";
import { fail } from "../lib/grammar.mjs";
import { parseXml } from "../lib/xml.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const KIT = resolve(HERE, "..", "vendor", "anatomy-kit");
const PINNED = "1";
/** The ribbon width the ADR fixes: 1/40 of the glyph (a stroke library draws 1/16). */
const LINE = 40;
const KIT_FILES = ["iso-kit.mjs", "lathe.mjs"];
const LEVEL_FIELDS = ["cx", "rx", "ry", "top", "bottom"];
const LEVEL_MODULE = "apps/web/src/components/widgets/mimic-symbol-libraries/iso.level-boxes.generated.ts";

/** `SOURCE.md`'s listed SHA-256 per vendored file. */
function sourceHashes() {
  const text = readFileSync(join(KIT, "SOURCE.md"), "utf8");
  return Object.fromEntries([...text.matchAll(/`([\w.-]+\.mjs)`\s+([0-9a-f]{64})\b/g)].map((m) => [m[1], m[2]]));
}

/** The four numbers of a `viewBox`, or a refusal naming the glyph. */
function viewBoxOf(name, root) {
  const parts = String(root.attrs.viewBox ?? "").trim().split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n)) || !(parts[2] > 0) || !(parts[3] > 0)) {
    fail(`iso:${name} has no four-number viewBox`);
  }
  const [x, y, w, h] = parts;
  return { x, y, w, h };
}

/** One built glyph file: its root element, refused unless it is `<svg viewBox>` with `<path d>` children only. */
function readGlyph(dir, name) {
  const file = join(dir, `${name}.svg`);
  if (!existsSync(file)) fail(`iso:${name} ${file} is missing; run sources/iso/build.mjs first`);
  const root = parseXml(readFileSync(file, "utf8"));
  if (root.name !== "svg") fail(`iso:${name} root is <${root.name}>, not <svg>`);
  if (root.children.length === 0) fail(`iso:${name} has no shapes`);
  for (const node of root.children) {
    if (node.name !== "path") fail(`iso:${name} has a <${node.name}>; only <path> is drawn`);
    const extra = Object.keys(node.attrs).filter((a) => a !== "d");
    if (extra.length > 0) fail(`iso:${name} <path> carries ${extra.join(", ")}; only d is kept`);
    if (typeof node.attrs.d !== "string" || node.attrs.d.trim() === "") fail(`iso:${name} <path> has no d`);
  }
  return root;
}

/** Baked path data, written compactly (`M…L…Z`, no space before a command) like the build's own. */
const compact = (d) => d.replace(/ ([MLZmlz])/g, "$1");

function load(dir) {
  const manifestFile = join(dir, "..", "manifest.json");
  if (!existsSync(manifestFile)) fail(`iso: ${manifestFile} is missing; run sources/iso/build.mjs first`);
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
  if (manifest.version !== PINNED) fail(`iso: the build is version ${JSON.stringify(manifest.version)}, but sources/iso.mjs pins ${PINNED}`);
  if (manifest.line !== LINE) fail(`iso: the build's line is 1/${manifest.line}, but ADR 0121 fixes 1/${LINE}`);
  const listed = sourceHashes();
  for (const file of KIT_FILES) {
    if (!listed[file] || manifest.kit?.[file] !== listed[file]) {
      fail(`iso: the build's ${file} hash is not the one vendor/anatomy-kit/SOURCE.md lists`);
    }
  }
  const glyphs = new Set(Array.isArray(manifest.glyphs) ? manifest.glyphs : []);
  const matrix = (name) => normaliseTo24(viewBoxOf(name, readGlyph(dir, name)));
  return {
    version: manifest.version,
    conversion:
      "Own work: isometric glyphs built by scripts/mimic-symbols/sources/iso/build.mjs and converted by " +
      "scripts/mimic-symbols/generate.mjs into path shapes in a 24-unit box. Drawn with the anatomy kit " +
      "(MIT, © 2026 Ryan, github.com/wheresryan22/anatomy), whose licence follows.",
    licence: readFileSync(join(KIT, "LICENSE"), "utf8"),
    shapes(entry) {
      const name = entry.name;
      if (!glyphs.has(name)) fail(`iso:${name} is not in the build's manifest`);
      const root = readGlyph(dir, name);
      const m = normaliseTo24(viewBoxOf(name, root));
      return root.children.map((node) => ["path", { d: compact(bakePath(node.attrs.d, m)) }]);
    },
    extraModules(lib) {
      const keys = new Set(lib.entries.map((e) => e.key));
      const rows = [];
      for (const [name, box] of Object.entries(manifest.levelBoxes ?? {})) {
        if (!keys.has(`iso:${name}`)) fail(`iso: a level box names ${name}, which the curation does not list`);
        for (const field of LEVEL_FIELDS) {
          if (!Number.isFinite(box?.[field])) fail(`iso:${name} level box ${field} is not a number`);
        }
        const m = matrix(name);
        const [cx, top] = apply(m, box.cx, box.top);
        const bottom = apply(m, box.cx, box.bottom)[1];
        const out = { cx, rx: box.rx * m[0], ry: box.ry * m[3], top, bottom };
        rows.push(`  "iso:${name}": { ${LEVEL_FIELDS.map((f) => `${f}: ${format(out[f])}`).join(", ")} },`);
      }
      const text = [
        "// GENERATED by scripts/mimic-symbols/generate.mjs from scripts/mimic-symbols/sources/iso — do not edit by hand.",
        "// The isometric tank's level box (ADR 0121 decision 6): the shell's floor centre and inner top and the",
        "// liquid surface's ellipse radii, in the glyph's 24-unit box. Numbers only, imported statically.",
        "",
        'import type { IsoSymbolKey } from "@bms/shared";',
        "",
        "/** A glyph's level box in its 24-unit box: the floor centre (`cx`, `bottom`), the top, the ellipse radii. */",
        "export interface MimicLevelBox {",
        ...LEVEL_FIELDS.map((f) => `  readonly ${f}: number;`),
        "}",
        "",
        "/** Each isometric key with a live level and its box. */",
        "export const ISO_LEVEL_BOXES: Readonly<Partial<Record<IsoSymbolKey, MimicLevelBox>>> = {",
        ...rows,
        "};",
        "",
      ].join("\n");
      return [{ path: LEVEL_MODULE, text }];
    },
  };
}

export const LIBRARY = {
  code: "iso",
  constant: "ISO",
  type: "IsoSymbolKey",
  label: "Isometric",
  source: "Own work: scripts/mimic-symbols/sources/iso",
  pinned: PINNED,
  licenceName: "Own work; anatomy kit MIT",
  attributionUrl: "https://github.com/wheresryan22/anatomy",
  style: "fill",
  entryShape: "object",
  load,
};

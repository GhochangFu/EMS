// Builds the isometric glyphs of the built-in `iso` mimic symbol library (ADR 0121) with the
// vendored anatomy kit and writes them as "fill" style SVG files: every line is a thin filled
// ribbon, 1/40 of the glyph. Run from the repo root:
//
//   node scripts/mimic-symbols/sources/iso/build.mjs
//
// It writes out/fill/<id>.svg, out/manifest.json (the build's version, line width, the kit files'
// SHA-256, the glyph ids and each level box) and out/preview.html. `generate.mjs --iso out/fill`
// reads them (sources/iso.mjs).
//
// Each glyph module exports `name` and `parts(k, G, P)` (paint order, back to front) and
// `extent` (world points for the camera fit); a glyph with a live level (the tank) also exports
// `level = { r, z0, z1 }`, its shell's radius and floor and top heights.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { glyphSvg, hiddenLineGlyph } from "./lib/flatten.mjs";
import { ribbonGlyph } from "./lib/ribbon.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
// The vendored copy only (MIT, unchanged; ../../vendor/anatomy-kit/SOURCE.md lists the hashes).
const KIT = join(HERE, "..", "..", "vendor", "anatomy-kit");
const KIT_FILES = ["iso-kit.mjs", "lathe.mjs"];
const k = await import(pathToFileURL(join(KIT, "iso-kit.mjs")).href);
const G = await import(pathToFileURL(join(KIT, "lathe.mjs")).href);

/** The build's version; `sources/iso.mjs` pins it. */
const VERSION = "1";
const SIZE = 48;
const PAD = 3;
// The 29 core mimic symbols (mimicCoreSymbolSchema), in palette order. A glyph builds when its
// module exists; ONLY=a,b builds a subset.
const CORE = [
  "tank", "clarifier", "membrane", "vessel", "tower", "aeration", "dosing", "pump", "discharge",
  "valve", "filter", "unit", "transformer", "breaker", "switchboard", "generator", "meter", "motor",
  "ups", "battery", "rack", "chiller", "ahu", "fan", "compressor", "boiler", "sensor", "lamp", "lift",
  // Not core symbols: asset types on the AWS demo (BCPL flow meters, PHE RTU health) that have none.
  "flowmeter", "rtu",
  // Equipment the vendored libraries (qet, wmpid, drawio, mdi) draw and the core set does not;
  // the damper is used on the AWS ESKOM flow network (qet:air-damper).
  "damper", "butterfly-valve", "check-valve", "strainer", "heat-exchanger", "blower",
  "submersible-pump", "bar-screen", "filter-press", "horizontal-tank", "condensing-unit",
  "solar-panel", "wind-turbine", "ev-charger", "capacitor-bank", "isolator", "vfd",
  "smoke-detector", "pressure-gauge",
];
const ONLY = process.env.ONLY?.split(",");
const GLYPHS = CORE.filter((id) => existsSync(join(HERE, "glyphs", `${id}.mjs`)) && (!ONLY || ONLY.includes(id)));

// Fill-style line width: the view box side divided by LINE (a stroke library draws side / 16).
const LINE = 40;

const outDir = join(HERE, "out");
const fillDir = join(outDir, "fill");
// A full build starts clean, so a glyph removed from CORE leaves no stale file behind. An ONLY=
// build is a preview: its manifest lists the subset, so generate.mjs refuses the other glyphs.
if (!ONLY) rmSync(outDir, { recursive: true, force: true });
mkdirSync(fillDir, { recursive: true });

const previews = [];
process.on("beforeExit", () => {
  if (previews.length === 0) return;
  writeFileSync(join(outDir, "preview.html"), previewHtml(previews));
  previews.length = 0;
});

/**
 * A preview drawn the way the mimic renders a "fill" library glyph (mimic-glyphs.tsx): no stroke,
 * the shapes filled. 60 px is the mimic's own glyph size (GLYPH_SIZE in mimic-scene.tsx).
 */
function previewHtml(items) {
  // Each glyph is defined once as a <symbol> and drawn by <use>, so the file stays small.
  const symbol = (id, g) =>
    `<symbol id="${id}" viewBox="${g.viewBox.join(" ")}">${g.fill.map((p) => `<path d="${p.d}"/>`).join("")}</symbol>`;
  const defs = `<svg width="0" height="0" style="position:absolute">${items.map((g) => symbol(`f-${g.id}`, g)).join("")}</svg>`;
  const fillTile = (g, px) =>
    `<svg width="${px}" height="${px}" viewBox="${g.viewBox.join(" ")}" fill="currentColor" stroke="none"><use href="#f-${g.id}" x="${g.viewBox[0]}" y="${g.viewBox[1]}" width="${g.viewBox[2]}" height="${g.viewBox[3]}"/></svg>`;
  // One tile per SVG file: the glyph at 120 px and at the mimic's 60 px, under its file name.
  const tile = (g) =>
    `<figure data-file="fill/${g.id}.svg"><div class="pics">${fillTile(g, 120)}${fillTile(g, 60)}</div><figcaption><b>fill/${g.id}.svg</b><span>${g.name.replace(" (isometric)", "")} · ${g.fill.length} shapes</span></figcaption></figure>`;
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Iso glyph preview</title>
<style>
:root{--bg:#0f1419;--ink:#38bdf8;--muted:#7a93a6;--line:#1e3442}
body.light{--bg:#f8fafc;--ink:#0369a1;--muted:#5b6b78;--line:#d6e1ea}
body{margin:0;padding:16px;font:12px system-ui;background:var(--bg);color:var(--ink)}
header{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:8px}
h1{font-size:15px;margin:0}button{font:inherit;color:var(--ink);background:none;border:1px solid var(--line);border-radius:6px;padding:4px 10px;cursor:pointer}
p{margin:0 0 10px;color:var(--muted)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px}
figure{margin:0;border:1px solid var(--line);border-radius:6px;padding:8px;display:flex;flex-direction:column;gap:6px}
.pics{display:flex;align-items:flex-end;gap:8px}figcaption{display:flex;flex-direction:column;gap:1px}figcaption span{color:var(--muted);font-size:11px}
</style>
<header><h1>Isometric mimic glyphs — ${items.length} SVG files</h1><button onclick="document.body.classList.toggle('light')">Light / dark</button></header>
<p>Each tile: the glyph at 120 px and at 60 px (the size the mimic draws a glyph, GLYPH_SIZE in mimic-scene.tsx). Lines are 1/${LINE} of the glyph. The files carry no colour: the mimic paints them with the theme's role tokens.</p>
${defs}
<div class="grid">${items.map(tile).join("")}</div>`;
}

const r2 = (n) => Math.round(n * 100) / 100;

/**
 * A glyph's level box in its view box: the shell's floor centre (`cx`, `bottom`), the top of its
 * inner volume (`top`) and the radii of the liquid surface's ellipse (plan R5): `rx` is the
 * ribbon's half width inside the shell's side lines, `ry = rx·sinE` the same ellipse's minor
 * radius. The renderer paints the fill under the glyph's lines, which cover its edge.
 */
function levelBoxOf({ r, z0, z1 }, P, half) {
  const [cx, bottom] = k.iso([0, 0, z0], P);
  const top = k.iso([0, 0, z1], P)[1];
  const camera = k.cameraOf(P);
  const rx = r * camera.k - half;
  return { cx: r2(cx), rx: r2(rx), ry: r2(rx * camera.sinE), top: r2(top), bottom: r2(bottom) };
}

const kit = Object.fromEntries(
  KIT_FILES.map((file) => [file, createHash("sha256").update(readFileSync(join(KIT, file))).digest("hex")]),
);
const levelBoxes = {};

for (const id of GLYPHS) {
  const glyph = await import(pathToFileURL(join(HERE, "glyphs", `${id}.mjs`)).href);
  const P = k.fitProjection(glyph.extent, SIZE, SIZE, { pad: PAD, azimuth: glyph.azimuth ?? 45 });
  const paths = hiddenLineGlyph(glyph.parts(k, G, P));
  // The view box is the drawn lines' own bounds plus a margin, made square around their centre.
  const nums = paths.flatMap((p) => p.d.match(/-?\d+(?:\.\d+)?/g).map(Number));
  const xs = nums.filter((_, i) => i % 2 === 0);
  const ys = nums.filter((_, i) => i % 2 === 1);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const side = Math.max(x1 - x0, y1 - y0) + 2 * PAD;
  const r1 = (n) => Math.round(n * 10) / 10;
  const viewBox = [r1((x0 + x1 - side) / 2), r1((y0 + y1 - side) / 2), r1(side), r1(side)];
  // The lines as thin filled ribbons, for a "fill" style library: side / LINE wide.
  const width = viewBox[2] / LINE;
  const fill = ribbonGlyph(paths, width);
  writeFileSync(join(fillDir, `${id}.svg`), glyphSvg(fill, viewBox));
  if (glyph.level) levelBoxes[id] = levelBoxOf(glyph.level, P, width / 2);
  previews.push({ id, name: glyph.name, viewBox, fill });
  const chars = fill.reduce((n, p) => n + p.d.length, 0);
  console.log(`fill/${id}.svg: ${fill.length} shapes, ${chars} path chars`);
}

writeFileSync(
  join(outDir, "manifest.json"),
  `${JSON.stringify({ version: VERSION, line: LINE, kit, glyphs: GLYPHS, levelBoxes }, null, 2)}\n`,
);
console.log(`manifest.json: ${GLYPHS.length} glyphs, level boxes for ${Object.keys(levelBoxes).join(", ") || "none"}`);

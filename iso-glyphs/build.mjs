// Builds simplified isometric glyphs with the anatomy skill's kit and writes them as SVG files that
// the mimic symbol upload accepts (stroke style). Run: node iso-glyphs/build.mjs
//
// Each glyph module exports `name` and `parts(k, G, P)` (paint order, back to front) and
// `extent` (world points for the camera fit).

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { glyphSvg, hiddenLineGlyph } from "./lib/flatten.mjs";
import { ribbonGlyph } from "./lib/ribbon.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
// The vendored copy (vendor/anatomy-kit, MIT) first; ANATOMY_KIT or the installed skill override it.
const VENDORED = join(HERE, "vendor", "anatomy-kit");
const KIT = process.env.ANATOMY_KIT ?? (existsSync(join(VENDORED, "iso-kit.mjs")) ? VENDORED : join(homedir(), ".claude", "skills", "anatomy", "kit"));
const k = await import(pathToFileURL(join(KIT, "iso-kit.mjs")).href);
const G = await import(pathToFileURL(join(KIT, "lathe.mjs")).href);

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

// Fill-style line width: the view box side divided by LINE (the stroke style is side / 16).
const LINE = Number(process.env.LINE ?? 40);

const outDir = join(HERE, "out");
const fillDir = join(outDir, "fill");
mkdirSync(fillDir, { recursive: true });

const previews = [];
process.on("beforeExit", () => {
  if (previews.length === 0) return;
  writeFileSync(join(outDir, "preview.html"), previewHtml(previews));
  previews.length = 0;
});

/**
 * A preview drawn the way the mimic renders a library glyph (mimic-glyphs.tsx). "stroke": fill
 * none, round caps and joins, stroke width 1.5 × side / 24 of the view box. "fill": no stroke,
 * the shapes filled. 60 px is the mimic's own glyph size (GLYPH_SIZE in mimic-scene.tsx).
 */
function previewHtml(items) {
  // Each glyph is defined once as a <symbol> and drawn by <use>, so the file stays small.
  const symbol = (id, g, paths) =>
    `<symbol id="${id}" viewBox="${g.viewBox.join(" ")}">${paths.map((p) => `<path d="${p.d}"/>`).join("")}</symbol>`;
  const defs = `<svg width="0" height="0" style="position:absolute">${items.map((g) => symbol(`s-${g.id}`, g, g.paths) + symbol(`f-${g.id}`, g, g.fill)).join("")}</svg>`;
  const strokeTile = (g, px) => {
    const width = (1.5 * g.viewBox[2]) / 24;
    return `<svg width="${px}" height="${px}" viewBox="${g.viewBox.join(" ")}" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"><use href="#s-${g.id}" x="${g.viewBox[0]}" y="${g.viewBox[1]}" width="${g.viewBox[2]}" height="${g.viewBox[3]}"/></svg>`;
  };
  const fillTile = (g, px) =>
    `<svg width="${px}" height="${px}" viewBox="${g.viewBox.join(" ")}" fill="currentColor" stroke="none"><use href="#f-${g.id}" x="${g.viewBox[0]}" y="${g.viewBox[1]}" width="${g.viewBox[2]}" height="${g.viewBox[3]}"/></svg>`;
  // One tile per SVG file: the glyph at 120 px and at the mimic's 60 px, under its file name.
  const tile = (g, draw, file, shapes) =>
    `<figure data-file="${file}"><div class="pics">${draw(g, 120)}${draw(g, 60)}</div><figcaption><b>${file}</b><span>${g.name.replace(" (isometric)", "")} · ${shapes} shapes</span></figcaption></figure>`;
  const set = (title, note, draw, file, shapes) =>
    `<section><h2>${title} <small>${items.length} files</small></h2><p>${note}</p><div class="grid">${items.map((g) => tile(g, draw, file(g), shapes(g))).join("")}</div></section>`;
  const total = items.length * 2;
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Iso glyph preview</title>
<style>
:root{--bg:#0f1419;--ink:#38bdf8;--muted:#7a93a6;--line:#1e3442}
body.light{--bg:#f8fafc;--ink:#0369a1;--muted:#5b6b78;--line:#d6e1ea}
body{margin:0;padding:16px;font:12px system-ui;background:var(--bg);color:var(--ink)}
header{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:8px}
h1{font-size:15px;margin:0}button{font:inherit;color:var(--ink);background:none;border:1px solid var(--line);border-radius:6px;padding:4px 10px;cursor:pointer}
h2{font-size:14px;margin:20px 0 2px}h2 small{color:var(--muted);font-weight:400}p{margin:0 0 10px;color:var(--muted)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px}
figure{margin:0;border:1px solid var(--line);border-radius:6px;padding:8px;display:flex;flex-direction:column;gap:6px}
.pics{display:flex;align-items:flex-end;gap:8px}figcaption{display:flex;flex-direction:column;gap:1px}figcaption span{color:var(--muted);font-size:11px}
</style>
<header><h1>Isometric mimic glyphs — all ${total} SVG files</h1><button onclick="document.body.classList.toggle('light')">Light / dark</button></header>
<p>Each tile: the glyph at 120 px and at 60 px (the size the mimic draws a glyph, GLYPH_SIZE in mimic-scene.tsx). ${items.length} glyphs: the 29 core mimic symbols; the flow meter and RTU panel (AWS asset types with no core symbol); and 19 kinds of equipment that the portal's vendored libraries (qet, wmpid, drawio, mdi) draw and the core set does not — the damper is in use on the AWS ESKOM flow network. The files carry no colour: the mimic paints them with the theme's role tokens.</p>
${defs}
${set("Thin-line set — upload as a fill library", "iso-glyphs/out/fill/*.svg. Lines are 1/40 of the glyph; this is the set to use.", fillTile, (g) => `fill/${g.id}.svg`, (g) => g.fill.length)}
${set("Stroke set — upload as a stroke library", "iso-glyphs/out/*.svg. The mimic draws a stroke library with lines 1/16 of the glyph, so close lines merge. Kept for comparison.", strokeTile, (g) => `${g.id}.svg`, (g) => g.paths.length)}`;
}

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
  const svg = glyphSvg(paths, viewBox);
  writeFileSync(join(outDir, `${id}.svg`), svg);
  // The same lines as thin filled ribbons, for a "fill" style library: side / LINE wide.
  const fill = ribbonGlyph(paths, viewBox[2] / LINE);
  writeFileSync(join(fillDir, `${id}.svg`), glyphSvg(fill, viewBox));
  previews.push({ id, name: glyph.name, viewBox, paths, fill });
  const chars = fill.reduce((n, p) => n + p.d.length, 0);
  console.log(`${id}.svg: ${paths.length} stroke shapes; fill ${fill.length} shapes, ${chars} path chars`);
}

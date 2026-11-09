// Writes out/review.html: a few glyphs, stroke style beside fill style, at the mimic's 60 px and
// at 110 px. Run: node iso-glyphs/review.mjs pump transformer ...
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ids = process.argv.slice(2);
const read = (dir, id) => readFileSync(join(HERE, "out", dir, `${id}.svg`), "utf8");

const sized = (svg, px, attrs) => svg.replace("<svg ", `<svg width="${px}" height="${px}" ${attrs} `);
const tiles = ids.map((id) => {
  const stroke = read("", id);
  const side = Number(/viewBox="[^"]*?\s[^\s"]+\s([^\s"]+)\s/.exec(stroke)[1]);
  const strokeAttrs = `fill="none" stroke="currentColor" stroke-width="${(1.5 * side) / 24}" stroke-linecap="round" stroke-linejoin="round"`;
  const fill = read("fill", id);
  const fillAttrs = `fill="currentColor" stroke="none"`;
  return `<section><h2>${id}</h2><div>${sized(fill, 110, fillAttrs)}${sized(fill, 60, fillAttrs)}<span>fill</span></div><div>${sized(stroke, 110, strokeAttrs)}${sized(stroke, 60, strokeAttrs)}<span>stroke</span></div></section>`;
});
writeFileSync(
  join(HERE, "out", "review.html"),
  `<!doctype html><meta charset="utf-8"><title>Glyph review</title><style>body{margin:0;padding:4px;background:#0f1419;color:#38bdf8;font:11px system-ui;display:grid;grid-template-columns:1fr 1fr;gap:4px}section{border:1px solid #1e3a4a;padding:3px}h2{margin:0;font-size:12px}div{display:flex;align-items:flex-end;gap:6px}span{opacity:.6}</style>${tiles.join("")}`,
);

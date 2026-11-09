// Turns hidden-line glyph lines into thin filled shapes, for a "fill" style library.
//
// Why: a "stroke" library is drawn with a line width of 1.5/24 of the view box (mimic-glyphs.tsx),
// so an isometric glyph's close lines merge. A "fill" library has no stroke at all — it fills each
// shape. Drawing every line as a thin filled ribbon puts the line weight in the file.
//
// Each segment becomes a quad, each corner and open end a small octagon. All polygons wind the
// same way, so the default nonzero fill rule unions them. Path data stays absolute M/L/Z.

import { parsePath } from "./flatten.mjs";

const MAX_D = 8000; // the upload refuses a `d` over 8192 characters
const JOIN_ANGLE = (15 * Math.PI) / 180;

const r2 = (n) => Math.round(n * 100) / 100;
const fmt = (pts) => `M${pts.map(([x, y]) => `${r2(x)} ${r2(y)}`).join("L")}Z`;

/** Signed area (shoelace); every polygon is turned to the same sign. */
function oriented(pts) {
  let area = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    area += x0 * y1 - x1 * y0;
  }
  return area < 0 ? [...pts].reverse() : pts;
}

function quad([x0, y0], [x1, y1], half) {
  const len = Math.hypot(x1 - x0, y1 - y0);
  if (len < 1e-6) return null;
  const nx = (-(y1 - y0) / len) * half;
  const ny = ((x1 - x0) / len) * half;
  return oriented([[x0 + nx, y0 + ny], [x1 + nx, y1 + ny], [x1 - nx, y1 - ny], [x0 - nx, y0 - ny]]);
}

function dot([x, y], half) {
  const pts = [];
  for (let i = 0; i < 8; i += 1) {
    const a = (i * Math.PI) / 4 + Math.PI / 8;
    pts.push([x + Math.cos(a) * half, y + Math.sin(a) * half]);
  }
  return oriented(pts);
}

function turn(a, b, c) {
  const u = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const v = Math.atan2(c[1] - b[1], c[0] - b[0]);
  let d = Math.abs(v - u);
  if (d > Math.PI) d = 2 * Math.PI - d;
  return d;
}

/** Polygons for one line run of `width`. */
function ribbonOf({ points, closed }, half) {
  const pts = closed ? [...points, points[0]] : points;
  const out = [];
  for (let i = 0; i + 1 < pts.length; i += 1) {
    const q = quad(pts[i], pts[i + 1], half);
    if (q) out.push(q);
  }
  for (let i = 0; i < pts.length; i += 1) {
    const end = !closed && (i === 0 || i === pts.length - 1);
    const prev = pts[i - 1] ?? (closed ? pts[pts.length - 2] : null);
    const next = pts[i + 1] ?? null;
    if (end || (prev && next && turn(prev, pts[i], next) > JOIN_ANGLE)) out.push(dot(pts[i], half));
  }
  return out;
}

/**
 * The glyph's lines ([{name, d}]) as filled shapes [{name, d}], each `d` under the upload limit.
 * `width` is in view box units.
 */
export function ribbonGlyph(paths, width) {
  const half = width / 2;
  const out = [];
  for (const { name, d } of paths) {
    let chunk = "";
    let part = 0;
    for (const run of parsePath(d)) {
      for (const poly of ribbonOf(run, half)) {
        const piece = fmt(poly);
        if (chunk.length + piece.length > MAX_D) {
          out.push({ name: `${name}-${part++}`, d: chunk });
          chunk = "";
        }
        chunk += piece;
      }
    }
    if (chunk) out.push({ name: part ? `${name}-${part}` : name, d: chunk });
  }
  return out;
}
